import { readFile, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

const here = dirname(fileURLToPath(import.meta.url));
const SETTINGS_PATH = resolve(here, "../../../data/settings.json");

export type ProviderId =
  | "anthropic"
  | "openai"
  | "google"
  | "ollama"
  | "glm"
  | "minimax"
  | "deepseek"
  | "groq"
  | "openai-compat";

export interface ModelConfig {
  provider: ProviderId;
  model: string;
  // Deprecati dal 2026-04-20: la key/baseURL stanno in ProviderConnection.
  // Mantenuti per retro-compatibilita' lettura + migrazione one-shot.
  apiKey?: string;
  baseURL?: string;
}

// Brain: 002-provider-connections
// Connessione per provider: una sola volta per org, non ripetuta per processo.
export interface ProviderConnection {
  apiKey?: string;
  baseURL?: string;
  verifiedAt?: string; // ISO timestamp dell'ultimo test riuscito
}

// Schema:
//   settings[orgId].routing[moduleId][processId]   = ModelConfig
//   settings[orgId].providers[providerId]          = ProviderConnection
interface AllSettings {
  [orgId: string]: {
    routing?: {
      [moduleId: string]: {
        [processId: string]: ModelConfig;
      };
    };
    providers?: {
      [providerId: string]: ProviderConnection;
    };
  };
}

async function loadAll(): Promise<AllSettings> {
  try {
    const raw = await readFile(SETTINGS_PATH, "utf8");
    return JSON.parse(raw) as AllSettings;
  } catch {
    return {};
  }
}

async function saveAll(data: AllSettings): Promise<void> {
  await writeFile(SETTINGS_PATH, JSON.stringify(data, null, 2) + "\n", "utf8");
}

export async function getModuleRouting(
  orgId: string,
  moduleId: string,
): Promise<Record<string, ModelConfig>> {
  const all = await loadAll();
  return all[orgId]?.routing?.[moduleId] ?? {};
}

export async function setProcessConfig(
  orgId: string,
  moduleId: string,
  processId: string,
  config: ModelConfig,
): Promise<void> {
  const all = await loadAll();
  const org = (all[orgId] ??= {});
  const routing = (org.routing ??= {});
  const mod = (routing[moduleId] ??= {});
  mod[processId] = config;
  await saveAll(all);
}

// --- Provider connections ------------------------------------------------

export async function listProviderConnections(
  orgId: string,
): Promise<Record<string, ProviderConnection>> {
  const all = await loadAll();
  return all[orgId]?.providers ?? {};
}

export async function getProviderConnection(
  orgId: string,
  providerId: string,
): Promise<ProviderConnection | null> {
  const all = await loadAll();
  return all[orgId]?.providers?.[providerId] ?? null;
}

export async function setProviderConnection(
  orgId: string,
  providerId: string,
  connection: ProviderConnection,
): Promise<void> {
  const all = await loadAll();
  const org = (all[orgId] ??= {});
  const providers = (org.providers ??= {});
  providers[providerId] = connection;
  await saveAll(all);
}

// --- Resolver: merge routing + connection --------------------------------

export async function resolveProcessConfig(
  orgId: string,
  moduleId: string,
  processId: string,
): Promise<ModelConfig | null> {
  const routing = await getModuleRouting(orgId, moduleId);
  const chosen = routing[processId] ?? routing["_default"];
  if (!chosen) return null;
  return mergeWithConnection(orgId, chosen);
}

async function mergeWithConnection(
  orgId: string,
  cfg: ModelConfig,
): Promise<ModelConfig> {
  const conn = await getProviderConnection(orgId, cfg.provider);
  return {
    provider: cfg.provider,
    model: cfg.model,
    // ProviderConnection wins: singola fonte di verita' per ogni provider.
    // Fallback al legacy ModelConfig.apiKey solo se la connection non e' ancora
    // stata configurata (retro-compat con settings.json pre-refactor).
    apiKey: conn?.apiKey ?? cfg.apiKey,
    baseURL: conn?.baseURL ?? cfg.baseURL,
  };
}
