import type { WorkflowStore } from "./interface.js";
import { createFileStore } from "./file.js";
import { createMemoryStore } from "./memory.js";
import { createSupabaseStore } from "./supabase.js";

type StoreType = "supabase" | "file" | "memory";

function resolveStoreType(): StoreType {
  const env = process.env.SPACESHIP_STORE?.toLowerCase();
  if (env === "supabase" || env === "file" || env === "memory") return env;
  // Default out-of-the-box: persistenza su disco, cosi' il pilot non perde
  // dati al restart del server. Memory va scelto esplicitamente per i test.
  return "file";
}

let singleton: WorkflowStore | null = null;

export function getWorkflowStore(): WorkflowStore {
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

  console.log(`[workflow-store] Using ${type} store`);
  return singleton;
}

export type { WorkflowStore } from "./interface.js";
