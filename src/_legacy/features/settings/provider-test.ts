/**
 * Brain: 002-provider-connections
 * Test di connessione per provider: ping + eventuale conteggio modelli.
 * Nessuna chiamata di chat (decisione utente 2026-04-20): solo list-models.
 */

import type { ProviderConnection } from "./store.js";

export interface TestResult {
  ok: boolean;
  message: string;
  modelsCount?: number;
}

const DEFAULT_OLLAMA = "http://localhost:11434";

export async function testProviderConnection(
  providerId: string,
  conn: ProviderConnection,
): Promise<TestResult> {
  try {
    switch (providerId) {
      case "ollama":
        return await testOllama(conn.baseURL ?? DEFAULT_OLLAMA);
      case "openai":
        return await testOpenAICompat(
          conn.baseURL ?? "https://api.openai.com/v1",
          conn.apiKey,
          "OpenAI",
        );
      case "groq":
        return await testOpenAICompat(
          conn.baseURL ?? "https://api.groq.com/openai/v1",
          conn.apiKey,
          "Groq",
        );
      case "deepseek":
        return await testOpenAICompat(
          conn.baseURL ?? "https://api.deepseek.com/v1",
          conn.apiKey,
          "DeepSeek",
        );
      case "glm":
        return await testOpenAICompat(
          conn.baseURL ?? "https://open.bigmodel.cn/api/paas/v4",
          conn.apiKey,
          "GLM",
        );
      case "minimax":
        return await testOpenAICompat(
          conn.baseURL ?? "https://api.minimax.chat/v1",
          conn.apiKey,
          "MiniMax",
        );
      case "openai-compat":
        if (!conn.baseURL) {
          return { ok: false, message: "Base URL richiesto" };
        }
        return await testOpenAICompat(conn.baseURL, conn.apiKey, "OpenAI-compat");
      case "anthropic":
        return await testAnthropic(conn.apiKey);
      case "google":
        return await testGoogle(conn.apiKey);
      default:
        return { ok: false, message: `Provider non supportato: ${providerId}` };
    }
  } catch (err) {
    return { ok: false, message: err instanceof Error ? err.message : String(err) };
  }
}

async function testOllama(baseURL: string): Promise<TestResult> {
  const url = ollamaRoot(baseURL);
  const res = await fetch(`${url}/api/tags`);
  if (!res.ok) return { ok: false, message: `Ollama ${res.status}` };
  const data = (await res.json()) as { models?: unknown[] };
  const count = data.models?.length ?? 0;
  return { ok: true, message: `${count} modelli installati`, modelsCount: count };
}

// Accetta sia "http://localhost:11434" che "http://localhost:11434/api" —
// ritorna sempre la root (senza /api) per comporre `${root}/api/tags`.
function ollamaRoot(url: string): string {
  const trimmed = url.replace(/\/+$/, "");
  return trimmed.endsWith("/api") ? trimmed.slice(0, -4) : trimmed;
}

async function testOpenAICompat(
  baseURL: string,
  apiKey: string | undefined,
  label: string,
): Promise<TestResult> {
  if (!apiKey) return { ok: false, message: `API key richiesta per ${label}` };
  const res = await fetch(`${baseURL}/models`, {
    headers: { Authorization: `Bearer ${apiKey}` },
  });
  if (!res.ok) return { ok: false, message: `${label} ${res.status}` };
  const data = (await res.json()) as { data?: unknown[] };
  const count = data.data?.length ?? 0;
  return { ok: true, message: `${count} modelli accessibili`, modelsCount: count };
}

async function testAnthropic(apiKey: string | undefined): Promise<TestResult> {
  if (!apiKey) return { ok: false, message: "API key richiesta per Anthropic" };
  const res = await fetch("https://api.anthropic.com/v1/models", {
    headers: { "x-api-key": apiKey, "anthropic-version": "2023-06-01" },
  });
  if (!res.ok) return { ok: false, message: `Anthropic ${res.status}` };
  const data = (await res.json()) as { data?: unknown[] };
  const count = data.data?.length ?? 0;
  return { ok: true, message: `${count} modelli accessibili`, modelsCount: count };
}

async function testGoogle(apiKey: string | undefined): Promise<TestResult> {
  if (!apiKey) return { ok: false, message: "API key richiesta per Google" };
  const res = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models?key=${encodeURIComponent(apiKey)}`,
  );
  if (!res.ok) return { ok: false, message: `Google ${res.status}` };
  const data = (await res.json()) as { models?: unknown[] };
  const count = data.models?.length ?? 0;
  return { ok: true, message: `${count} modelli accessibili`, modelsCount: count };
}
