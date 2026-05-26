import { readFile, writeFile, mkdir } from "node:fs/promises";
import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { randomUUID } from "node:crypto";
import { McpServerConfigSchema } from "../types.js";
import type { McpServerConfig } from "../types.js";
import type { McpStore } from "./interface.js";

const BASE_DIR = resolve(
  process.env.SPACESHIP_DATA_DIR ?? `${process.env.HOME}/.spaceship`,
  "mcp",
);

function orgFile(orgId: string): string {
  return resolve(BASE_DIR, orgId, "servers.json");
}

async function ensureDir(dir: string): Promise<void> {
  if (!existsSync(dir)) await mkdir(dir, { recursive: true });
}

async function readAll(orgId: string): Promise<McpServerConfig[]> {
  const path = orgFile(orgId);
  if (!existsSync(path)) return [];
  const raw = await readFile(path, "utf8");
  const parsed = JSON.parse(raw);
  if (!Array.isArray(parsed)) return [];
  return parsed
    .map((entry) => {
      const result = McpServerConfigSchema.safeParse(entry);
      return result.success ? result.data : null;
    })
    .filter((v): v is McpServerConfig => v != null);
}

async function writeAll(orgId: string, servers: McpServerConfig[]): Promise<void> {
  const path = orgFile(orgId);
  await ensureDir(resolve(path, ".."));
  await writeFile(path, JSON.stringify(servers, null, 2) + "\n", "utf8");
}

export function createFileStore(): McpStore {
  return {
    async list(orgId) {
      return readAll(orgId);
    },

    async get(orgId, id) {
      const all = await readAll(orgId);
      return all.find((s) => s.id === id) ?? null;
    },

    async getByName(orgId, name) {
      const all = await readAll(orgId);
      return all.find((s) => s.name === name) ?? null;
    },

    async create(orgId, input) {
      const all = await readAll(orgId);
      if (all.some((s) => s.name === input.name)) {
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
      await writeAll(orgId, [...all, cfg]);
      return cfg;
    },

    async update(orgId, id, patch) {
      const all = await readAll(orgId);
      const idx = all.findIndex((s) => s.id === id);
      if (idx === -1) throw new Error(`MCP server ${id} non trovato`);
      const existing = all[idx]!;
      if (patch.name && patch.name !== existing.name) {
        if (all.some((s) => s.name === patch.name && s.id !== id)) {
          throw new Error(`Nome "${patch.name}" gia' in uso`);
        }
      }
      const updated = McpServerConfigSchema.parse({
        ...existing,
        ...patch,
        updatedAt: new Date().toISOString(),
      });
      all[idx] = updated;
      await writeAll(orgId, all);
      return updated;
    },

    async markVerified(orgId, id, error) {
      const all = await readAll(orgId);
      const idx = all.findIndex((s) => s.id === id);
      if (idx === -1) return;
      const existing = all[idx]!;
      all[idx] = {
        ...existing,
        lastVerifiedAt: new Date().toISOString(),
        lastError: error,
        updatedAt: new Date().toISOString(),
      };
      await writeAll(orgId, all);
    },

    async delete(orgId, id) {
      const all = await readAll(orgId);
      const filtered = all.filter((s) => s.id !== id);
      if (filtered.length === all.length) return false;
      await writeAll(orgId, filtered);
      return true;
    },
  };
}
