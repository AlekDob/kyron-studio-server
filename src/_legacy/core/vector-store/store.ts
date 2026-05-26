// Brain: 004-brain-module — adapter pattern, swap a Qdrant/Weaviate senza refactor

export interface ChunkRecord {
  id: string;
  documentId: string;
  orgId: string;
  chunkIndex: number;
  content: string;
  embedding: number[];
  modelId: string;
  modelVersion: string;
  dimensions: number;
  metadata: Record<string, unknown>;
  createdAt: string;
}

export interface SearchResult {
  chunkId: string;
  documentId: string;
  content: string;
  score: number;
  metadata: Record<string, unknown>;
}

export interface VectorStore {
  upsert(chunks: ChunkRecord[]): Promise<void>;
  query(
    orgId: string,
    embedding: number[],
    limit: number,
  ): Promise<SearchResult[]>;
  listByDocument(documentId: string): Promise<ChunkRecord[]>;
  deleteByDocument(documentId: string): Promise<void>;
}
