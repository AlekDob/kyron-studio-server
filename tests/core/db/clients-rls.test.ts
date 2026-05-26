import { describe, it, expect } from "vitest";
import postgres from "postgres";
import "dotenv/config";

const ownerUrl = process.env.DATABASE_URL!;
const appUrl = process.env.DATABASE_URL_APP!;

const ORG_A = "00000000-0000-0000-0000-0000000000aa";
const ORG_B = "00000000-0000-0000-0000-0000000000bb";

/**
 * RLS tenant isolation test.
 *
 * Why two connections:
 *  - Postgres bypasses RLS for the table *owner* (and for any BYPASSRLS role).
 *    The default `postgres` user in dev is superuser + owner, so `SET
 *    row_security = on` is not enough. We use a dedicated application role
 *    `spaceship_app` (NOSUPERUSER, NOBYPASSRLS, not the owner) — created by
 *    migration 0010_app_role.sql — to actually exercise the RLS policies.
 *  - Setup/cleanup run as the owner (ownerUrl) with
 *    `session_replication_role = 'replica'` to bypass both RLS and triggers
 *    for deterministic fixture management.
 */
describe("clients RLS tenant isolation", () => {
  it("org A cannot see org B clients", async () => {
    // Setup fixtures as owner (bypass RLS + triggers).
    const adminSql = postgres(ownerUrl, { max: 1 });
    await adminSql`SET session_replication_role = 'replica'`;
    await adminSql`
      INSERT INTO clients (org_id, name, created_by, updated_by)
      VALUES (${ORG_A}, 'RLS Test Client A', gen_random_uuid(), gen_random_uuid()),
             (${ORG_B}, 'RLS Test Client B', gen_random_uuid(), gen_random_uuid())
      ON CONFLICT DO NOTHING
    `;
    await adminSql`SET session_replication_role = 'origin'`;
    await adminSql.end();

    // Test visibility as the application role (RLS actually enforced).
    const sql = postgres(appUrl, { max: 1 });
    try {
      await sql`SELECT set_config('app.org_id', ${ORG_A}, false)`;
      await sql`SELECT set_config(
        'app.user_id',
        '00000000-0000-0000-0000-000000000001',
        false
      )`;
      await sql`SELECT set_config('app.roles', 'admin', false)`;

      const visibleToA = await sql<{ name: string }[]>`
        SELECT name
          FROM clients
         WHERE name IN ('RLS Test Client A', 'RLS Test Client B')
      `;
      const names = visibleToA.map((r) => r.name);
      expect(names).toContain("RLS Test Client A");
      expect(names).not.toContain("RLS Test Client B");
    } finally {
      await sql.end();
      // Cleanup fixtures as owner.
      const cleanupSql = postgres(ownerUrl, { max: 1 });
      await cleanupSql`SET session_replication_role = 'replica'`;
      await cleanupSql`
        DELETE FROM clients
         WHERE name IN ('RLS Test Client A', 'RLS Test Client B')
      `;
      await cleanupSql`SET session_replication_role = 'origin'`;
      await cleanupSql.end();
    }
  }, 15000);
});
