// Brain: 004-brain-module — OpenAI text-embedding-3-small (opt-in fallback)

import type { EmbeddingProvider } from "./provider.js";

const DEFAULT_MODEL = "text-embedding-3-small";
const DIMENSIONS = 1536;

export function createOpenAIEmbedding(opts: {
  apiKey: string;
  model?: string;
}): EmbeddingProvider {
  const model = opts.model ?? DEFAULT_MODEL;
  const apiKey = opts.apiKey;

  async function callOpenAI(input: string[]): Promise<number[][]> {
    const res = await fetch("https://api.openai.com/v1/embeddings", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({ model, input }),
    });
    if (!res.ok) {
      const text = await res.text();
      throw new Error(`OpenAI embed failed (${res.status}): ${text}`);
    }
    const data = (await res.json()) as {
      data: Array<{ embedding: number[] }>;
    };
    return data.data.map((d) => d.embedding);
  }

  return {
    modelId: `openai/${model}`,
    modelVersion: "1.0",
    dimensions: DIMENSIONS,

    async embed(text: string): Promise<number[]> {
      const [result] = await callOpenAI([text]);
      return result;
    },

    async embedBatch(texts: string[]): Promise<number[][]> {
      return callOpenAI(texts);
    },
  };
}
