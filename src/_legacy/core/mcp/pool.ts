import { EventEmitter } from "node:events";
import { McpClientWrapper } from "./client.js";
import { getMcpStore } from "./store/index.js";
import type { McpServerConfig, McpToolDescriptor } from "./types.js";

/**
 * Pool globale dei client MCP attivi per org.
 *
 * Design:
 *  - Lazy: non connette nulla al boot. Connette solo quando l'agente chiede i tool.
 *  - Hot-reload: chiamando `reload(orgId)` chiude i client e li ricostruisce dal store.
 *  - Fault-tolerant: se un server fallisce al connect, gli altri continuano.
 *  - Event-driven: emette "reloaded" dopo ogni reload (utile per invalidazione cache lato agent).
 */

type PoolEvent = "reloaded";

class McpPool extends EventEmitter {
  private clients = new Map<string, McpClientWrapper[]>(); // orgId -> wrappers

  /** Ritorna i wrapper attivi per un org (filtrando quelli disabilitati/errati). */
  async getForOrg(orgId: string): Promise<McpClientWrapper[]> {
    const cached = this.clients.get(orgId);
    if (cached) return [...cached];
    return this.reload(orgId);
  }

  /** Ritorna solo i client assegnati a un agente specifico. */
  async getForAgent(orgId: string, agentId: string): Promise<McpClientWrapper[]> {
    const all = await this.getForOrg(orgId);
    return all.filter((w) => w.config.assignedAgents.includes(agentId));
  }

  /** Lista (flat) dei tool disponibili per un agente, con metadati per UI. */
  async listToolsForAgent(orgId: string, agentId: string): Promise<McpToolDescriptor[]> {
    const clients = await this.getForAgent(orgId, agentId);
    const out: McpToolDescriptor[] = [];
    for (const c of clients) {
      for (const tool of c.availableTools) {
        out.push({
          serverId: c.config.id,
          serverName: c.config.name,
          name: tool.name,
          description: tool.description,
          inputSchema: tool.inputSchema,
        });
      }
    }
    return out;
  }

  /**
   * Ricarica tutti i client MCP per un org. Chiude quelli vecchi, apre quelli nuovi.
   * Da chiamare dopo create/update/delete di un server.
   */
  async reload(orgId: string): Promise<McpClientWrapper[]> {
    console.log(`[mcp-pool] reload org=${orgId}`);
    const existing = this.clients.get(orgId) ?? [];
    await Promise.all(existing.map((c) => c.close()));

    const store = getMcpStore();
    const configs = await store.list(orgId);
    const active = configs.filter((c) => c.enabled);

    const wrappers: McpClientWrapper[] = [];
    for (const cfg of active) {
      const wrapper = new McpClientWrapper(cfg);
      try {
        await wrapper.connect();
        wrappers.push(wrapper);
        await store.markVerified(orgId, cfg.id);
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        console.warn(`[mcp-pool] server "${cfg.name}" non connesso: ${msg}`);
        await store.markVerified(orgId, cfg.id, msg);
        // Non aggiungo il wrapper — l'agente semplicemente non vede questi tool.
      }
    }

    this.clients.set(orgId, wrappers);
    this.emit("reloaded" satisfies PoolEvent, orgId);
    return wrappers;
  }

  /** Chiude un singolo server (es. dopo update o delete). */
  async dropServer(orgId: string, serverId: string): Promise<void> {
    const list = this.clients.get(orgId);
    if (!list) return;
    const idx = list.findIndex((c) => c.config.id === serverId);
    if (idx === -1) return;
    await list[idx]!.close().catch(() => undefined);
    list.splice(idx, 1);
  }

  /** Test one-shot: connette, lista i tool, chiude. Non salva nel pool. */
  async probe(config: McpServerConfig): Promise<{ ok: boolean; tools: string[]; error?: string; durationMs: number }> {
    const start = Date.now();
    const wrapper = new McpClientWrapper(config);
    try {
      await wrapper.connect();
      const tools = wrapper.availableTools.map((t) => t.name);
      await wrapper.close();
      return { ok: true, tools, durationMs: Date.now() - start };
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      await wrapper.close().catch(() => undefined);
      return { ok: false, tools: [], error: msg, durationMs: Date.now() - start };
    }
  }

  async shutdown(): Promise<void> {
    for (const list of this.clients.values()) {
      await Promise.all(list.map((c) => c.close().catch(() => undefined)));
    }
    this.clients.clear();
  }
}

export const mcpPool = new McpPool();
