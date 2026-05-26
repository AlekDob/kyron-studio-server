import { createTool } from "@mastra/core/tools";
import { z } from "zod";
import { mcpPool } from "./pool.js";
import { jsonSchemaToZod } from "./json-schema-to-zod.js";
import { writeAuditEntry } from "./audit.js";
import type { McpClientWrapper, McpTool } from "./client.js";

/**
 * Bridge dinamico: per ogni tool di ogni MCP server assegnato all'agente,
 * costruisce un tool Mastra (createTool) che al momento dell'invocazione
 * chiama il server MCP.
 *
 * Naming: prefisso del server + tool name per evitare collisioni.
 *   es. mongo.query, mongo.aggregate, postgres.query
 *
 * NB: i tool sono costruiti a ogni `build()` perche' il set di server
 * disponibili puo' cambiare a runtime (UI admin). L'agente va ri-creato
 * dopo un reload del pool.
 */

export interface McpMastraToolsOptions {
  orgId: string;
  agentId: string;
  audit?: boolean; // default true
  /**
   * Modelli piccoli (gemma4, llama3.1:8b) a volte falliscono silenziosamente
   * quando devono comporre un argomento di tipo `array` nel tool call.
   * Attivando questo flag, il bridge trasforma ogni parametro `type: array`
   * dello schema MCP in una stringa JSON ("JSON-encoded array"), e quando
   * il tool viene eseguito la stringa viene re-parsata ad array prima di
   * passarla al server MCP. Trasparente: qwen3/Claude/GPT funzionano uguale,
   * Gemma invece adesso riesce a chiamare il tool. Default: true.
   */
  arrayParamsAsJsonString?: boolean;
}

export async function buildMcpToolsForAgent(
  opts: McpMastraToolsOptions,
): Promise<Record<string, ReturnType<typeof createTool>>> {
  const {
    orgId,
    agentId,
    audit = true,
    arrayParamsAsJsonString = true,
  } = opts;
  const wrappers = await mcpPool.getForAgent(orgId, agentId);

  const tools: Record<string, ReturnType<typeof createTool>> = {};
  for (const wrapper of wrappers) {
    for (const mcpTool of wrapper.availableTools) {
      if (wrapper.config.readOnly && isWriteTool(mcpTool.name)) {
        console.log(
          `[mcp-bridge] skip write tool "${mcpTool.name}" (server "${wrapper.config.name}" e' readOnly)`,
        );
        continue;
      }
      const key = sanitizeToolKey(`${wrapper.config.name}.${mcpTool.name}`);
      tools[key] = buildSingleTool(wrapper, mcpTool, {
        orgId,
        agentId,
        audit,
        key,
        arrayParamsAsJsonString,
      });
    }
  }
  return tools;
}

/**
 * Denylist nomi-tool di scrittura.
 * Copre i nomi canonici di mcp-mongo-server, server-postgres ufficiale,
 * e convenzioni diffuse (insert/update/delete/drop/create/rename/truncate).
 * Case-insensitive. Si puo' bypassare mettendo readOnly=false sulla config
 * del server MCP (scelta esplicita dell'admin).
 */
function isWriteTool(name: string): boolean {
  const n = name.toLowerCase();
  const writeKeywords = [
    "insert", "update", "delete", "remove", "drop", "truncate",
    "create", "rename", "replace", "upsert", "bulk", "write",
    "modify", "mutate", "execute", // generic SQL/shell tool names
  ];
  return writeKeywords.some((kw) => n.includes(kw));
}

function sanitizeToolKey(raw: string): string {
  // OpenAI/Anthropic vogliono tool name con solo [a-zA-Z0-9_-]
  return raw.replace(/[^a-zA-Z0-9_-]/g, "_");
}

function buildSingleTool(
  wrapper: McpClientWrapper,
  mcpTool: McpTool,
  ctx: {
    orgId: string;
    agentId: string;
    audit: boolean;
    key: string;
    arrayParamsAsJsonString: boolean;
  },
): ReturnType<typeof createTool> {
  // Se richiesto, trasforma i params `type: array` in string (JSON-encoded).
  // Gemma4 e alcuni modelli piccoli non emettono tool_calls quando il tool
  // ha un parametro array. Con la stringa JSON riescono.
  const arrayPaths = ctx.arrayParamsAsJsonString
    ? collectArrayPaths(mcpTool.inputSchema)
    : [];
  const effectiveSchema = ctx.arrayParamsAsJsonString
    ? rewriteArraysAsStrings(mcpTool.inputSchema)
    : mcpTool.inputSchema;

  const inputZod = effectiveSchema
    ? jsonSchemaToZod(effectiveSchema)
    : z.object({}).passthrough();

  return createTool({
    id: ctx.key,
    description: mcpTool.description ?? `MCP tool ${mcpTool.name} (${wrapper.config.name})`,
    inputSchema: inputZod as z.ZodTypeAny,
    outputSchema: z
      .object({
        ok: z.boolean(),
        content: z.unknown(),
        error: z.string().optional(),
      })
      .passthrough(),
    execute: async ({ context }) => {
      const start = Date.now();
      let ok = false;
      let content: unknown = null;
      let error: string | undefined;
      // Rehydrate: per ogni path che era array nello schema originale e ora
      // e' arrivato come stringa JSON, fai JSON.parse.
      const rehydrated = rehydrateArrays(context as Record<string, unknown>, arrayPaths);
      try {
        const result = await wrapper.callTool(mcpTool.name, rehydrated);
        ok = !result.isError;
        content = result.content;
        if (result.isError) {
          error = stringifyContent(result.content);
        }
        return { ok, content, error };
      } catch (err) {
        ok = false;
        error = err instanceof Error ? err.message : String(err);
        return { ok: false, content: null, error };
      } finally {
        if (ctx.audit) {
          void writeAuditEntry({
            timestamp: new Date().toISOString(),
            orgId: ctx.orgId,
            agentId: ctx.agentId,
            mcpServer: wrapper.config.name,
            toolName: mcpTool.name,
            args: context,
            durationMs: Date.now() - start,
            status: ok ? "ok" : "error",
            errorMessage: error,
          });
        }
      }
    },
  });
}

function stringifyContent(content: unknown): string {
  if (typeof content === "string") return content;
  try {
    return JSON.stringify(content);
  } catch {
    return String(content);
  }
}

// ── Array-as-JSON-string compat (per Gemma4 & modelli piccoli) ──────

interface JsonSchemaNode {
  type?: string | string[];
  properties?: Record<string, JsonSchemaNode>;
  items?: JsonSchemaNode;
  description?: string;
  [k: string]: unknown;
}

/** Ritorna i path (top-level property names) che nello schema originale sono array. */
function collectArrayPaths(schema: unknown): string[] {
  if (!schema || typeof schema !== "object") return [];
  const s = schema as JsonSchemaNode;
  const props = s.properties ?? {};
  const out: string[] = [];
  for (const [name, sub] of Object.entries(props)) {
    const t = Array.isArray(sub.type) ? sub.type[0] : sub.type;
    if (t === "array") out.push(name);
  }
  return out;
}

/**
 * Ritorna una COPIA dello schema con ogni top-level property `type: array`
 * rimpiazzata da `type: string` con description aggiornata. Non ricorsivo:
 * gli array annidati dentro object non vengono toccati (raro nei tool MCP).
 */
function rewriteArraysAsStrings(schema: unknown): unknown {
  if (!schema || typeof schema !== "object") return schema;
  const s = schema as JsonSchemaNode;
  if (!s.properties) return schema;
  const newProps: Record<string, JsonSchemaNode> = {};
  for (const [name, sub] of Object.entries(s.properties)) {
    const t = Array.isArray(sub.type) ? sub.type[0] : sub.type;
    if (t === "array") {
      const originalDesc = sub.description ?? `Array di ${name}`;
      newProps[name] = {
        type: "string",
        description: `${originalDesc}. IMPORTANTE: passa come stringa JSON-encoded (es. '[{"...":"..."}]'), NON come array nativo.`,
      };
    } else {
      newProps[name] = sub;
    }
  }
  return { ...s, properties: newProps };
}

/** Parsa le stringhe JSON sui path originariamente array. */
function rehydrateArrays(
  args: Record<string, unknown>,
  arrayPaths: string[],
): Record<string, unknown> {
  if (arrayPaths.length === 0) return args;
  const out: Record<string, unknown> = { ...args };
  for (const path of arrayPaths) {
    const v = out[path];
    if (typeof v === "string") {
      try {
        const parsed = JSON.parse(v);
        if (Array.isArray(parsed)) out[path] = parsed;
      } catch {
        // se non parsabile, lascia la stringa e il server MCP restituira' errore.
        // Meglio dell'alternativa (crash silenzioso).
      }
    }
  }
  return out;
}
