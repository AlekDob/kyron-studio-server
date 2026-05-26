// Brain: 004-brain-module — adapter pattern, nessun SDK diretto fuori da qui

export interface EmbeddingProvider {
  readonly modelId: string;
  readonly modelVersion: string;
  readonly dimensions: number;
  embed(text: string): Promise<number[]>;
  embedBatch(texts: string[]): Promise<number[][]>;
}

export interface EmbeddingProviderConfig {
  provider: "ollama" | "openai";
  model?: string;
  apiKey?: string;
  baseURL?: string;
}
