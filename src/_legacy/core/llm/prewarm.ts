// Brain: ollama-cold-start
// Workaround per bug noto di `ollama-ai-provider`: il primo messaggio dopo che
// il modello non e' in RAM riceve una risposta parziale priva di `eval_duration`,
// che fallisce lo schema validation zod -> AI_TypeValidationError sul client.
// Pre-warm fire-and-forget al boot risolve il cold start senza bloccare il listen.
//
// Funziona anche per gli embedding (BGE-M3) che hanno lo stesso problema su /brain/upload.

import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

const here = dirname(fileURLToPath(import.meta.url));
const SETTINGS_PATH = resolve(here, "../../../data/settings.json");

interface RoutingEntry {
  provider: string;
  model: string;
}

interface SettingsShape {
  [orgId: string]: {
    routing?: { [mod: string]: { [proc: string]: RoutingEntry } };
    providers?: { [providerId: string]: { baseURL?: string } };
  };
}

async function readSettings(): Promise<SettingsShape> {
  try {
    const raw = await readFile(SETTINGS_PATH, "utf8");
    return JSON.parse(raw) as SettingsShape;
  } catch {
    return {};
  }
}

function collectOllamaModels(settings: SettingsShape): Set<string> {
  const models = new Set<string>();
  for (const org of Object.values(settings)) {
    const routing = org.routing ?? {};
    for (const mod of Object.values(routing)) {
      for (const proc of Object.values(mod)) {
        if (proc.provider === "ollama" && proc.model) {
          models.add(proc.model);
        }
      }
    }
  }
  return models;
}

function resolveOllamaBaseURL(settings: SettingsShape): string {
  for (const org of Object.values(settings)) {
    const url = org.providers?.ollama?.baseURL;
    if (url) return url.replace(/\/$/, "");
  }
  return process.env.OLLAMA_BASE_URL ?? "http://localhost:11434";
}

async function warmChat(baseURL: string, model: string): Promise<void> {
  const start = Date.now();
  try {
    const res = await fetch(`${baseURL}/api/generate`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ model, prompt: "ok", stream: false }),
    });
    if (!res.ok) {
      console.warn(`[ollama-prewarm] ${model}: HTTP ${res.status}`);
      return;
    }
    await res.json();
    console.log(`[ollama-prewarm] ${model} ready (${Date.now() - start}ms)`);
  } catch (err) {
    const msg = err instanceof Error ? err.message : "unknown";
    console.warn(`[ollama-prewarm] ${model} failed: ${msg}`);
  }
}

async function warmEmbed(baseURL: string, model: string): Promise<void> {
  const start = Date.now();
  try {
    const res = await fetch(`${baseURL}/api/embed`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ model, input: "ok" }),
    });
    if (!res.ok) {
      console.warn(`[ollama-prewarm] embed ${model}: HTTP ${res.status}`);
      return;
    }
    await res.json();
    console.log(`[ollama-prewarm] embed ${model} ready (${Date.now() - start}ms)`);
  } catch (err) {
    const msg = err instanceof Error ? err.message : "unknown";
    console.warn(`[ollama-prewarm] embed ${model} failed: ${msg}`);
  }
}

export async function prewarmOllamaModels(): Promise<void> {
  const settings = await readSettings();
  const baseURL = resolveOllamaBaseURL(settings);
  const chatModels = collectOllamaModels(settings);

  // BGE-M3 (o quanto configurato in EMBEDDING_MODEL) per /brain/upload + /brain/search
  const embeddingProvider = process.env.EMBEDDING_PROVIDER ?? "ollama";
  const embeddingModel = process.env.EMBEDDING_MODEL ?? "bge-m3";

  if (chatModels.size === 0 && embeddingProvider !== "ollama") {
    console.log("[ollama-prewarm] no Ollama models in routing, skipping");
    return;
  }

  console.log(
    `[ollama-prewarm] warming ${chatModels.size} chat model(s) + ${
      embeddingProvider === "ollama" ? "1 embed model" : "0 embed"
    } at ${baseURL}`,
  );

  const tasks: Promise<void>[] = [];
  for (const model of chatModels) tasks.push(warmChat(baseURL, model));
  if (embeddingProvider === "ollama") {
    tasks.push(warmEmbed(baseURL, embeddingModel));
  }

  await Promise.all(tasks);
  console.log("[ollama-prewarm] all models warm");
}
