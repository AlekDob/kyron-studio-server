import { createOpenAI } from "@ai-sdk/openai";
import type { LanguageModelV1 } from "ai";
import {
  getProcessConfig,
  getProviderConnection,
  type ProviderId,
} from "./store.js";

const OPENAI_COMPAT_BASES: Partial<Record<ProviderId, string>> = {
  openai: "https://api.openai.com/v1",
  mistral: "https://api.mistral.ai/v1",
  groq: "https://api.groq.com/openai/v1",
  deepseek: "https://api.deepseek.com/v1",
  glm: "https://open.bigmodel.cn/api/paas/v4",
  minimax: "https://api.minimaxi.chat/v1",
};

export interface ResolvedModel {
  model: LanguageModelV1;
  providerId: ProviderId;
  modelId: string;
  source: "settings" | "env-fallback";
}

export async function resolveModel(
  moduleId: string,
  processId: string,
  envFallback: { providerId: ProviderId; modelId: string } = {
    providerId: "openai",
    modelId: "gpt-4o",
  },
): Promise<ResolvedModel> {
  const routed = await getProcessConfig(moduleId, processId);
  const providerId = (routed?.provider ?? envFallback.providerId) as ProviderId;
  const modelId = routed?.model ?? envFallback.modelId;
  const conn = await getProviderConnection(providerId);

  const apiKey = conn?.apiKey ?? envApiKeyFor(providerId);
  const baseURL = conn?.baseURL ?? OPENAI_COMPAT_BASES[providerId];

  if (providerId === "openai" || isOpenAICompat(providerId)) {
    if (!apiKey) {
      throw new Error(
        `Provider ${providerId} non configurato: API key mancante (Settings -> Provider AI).`,
      );
    }
    const client = createOpenAI({ apiKey, baseURL });
    // gpt-5* / o* mandano reasoning_effort di default. Su /v1/chat/completions
    // (AI SDK 4) gli strumenti vengono rifiutati, es. gpt-5.6-luna + Livia.
    // OpenAI chiede reasoning_effort=none oppure /v1/responses. Restiamo su
    // completions e spegniamo il ragionamento: i nostri agenti vivono di tool.
    const reasoningFamily =
      modelId.startsWith("gpt-5") || modelId.startsWith("o");
    return {
      model: client(
        modelId,
        reasoningFamily
          ? { reasoningEffort: "none" as "low" }
          : undefined,
      ),
      providerId,
      modelId,
      source: routed ? "settings" : "env-fallback",
    };
  }

  throw new Error(
    `Provider ${providerId} riconosciuto in Settings ma non ancora supportato a runtime. Usa OpenAI o un provider OpenAI-compatible (Mistral/Groq/DeepSeek/GLM/MiniMax/openai-compat).`,
  );
}

function isOpenAICompat(providerId: ProviderId): boolean {
  return (
    providerId === "mistral" ||
    providerId === "groq" ||
    providerId === "deepseek" ||
    providerId === "glm" ||
    providerId === "minimax" ||
    providerId === "openai-compat"
  );
}

function envApiKeyFor(providerId: ProviderId): string | undefined {
  switch (providerId) {
    case "openai":
      return process.env.OPENAI_API_KEY;
    case "mistral":
      return process.env.MISTRAL_API_KEY;
    case "groq":
      return process.env.GROQ_API_KEY;
    case "deepseek":
      return process.env.DEEPSEEK_API_KEY;
    case "anthropic":
      return process.env.ANTHROPIC_API_KEY;
    case "google":
      return process.env.GOOGLE_GENERATIVE_AI_API_KEY;
    default:
      return undefined;
  }
}
