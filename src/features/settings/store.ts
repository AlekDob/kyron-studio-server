import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";

const DATA_DIR = process.env.SETTINGS_DATA_DIR
  ? resolve(process.env.SETTINGS_DATA_DIR)
  : resolve(process.cwd(), "data");
const SETTINGS_PATH = resolve(DATA_DIR, "settings.json");

export const PROVIDER_IDS = [
  "openai",
  "anthropic",
  "google",
  "mistral",
  "groq",
  "deepseek",
  "glm",
  "minimax",
  "ollama",
  "openai-compat",
] as const;

export type ProviderId = (typeof PROVIDER_IDS)[number];

export interface ModelConfig {
  provider: ProviderId;
  model: string;
}

export interface ProviderConnection {
  apiKey?: string;
  baseURL?: string;
  verifiedAt?: string;
}

// Brain: decision-019 — impostazioni ecommerce configurabili da Studio. Oggi
// solo la % sconto bonifico (cache per il display storefront; il calcolo reale
// vive nel voucher Saleor BONIFICO-2, aggiornato al salvataggio).
export interface EcommerceSettings {
  bankTransferDiscountPercent: number;
}

export const DEFAULT_ECOMMERCE_SETTINGS: EcommerceSettings = {
  bankTransferDiscountPercent: 1.5,
};

interface AllSettings {
  routing?: Record<string, Record<string, ModelConfig>>;
  providers?: Record<string, ProviderConnection>;
  ecommerce?: EcommerceSettings;
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
  await mkdir(dirname(SETTINGS_PATH), { recursive: true });
  await writeFile(SETTINGS_PATH, JSON.stringify(data, null, 2) + "\n", "utf8");
}

export async function getModuleRouting(
  moduleId: string,
): Promise<Record<string, ModelConfig>> {
  const all = await loadAll();
  return all.routing?.[moduleId] ?? {};
}

export async function getProcessConfig(
  moduleId: string,
  processId: string,
): Promise<ModelConfig | null> {
  const all = await loadAll();
  return all.routing?.[moduleId]?.[processId] ?? null;
}

export async function setProcessConfig(
  moduleId: string,
  processId: string,
  config: ModelConfig,
): Promise<void> {
  const all = await loadAll();
  const routing = (all.routing ??= {});
  const mod = (routing[moduleId] ??= {});
  mod[processId] = config;
  await saveAll(all);
}

export async function listProviderConnections(): Promise<
  Record<string, ProviderConnection>
> {
  const all = await loadAll();
  return all.providers ?? {};
}

export async function getProviderConnection(
  providerId: string,
): Promise<ProviderConnection | null> {
  const all = await loadAll();
  return all.providers?.[providerId] ?? null;
}

export async function setProviderConnection(
  providerId: string,
  connection: ProviderConnection,
): Promise<void> {
  const all = await loadAll();
  const providers = (all.providers ??= {});
  providers[providerId] = connection;
  await saveAll(all);
}

export async function getEcommerceSettings(): Promise<EcommerceSettings> {
  const all = await loadAll();
  return { ...DEFAULT_ECOMMERCE_SETTINGS, ...(all.ecommerce ?? {}) };
}

export async function setEcommerceSettings(
  settings: EcommerceSettings,
): Promise<void> {
  const all = await loadAll();
  all.ecommerce = settings;
  await saveAll(all);
}
