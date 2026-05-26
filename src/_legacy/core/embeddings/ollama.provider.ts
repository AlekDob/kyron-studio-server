// Brain: 004-brain-module — BGE-M3 via Ollama HTTP API (default provider)

import type { EmbeddingProvider } from "./provider.js";

const DEFAULT_MODEL = "bge-m3";
const DEFAULT_BASE_URL = "http://localhost:11434";
const DIMENSIONS = 1024;

export function createOllamaEmbedding(opts?: {
  model?: string;
  baseURL?: string;
}): EmbeddingProvider {
  const model = opts?.model ?? DEFAULT_MODEL;
  const baseURL = opts?.baseURL ?? DEFAULT_BASE_URL;

  async function callOllama(input: string): Promise<number[]> {
    const res = await fetch(`${baseURL}/api/embed`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ model, input }),
    });
    if (!res.ok) {
      const text = await res.text();
      throw new Error(`Ollama embed failed (${res.status}): ${text}`);
    }
    const data = (await res.json()) as { embeddings: number[][] };
    return data.embeddings[0];
  }

  return {
    modelId: `ollama/${model}`,
    modelVersion: "1.0",
    dimensions: DIMENSIONS,

    async embed(text: string): Promise<number[]> {
      return callOllama(text);
    },

    async embedBatch(texts: string[]): Promise<number[][]> {
      const results: number[][] = [];
      for (const text of texts) {
        results.push(await callOllama(text));
      }
      return results;
    },
  };
}
