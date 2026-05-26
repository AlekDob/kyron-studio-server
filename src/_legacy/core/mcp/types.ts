import { z } from "zod";

/**
 * MCP (Model Context Protocol) server configuration.
 *
 * Rappresenta un server MCP configurato dall'installatore del cliente.
 * Ogni server puo' essere di tipo stdio (command + args) o http/sse (url).
 * L'agente riceve automaticamente i tool esposti dal server quando e'
 * incluso in `assignedAgents`.
 *
 * Pattern di sicurezza:
 * - `env` supporta interpolazione `${env:VAR_NAME}` che viene risolta a
 *   runtime leggendo `process.env`, cosi' le password vere non finiscono
 *   mai in JSON committati.
 * - `readOnly: true` e' un hint per l'agente (via instructions) — non e'
 *   enforced dal server MCP, quindi va comunque usato un utente DB
 *   con privilegi di sola lettura.
 */

export const McpTransportTypeSchema = z.enum(["stdio", "http", "sse"]);
export type McpTransportType = z.infer<typeof McpTransportTypeSchema>;

export const McpServerConfigSchema = z
  .object({
    id: z.string().min(1),
    name: z
      .string()
      .min(1)
      .regex(/^[a-z0-9][a-z0-9_-]*$/i, "Usa solo lettere/numeri/underscore/trattino"),
    description: z.string().optional(),
    type: McpTransportTypeSchema,
    command: z.string().optional(),
    args: z.array(z.string()).default([]),
    url: z.string().url().optional(),
    env: z.record(z.string()).default({}),
    enabled: z.boolean().default(true),
    readOnly: z.boolean().default(true),
    assignedAgents: z.array(z.string()).default([]),
    createdAt: z.string(),
    updatedAt: z.string(),
    lastVerifiedAt: z.string().optional(),
    lastError: z.string().optional(),
  })
  .superRefine((cfg, ctx) => {
    if (cfg.type === "stdio" && !cfg.command) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "`command` e' obbligatorio per transport stdio",
        path: ["command"],
      });
    }
    if ((cfg.type === "http" || cfg.type === "sse") && !cfg.url) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "`url` e' obbligatorio per transport http/sse",
        path: ["url"],
      });
    }
  });

export type McpServerConfig = z.infer<typeof McpServerConfigSchema>;

/** Input per create — id/timestamp generati dal server */
export const McpServerCreateSchema = z
  .object({
    name: McpServerConfigSchema.innerType().shape.name,
    description: z.string().optional(),
    type: McpTransportTypeSchema,
    command: z.string().optional(),
    args: z.array(z.string()).optional(),
    url: z.string().url().optional(),
    env: z.record(z.string()).optional(),
    enabled: z.boolean().optional(),
    readOnly: z.boolean().optional(),
    assignedAgents: z.array(z.string()).optional(),
  })
  .superRefine((cfg, ctx) => {
    if (cfg.type === "stdio" && !cfg.command) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "`command` e' obbligatorio per transport stdio",
        path: ["command"],
      });
    }
    if ((cfg.type === "http" || cfg.type === "sse") && !cfg.url) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "`url` e' obbligatorio per transport http/sse",
        path: ["url"],
      });
    }
  });

export type McpServerCreate = z.infer<typeof McpServerCreateSchema>;

/** Input per update — tutti i campi opzionali tranne id */
export const McpServerUpdateSchema = z.object({
  name: z
    .string()
    .regex(/^[a-z0-9][a-z0-9_-]*$/i)
    .optional(),
  description: z.string().optional(),
  command: z.string().optional(),
  args: z.array(z.string()).optional(),
  url: z.string().url().optional(),
  env: z.record(z.string()).optional(),
  enabled: z.boolean().optional(),
  readOnly: z.boolean().optional(),
  assignedAgents: z.array(z.string()).optional(),
});
export type McpServerUpdate = z.infer<typeof McpServerUpdateSchema>;

/** Tool MCP risolto (metadata statico per UI/debug) */
export const McpToolDescriptorSchema = z.object({
  serverId: z.string(),
  serverName: z.string(),
  name: z.string(),
  description: z.string().optional(),
  inputSchema: z.unknown().optional(),
});
export type McpToolDescriptor = z.infer<typeof McpToolDescriptorSchema>;

/** Risultato test connessione */
export const McpTestResultSchema = z.object({
  ok: z.boolean(),
  serverName: z.string(),
  toolCount: z.number().optional(),
  tools: z.array(z.string()).optional(),
  error: z.string().optional(),
  durationMs: z.number(),
});
export type McpTestResult = z.infer<typeof McpTestResultSchema>;
