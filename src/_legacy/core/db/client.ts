import postgres from "postgres";
import { drizzle } from "drizzle-orm/postgres-js";
import { sql } from "drizzle-orm";
import * as schema from "./schema/index.js";

// Runtime pool uses spaceship_app (NOSUPERUSER, NOBYPASSRLS) so RLS is enforced.
// Falls back to DATABASE_URL when DATABASE_URL_APP is missing, to keep the dev
// boot resilient; in production DATABASE_URL_APP must be set.
const connectionString = process.env.DATABASE_URL_APP ?? process.env.DATABASE_URL;
if (!connectionString) throw new Error("DATABASE_URL_APP / DATABASE_URL non definiti");

export const pgClient = postgres(connectionString, {
  max: 20,
  idle_timeout: 30,
  connect_timeout: 10,
  prepare: false,
});

export const db = drizzle(pgClient, { schema });

export type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];

export type TenantContext = {
  orgId: string;
  userId: string;
  roles: string[];
};

/**
 * Opens a transaction and sets tenant-scoped GUC vars that RLS policies read.
 * `set_config(name, value, true)` = transaction-local scope (equivalent to SET LOCAL).
 * Parameters are bound via prepared statement (no SQL injection).
 */
export async function txWithTenant<T>(
  ctx: TenantContext,
  fn: (tx: Tx) => Promise<T>,
): Promise<T> {
  return db.transaction(async (tx) => {
    const rolesCsv = ctx.roles.join(",");
    await tx.execute(sql`
      SELECT
        set_config('app.org_id', ${ctx.orgId}, true),
        set_config('app.user_id', ${ctx.userId}, true),
        set_config('app.roles', ${rolesCsv}, true)
    `);
    return fn(tx);
  });
}
