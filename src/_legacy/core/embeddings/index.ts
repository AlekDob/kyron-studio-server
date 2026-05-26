// Brain: 004-brain-module — embedding resolver, adapter pattern

import type { EmbeddingProvider } from "./provider.js";
import { createOllamaEmbedding } from "./ollama.provider.js";
import { createOpenAIEmbedding } from "./openai.provider.js";

export type { EmbeddingProvider, EmbeddingProviderConfig } from "./provider.js";

let cached: EmbeddingProvider | null = null;

export function resolveEmbeddingProvider(): EmbeddingProvider {
  if (cached) return cached;

  const provider = process.env.EMBEDDING_PROVIDER ?? "ollama";

  if (provider === "openai") {
    const apiKey = process.env.OPENAI_API_KEY;
    if (!apiKey) throw new Error("OPENAI_API_KEY required for openai embeddings");
    cached = createOpenAIEmbedding({ apiKey });
  } else {
    cached = createOllamaEmbedding({
      model: process.env.EMBEDDING_MODEL,
      baseURL: process.env.OLLAMA_BASE_URL,
    });
  }

  console.log(`[embeddings] using ${cached.modelId} (${cached.dimensions}d)`);
  return cached;
}

export function resetEmbeddingProvider(): void {
  cached = null;
}
