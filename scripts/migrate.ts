import "dotenv/config";
import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import postgres from "postgres";
import { drizzle } from "drizzle-orm/postgres-js";
import { migrate as drizzleMigrate } from "drizzle-orm/postgres-js/migrator";

const connectionString = process.env.DATABASE_URL;
if (!connectionString) throw new Error("DATABASE_URL non definito");

async function main(): Promise<void> {
  const sql = postgres(connectionString!, { max: 1 });
  const db = drizzle(sql);

  console.log("[migrate] applying drizzle migrations…");
  await drizzleMigrate(db, { migrationsFolder: "./src/core/db/migrations" });

  console.log("[migrate] applying raw SQL migrations…");
  await sql`CREATE TABLE IF NOT EXISTS __raw_migrations (
    name text PRIMARY KEY,
    applied_at timestamptz NOT NULL DEFAULT now()
  )`;

  const dir = "./src/core/db/rls";
  const files = (await readdir(dir)).filter((f) => f.endsWith(".sql")).sort();

  for (const file of files) {
    const already = await sql`SELECT 1 FROM __raw_migrations WHERE name = ${file}`;
    if (already.length > 0) {
      console.log(`[migrate] skip ${file} (already applied)`);
      continue;
    }
    const content = await readFile(join(dir, file), "utf8");
    console.log(`[migrate] applying ${file}…`);
    await sql.unsafe(content);
    await sql`INSERT INTO __raw_migrations (name) VALUES (${file})`;
  }

  await sql.end();
  console.log("[migrate] done.");
}

main().catch((err) => {
  console.error("[migrate] FAILED:", err);
  process.exit(1);
});
