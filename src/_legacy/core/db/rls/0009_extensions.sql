-- Extension prerequisites
CREATE EXTENSION IF NOT EXISTS pg_trgm;
CREATE EXTENSION IF NOT EXISTS pgcrypto;
CREATE EXTENSION IF NOT EXISTS vector;

-- GIN indexes on clients
CREATE INDEX IF NOT EXISTS idx_clients_tags
  ON clients USING GIN (tags);

CREATE INDEX IF NOT EXISTS idx_clients_metadata
  ON clients USING GIN (metadata);

CREATE INDEX IF NOT EXISTS idx_clients_name_trgm
  ON clients USING GIN (name gin_trgm_ops);

-- Vector index for brain (HNSW, bilanciato precisione/perf)
CREATE INDEX IF NOT EXISTS idx_brain_chunks_embedding
  ON brain_chunks USING hnsw (embedding vector_cosine_ops);
