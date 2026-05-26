# Spaceship Server — Dev Quickstart

## Prerequisites
- Docker Desktop
- Node 18.17+

## Setup
1. `cp .env.example .env`
2. `docker compose up -d` (Postgres 16 + pgvector sulla porta 5433)
3. `npm install`
4. `npm run db:migrate:all` (applica schema + RLS)
5. `npm run seed:clients` (opzionale, 10k clienti fake)
6. `npm run dev` (server su :3030)

## Troubleshooting
- Port 5433 in uso: cambia mapping in `docker-compose.yml` e in `.env`.
- Extension `vector` not found: assicurati di usare image `pgvector/pgvector:pg16` (non `postgres:16`).
