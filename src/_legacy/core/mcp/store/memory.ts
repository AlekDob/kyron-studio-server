import { randomUUID } from "node:crypto";
import { McpServerConfigSchema } from "../types.js";
import type { McpServerConfig } from "../types.js";
import type { McpStore } from "./interface.js";

export function createMemoryStore(): McpStore {
  const map = new Map<string, McpServerConfig[]>(); // orgId -> servers

  function get(orgId: string): McpServerConfig[] {
    if (!map.has(orgId)) map.set(orgId, []);
    return map.get(orgId)!;
  }

  return {
    async list(orgId) {
      return [...get(orgId)];
    },
    async get(orgId, id) {
      return get(orgId).find((s) => s.id === id) ?? null;
    },
    async getByName(orgId, name) {
      return get(orgId).find((s) => s.name === name) ?? null;
    },
    async create(orgId, input) {
      const list = get(orgId);
      if (list.some((s) => s.name === input.name)) {
        throw new Error(`Esiste gia' un server MCP chiamato "${input.name}"`);
      }
      const now = new Date().toISOString();
      const cfg = McpServerConfigSchema.parse({
        id: randomUUID(),
        name: input.name,
        description: input.description,
        type: input.type,
        command: input.command,
        args: input.args ?? [],
        url: input.url,
        env: input.env ?? {},
        enabled: input.enabled ?? true,
        readOnly: input.readOnly ?? true,
        assignedAgents: input.assignedAgents ?? [],
        createdAt: now,
        updatedAt: now,
      });
      list.push(cfg);
      return cfg;
    },
    async update(orgId, id, patch) {
      const list = get(orgId);
      const idx = list.findIndex((s) => s.id === id);
      if (idx === -1) throw new Error(`MCP server ${id} non trovato`);
      const existing = list[idx]!;
      const updated = McpServerConfigSchema.parse({
        ...existing,
        ...patch,
        updatedAt: new Date().toISOString(),
      });
      list[idx] = updated;
      return updated;
    },
    async markVerified(orgId, id, error) {
      const list = get(orgId);
      const idx = list.findIndex((s) => s.id === id);
      if (idx === -1) return;
      const existing = list[idx]!;
      list[idx] = {
        ...existing,
        lastVerifiedAt: new Date().toISOString(),
        lastError: error,
        updatedAt: new Date().toISOString(),
      };
    },
    async delete(orgId, id) {
      const list = get(orgId);
      const before = list.length;
      const filtered = list.filter((s) => s.id !== id);
      map.set(orgId, filtered);
      return filtered.length < before;
    },
  };
}
