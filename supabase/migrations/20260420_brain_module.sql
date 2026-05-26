-- Brain: 004-brain-module — brain_documents + brain_chunks + HNSW + RLS

create extension if not exists vector;

create table brain_documents (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null,
  title text not null,
  source_type text not null check (source_type in ('pdf','docx','md','txt','agent_memory')),
  source_metadata jsonb default '{}',
  created_by_user_id uuid,
  created_by_agent_id text,
  is_ephemeral boolean default false,
  expires_at timestamptz,
  created_at timestamptz default now()
);

create table brain_chunks (
  id uuid primary key default gen_random_uuid(),
  document_id uuid not null references brain_documents on delete cascade,
  org_id uuid not null,
  chunk_index int not null,
  content text not null,
  embedding vector(1024) not null,
  model_id text not null,
  model_version text not null,
  dimensions int not null,
  metadata jsonb default '{}',
  created_at timestamptz default now()
);

create index brain_chunks_embedding_idx on brain_chunks
  using hnsw (embedding vector_cosine_ops);
create index brain_chunks_org_idx on brain_chunks (org_id);
create index brain_docs_org_idx on brain_documents (org_id);

-- RLS
alter table brain_documents enable row level security;
alter table brain_chunks enable row level security;

create policy "brain_docs_read_org" on brain_documents
  for select using (org_id = (auth.jwt() ->> 'org_id')::uuid);

create policy "brain_docs_write_role" on brain_documents
  for insert with check (
    org_id = (auth.jwt() ->> 'org_id')::uuid
    and (auth.jwt() ->> 'role') in ('admin','brain_writer')
  );

create policy "brain_docs_delete_role" on brain_documents
  for delete using (
    org_id = (auth.jwt() ->> 'org_id')::uuid
    and (auth.jwt() ->> 'role') in ('admin','brain_writer')
  );

create policy "brain_chunks_read_org" on brain_chunks
  for select using (org_id = (auth.jwt() ->> 'org_id')::uuid);

create policy "brain_chunks_write_role" on brain_chunks
  for insert with check (
    org_id = (auth.jwt() ->> 'org_id')::uuid
    and (auth.jwt() ->> 'role') in ('admin','brain_writer')
  );

create policy "brain_chunks_delete_role" on brain_chunks
  for delete using (
    org_id = (auth.jwt() ->> 'org_id')::uuid
    and (auth.jwt() ->> 'role') in ('admin','brain_writer')
  );

-- RPC per vector search (cosine similarity)
create or replace function brain_search(
  query_embedding vector(1024),
  query_org_id uuid,
  match_count int default 5
)
returns table (
  id uuid,
  document_id uuid,
  content text,
  similarity float,
  metadata jsonb
)
language plpgsql
as $$
begin
  return query
  select
    bc.id,
    bc.document_id,
    bc.content,
    1 - (bc.embedding <=> query_embedding) as similarity,
    bc.metadata
  from brain_chunks bc
  where bc.org_id = query_org_id
  order by bc.embedding <=> query_embedding
  limit match_count;
end;
$$;
