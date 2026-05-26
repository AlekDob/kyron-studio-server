import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { resolveEnvArray, resolveEnvRecord, resolveEnvString } from "./resolver.js";
import type { McpServerConfig } from "./types.js";

/**
 * Wrapper su un singolo server MCP.
 * Responsabilita':
 *  - Gestire lifecycle connect/close
 *  - Esporre listTools() e callTool()
 *  - Tollerare errori al connect (lascia isolated l'errore invece di killare il server intero)
 *
 * NB: per ora supportiamo solo stdio — http/sse arriveranno quando un cliente li chiedera'.
 */

export interface McpTool {
  name: string;
  description?: string;
  inputSchema?: unknown;
}

export interface McpCallResult {
  content: unknown;
  isError: boolean;
}

export class McpClientWrapper {
  readonly config: McpServerConfig;
  private client: Client | null = null;
  private connected = false;
  private tools: McpTool[] = [];
  private lastError: string | null = null;

  constructor(config: McpServerConfig) {
    this.config = config;
  }

  get isConnected(): boolean {
    return this.connected;
  }

  get availableTools(): McpTool[] {
    return [...this.tools];
  }

  get errorMessage(): string | null {
    return this.lastError;
  }

  async connect(): Promise<void> {
    if (this.connected) return;
    try {
      const client = new Client(
        { name: "spaceship-server", version: "0.1.0" },
        { capabilities: {} },
      );
      const transport = this.buildTransport();
      await client.connect(transport);
      this.client = client;
      this.connected = true;
      this.lastError = null;
      await this.refreshTools();
      console.log(
        `[mcp-client] "${this.config.name}" connesso (${this.tools.length} tool disponibili)`,
      );
    } catch (err) {
      this.lastError = err instanceof Error ? err.message : String(err);
      console.error(`[mcp-client] errore connect "${this.config.name}":`, this.lastError);
      await this.close().catch(() => undefined);
      throw err;
    }
  }

  async close(): Promise<void> {
    if (this.client) {
      try {
        await this.client.close();
      } catch (err) {
        console.warn(`[mcp-client] close error "${this.config.name}":`, err);
      }
    }
    this.client = null;
    this.connected = false;
    this.tools = [];
  }

  async refreshTools(): Promise<McpTool[]> {
    if (!this.client) throw new Error(`MCP "${this.config.name}" non connesso`);
    const result = await this.client.listTools();
    this.tools = result.tools.map((t) => ({
      name: t.name,
      description: t.description,
      inputSchema: t.inputSchema,
    }));
    return [...this.tools];
  }

  async callTool(name: string, args: Record<string, unknown>): Promise<McpCallResult> {
    if (!this.client) throw new Error(`MCP "${this.config.name}" non connesso`);
    const result = await this.client.callTool({ name, arguments: args });
    return {
      content: result.content,
      isError: Boolean(result.isError),
    };
  }

  private buildTransport(): StdioClientTransport {
    const cfg = this.config;
    if (cfg.type !== "stdio") {
      throw new Error(`Transport "${cfg.type}" non ancora supportato (solo stdio per ora)`);
    }
    if (!cfg.command) {
      throw new Error(`Missing command per MCP "${cfg.name}"`);
    }
    const command = resolveEnvString(cfg.command);
    const args = resolveEnvArray(cfg.args ?? []);
    // Merge user-defined env con l'ambiente corrente (cosi' PATH, HOME ecc. restano)
    const customEnv = resolveEnvRecord(cfg.env ?? {});
    const inheritedEnv: Record<string, string> = {};
    for (const [k, v] of Object.entries(process.env)) {
      if (typeof v === "string") inheritedEnv[k] = v;
    }
    return new StdioClientTransport({
      command,
      args,
      env: { ...inheritedEnv, ...customEnv },
    });
  }
}
