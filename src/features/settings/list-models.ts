import type { ProviderConnection } from "./store.js";

export interface ModelsResult {
  models: string[];
  error?: string;
}

export async function listProviderModels(
  providerId: string,
  conn: ProviderConnection,
): Promise<ModelsResult> {
  try {
    switch (providerId) {
      case "ollama":
        return await listOllamaModels(conn.baseURL ?? "http://localhost:11434");
      case "openai":
        return await listOpenAICompat(
          conn.baseURL ?? "https://api.openai.com/v1",
          conn.apiKey,
        );
      case "mistral":
        return await listOpenAICompat(
          conn.baseURL ?? "https://api.mistral.ai/v1",
          conn.apiKey,
        );
      case "groq":
        return await listOpenAICompat(
          conn.baseURL ?? "https://api.groq.com/openai/v1",
          conn.apiKey,
        );
      case "deepseek":
        return await listOpenAICompat(
          conn.baseURL ?? "https://api.deepseek.com/v1",
          conn.apiKey,
        );
      case "glm":
        return await listOpenAICompat(
          conn.baseURL ?? "https://open.bigmodel.cn/api/paas/v4",
          conn.apiKey,
        );
      case "minimax":
        return await listOpenAICompat(
          conn.baseURL ?? "https://api.minimaxi.chat/v1",
          conn.apiKey,
        );
      case "openai-compat":
        if (!conn.baseURL) return { models: [], error: "Base URL richiesto" };
        return await listOpenAICompat(conn.baseURL, conn.apiKey);
      case "anthropic":
        return await listAnthropic(conn.apiKey);
      case "google":
        return await listGoogle(conn.apiKey);
      default:
        return { models: [], error: `Provider non supportato: ${providerId}` };
    }
  } catch (err) {
    return {
      models: [],
      error: err instanceof Error ? err.message : String(err),
    };
  }
}

async function listOpenAICompat(
  baseURL: string,
  apiKey: string | undefined,
): Promise<ModelsResult> {
  if (!apiKey) return { models: [], error: "API key richiesta" };
  const res = await fetch(`${baseURL}/models`, {
    headers: { Authorization: `Bearer ${apiKey}` },
  });
  if (!res.ok) return { models: [], error: `HTTP ${res.status}` };
  const data = (await res.json()) as { data?: Array<{ id?: string }> };
  const models = (data.data ?? [])
    .map((m) => m.id)
    .filter((id): id is string => Boolean(id))
    .sort();
  return { models };
}

async function listAnthropic(apiKey: string | undefined): Promise<ModelsResult> {
  if (!apiKey) return { models: [], error: "API key richiesta" };
  const res = await fetch("https://api.anthropic.com/v1/models", {
    headers: { "x-api-key": apiKey, "anthropic-version": "2023-06-01" },
  });
  if (!res.ok) return { models: [], error: `HTTP ${res.status}` };
  const data = (await res.json()) as { data?: Array<{ id?: string }> };
  const models = (data.data ?? [])
    .map((m) => m.id)
    .filter((id): id is string => Boolean(id))
    .sort();
  return { models };
}

async function listGoogle(apiKey: string | undefined): Promise<ModelsResult> {
  if (!apiKey) return { models: [], error: "API key richiesta" };
  const res = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models?key=${encodeURIComponent(apiKey)}`,
  );
  if (!res.ok) return { models: [], error: `HTTP ${res.status}` };
  const data = (await res.json()) as {
    models?: Array<{ name?: string; supportedGenerationMethods?: string[] }>;
  };
  const models = (data.models ?? [])
    .filter((m) => m.supportedGenerationMethods?.includes("generateContent"))
    .map((m) => m.name?.replace(/^models\//, ""))
    .filter((id): id is string => Boolean(id))
    .sort();
  return { models };
}

async function listOllamaModels(baseURL: string): Promise<ModelsResult> {
  const trimmed = baseURL.replace(/\/+$/, "");
  const root = trimmed.endsWith("/api") ? trimmed.slice(0, -4) : trimmed;
  const res = await fetch(`${root}/api/tags`);
  if (!res.ok) return { models: [], error: `HTTP ${res.status}` };
  const data = (await res.json()) as { models?: Array<{ name?: string }> };
  const models = (data.models ?? [])
    .map((m) => m.name)
    .filter((id): id is string => Boolean(id))
    .sort();
  return { models };
}
