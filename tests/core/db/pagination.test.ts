import { describe, it, expect } from "vitest";
import postgres from "postgres";
import "dotenv/config";

const connectionString = process.env.DATABASE_URL!;
const ORG_ID = process.env.SEED_ORG_ID ?? "00000000-0000-0000-0000-000000000001";

describe("clients cursor pagination", () => {
  it("keyset pagination is fast on 10k rows", async () => {
    const sql = postgres(connectionString, { max: 1 });
    await sql`SELECT set_config('app.org_id', ${ORG_ID}, false)`;
    await sql`SELECT set_config('app.user_id', '00000000-0000-0000-0000-000000000001', false)`;
    await sql`SELECT set_config('app.roles', 'admin', false)`;

    const start = Date.now();
    const firstPage = await sql<
      { id: string; name: string; last_interaction_at: Date | null }[]
    >`
      SELECT id, name, last_interaction_at
        FROM clients
       WHERE org_id = ${ORG_ID}
         AND deleted_at IS NULL
       ORDER BY last_interaction_at DESC, id DESC
       LIMIT 50
    `;
    const firstMs = Date.now() - start;
    expect(firstPage.length).toBe(50);
    expect(firstMs).toBeLessThan(100);

    const last = firstPage[firstPage.length - 1];
    const start2 = Date.now();
    const secondPage = await sql<
      { id: string; name: string; last_interaction_at: Date | null }[]
    >`
      SELECT id, name, last_interaction_at
        FROM clients
       WHERE org_id = ${ORG_ID}
         AND deleted_at IS NULL
         AND (last_interaction_at, id) < (${last.last_interaction_at}, ${last.id})
       ORDER BY last_interaction_at DESC, id DESC
       LIMIT 50
    `;
    const secondMs = Date.now() - start2;
    expect(secondPage.length).toBe(50);
    expect(secondMs).toBeLessThan(100);

    await sql.end();
  }, 10000);

  it("fuzzy search via pg_trgm is fast", async () => {
    const sql = postgres(connectionString, { max: 1 });
    const start = Date.now();
    const results = await sql<{ id: string; name: string }[]>`
      SELECT id, name
        FROM clients
       WHERE org_id = ${ORG_ID}
         AND name % 'Group'
       LIMIT 20
    `;
    const ms = Date.now() - start;
    expect(ms).toBeLessThan(200);
    // Smoke: pg_trgm must return array (empty or not)
    expect(Array.isArray(results)).toBe(true);
    await sql.end();
  }, 10000);
});
