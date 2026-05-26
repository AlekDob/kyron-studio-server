import { anthropic } from "@ai-sdk/anthropic";
import { createOpenAI } from "@ai-sdk/openai";
import { google } from "@ai-sdk/google";
import { createOllama } from "ollama-ai-provider";
import type { LanguageModel } from "ai";
import { resolveProcessConfig, type ModelConfig } from "@/features/settings/store.js";

/**
 * Brain: studio-futuro-mono
 * Model routing per-processo. Legge Settings persistenti e costruisce il LanguageModel.
 * Fallback: env LLM_PROVIDER se nessun config in settings.json.
 */

interface EnvPreset {
  provider: ModelConfig["provider"];
  model: string;
  baseURL?: string;
  apiKey?: string;
}

function envFallback(): EnvPreset | null {
  const p = (process.env.LLM_PROVIDER ?? "").toLowerCase();
  const model = process.env.LLM_MODEL;
  if (!p || !model) return null;
  return {
    provider: p as EnvPreset["provider"],
    model,
    baseURL: process.env.LLM_BASE_URL,
    apiKey: process.env.LLM_API_KEY,
  };
}

function providerKey(provider: string): string | undefined {
  switch (provider) {
    case "anthropic":
      return process.env.ANTHROPIC_API_KEY;
    case "openai":
      return process.env.OPENAI_API_KEY;
    case "google":
      return process.env.GOOGLE_GENERATIVE_AI_API_KEY;
    case "groq":
      return process.env.GROQ_API_KEY;
    case "glm":
      return process.env.GLM_API_KEY;
    case "minimax":
      return process.env.MINIMAX_API_KEY;
    case "deepseek":
      return process.env.DEEPSEEK_API_KEY;
    default:
      return undefined;
  }
}

function providerBaseURL(provider: string): string | undefined {
  switch (provider) {
    case "glm":
      return "https://open.bigmodel.cn/api/paas/v4";
    case "minimax":
      return "https://api.minimax.chat/v1";
    case "deepseek":
      return "https://api.deepseek.com/v1";
    case "groq":
      return "https://api.groq.com/openai/v1";
    case "ollama":
      return "http://localhost:11434/api";
    default:
      return undefined;
  }
}

// Brain: 002-provider-connections
// L'utente salva la root di Ollama (es. http://localhost:11434) perche' e'
// quella che si vede nella UI e che Ollama stesso stampa al boot. Ma
// `ollama-ai-provider` appende `/chat` direttamente al baseURL, quindi serve
// aggiungere `/api`. Questa funzione garantisce idempotenza: sia "…" che
// "…/api" sono accettati.
function normalizeOllamaBaseURL(url: string): string {
  const trimmed = url.replace(/\/+$/, "");
  return trimmed.endsWith("/api") ? trimmed : `${trimmed}/api`;
}

// Brain: gemma4-thinking-fix
// ollama-ai-provider@1.x non conosce il campo `thinking` che Ollama 0.21+
// ritorna per i thinking models (gemma4, deepseek-r1, qwq, ecc.). Risultato:
// il modello genera reasoning esteso e la lib scarta tutto, content vuoto.
// Workaround: intercettiamo la fetch e iniettiamo `think: false` per forzare
// il modello a rispondere direttamente. Innocuo per modelli non-thinking.
//
// Brain: ollama-eval-duration-fix
// Alcuni modelli (gemma4 in particolare) talvolta ritornano response NDJSON
// streaming senza `eval_duration`, causando zod AI_TypeValidationError nel
// provider. Intercettiamo la response e iniettiamo eval_duration/prompt_eval_duration
// a 0 se mancanti. Valori zero non alterano la logica downstream — sono solo
// metriche prestazionali per log/telemetria.
const ollamaFetch: typeof fetch = async (input, init) => {
  if (init?.body && typeof init.body === "string") {
    try {
      const body = JSON.parse(init.body) as Record<string, unknown>;
      if (!("think" in body)) body.think = false;
      init = { ...init, body: JSON.stringify(body) };
    } catch {
      // body non JSON: lascia passare invariato
    }
  }
  const res = await fetch(input, init);
  if (!res.ok || !res.body) return res;

  const contentType = res.headers.get("content-type") ?? "";
  const isNdjson =
    contentType.includes("application/x-ndjson") ||
    contentType.includes("application/json-stream");
  const isJson = contentType.includes("application/json");

  if (!isNdjson && !isJson) return res;

  const text = await res.text();

  const patched = isNdjson
    ? text
        .split("\n")
        .map((line) => (line.trim() ? patchOllamaChunk(line) : line))
        .join("\n")
    : patchOllamaChunk(text);

  return new Response(patched, {
    status: res.status,
    statusText: res.statusText,
    headers: res.headers,
  });
};

function patchOllamaChunk(raw: string): string {
  try {
    const obj = JSON.parse(raw) as Record<string, unknown>;
    // `done: true` chunk e' quello che deve contenere eval_duration
    // ma a volte manca anche da chunk intermedi. Iniettiamo a zero.
    if (obj.eval_duration === undefined) obj.eval_duration = 0;
    if (obj.prompt_eval_duration === undefined) obj.prompt_eval_duration = 0;
    if (obj.total_duration === undefined) obj.total_duration = 0;
    if (obj.load_duration === undefined) obj.load_duration = 0;
    if (obj.eval_count === undefined) obj.eval_count = 0;
    if (obj.prompt_eval_count === undefined) obj.prompt_eval_count = 0;
    return JSON.stringify(obj);
  } catch {
    return raw; // non-JSON chunk, lascia passare
  }
}

function build(cfg: ModelConfig): LanguageModel {
  const apiKey = cfg.apiKey || providerKey(cfg.provider);
  const baseURL = cfg.baseURL || providerBaseURL(cfg.provider);

  switch (cfg.provider) {
    case "anthropic":
      return anthropic(cfg.model);
    case "openai":
      return createOpenAI({ apiKey }).chat(cfg.model);
    case "google":
      return google(cfg.model);
    case "ollama": {
      const ollamaURL = normalizeOllamaBaseURL(
        baseURL ?? "http://localhost:11434",
      );
      // simulateStreaming: la lib fa una chiamata non-streaming a Ollama,
      // ottiene il JSON con `message.tool_calls` strutturato, poi lo spezza
      // in chunks streaming. Necessario perche' il parser streaming di
      // ollama-ai-provider@1.x non riconosce il formato tool-call di
      // gemma4 (e altri modelli che usano il protocollo JSON-native invece
      // del vecchio `<tool_call>` tag). Vedi gotcha ollama-thinking-models.
      return createOllama({ baseURL: ollamaURL, fetch: ollamaFetch })(
        cfg.model,
        { simulateStreaming: true },
      );
    }
    default:
      return createOpenAI({ apiKey, baseURL }).chat(cfg.model);
  }
}

export async function resolveForProcess(
  orgId: string,
  moduleId: string,
  processId: string,
): Promise<LanguageModel | null> {
  const cfg = await resolveProcessConfig(orgId, moduleId, processId);
  if (cfg) {
    try {
      return build(cfg);
    } catch (err) {
      console.error(
        `[llm] build failed for ${orgId}/${moduleId}/${processId}:`,
        err,
      );
    }
  }
  const env = envFallback();
  if (env) {
    try {
      return build({
        provider: env.provider,
        model: env.model,
        apiKey: env.apiKey,
        baseURL: env.baseURL,
      });
    } catch (err) {
      console.error("[llm] env fallback failed:", err);
    }
  }
  return null;
}

export async function hasAnyLlm(orgId: string): Promise<boolean> {
  const m = await resolveForProcess(orgId, "accounting", "_default");
  return m !== null;
}
