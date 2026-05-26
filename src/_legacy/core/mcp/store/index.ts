import type { McpStore } from "./interface.js";
import { createFileStore } from "./file.js";
import { createMemoryStore } from "./memory.js";
import { createSupabaseStore } from "./supabase.js";

type StoreType = "supabase" | "file" | "memory";

function resolveStoreType(): StoreType {
  const env = process.env.SPACESHIP_STORE?.toLowerCase();
  if (env === "supabase" || env === "file" || env === "memory") return env;
  // Default persistente — MCP config deve sopravvivere al restart del server.
  return "file";
}

let singleton: McpStore | null = null;

export function getMcpStore(): McpStore {
  if (singleton) return singleton;
  const type = resolveStoreType();
  switch (type) {
    case "supabase":
      singleton = createSupabaseStore();
      break;
    case "file":
      singleton = createFileStore();
      break;
    case "memory":
      singleton = createMemoryStore();
      break;
  }
  console.log(`[mcp-store] Using ${type} store`);
  return singleton;
}

export type { McpStore } from "./interface.js";
