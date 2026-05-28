import fs from "node:fs/promises";
import path from "node:path";
import "dotenv/config";
import { kyronTenant } from "@/config/tenants/kyron.js";
import { makePayloadGateway } from "@/core/payload/gateway.js";

// Brain: decision-016 — migration one-shot dei portali .md residui in dev
// (Kyron/media/pending-schools-export/) verso Payload collection
// pending-schools. Idempotente: skip se lo slug esiste gia'.
//
// Uso:
//   cd studio-server
//   npx tsx scripts/migrate-portals-md-to-payload.ts [--dry-run]

const DEFAULT_DIR = path.resolve(
  process.cwd(),
  "../media/pending-schools-export",
);

function parseFrontmatter(raw: string): Record<string, unknown> {
  const match = raw.match(/^---\n([\s\S]*?)\n---/);
  if (!match) return {};
  const result: Record<string, unknown> = {};
  for (const line of match[1].split("\n")) {
    const idx = line.indexOf(": ");
    if (idx === -1) continue;
    const key = line.slice(0, idx).trim();
    const val = line.slice(idx + 2).trim();
    try {
      result[key] = JSON.parse(val);
    } catch {
      result[key] = val;
    }
  }
  return result;
}

function toPayloadDoc(data: Record<string, unknown>): Record<string, unknown> {
  return {
    slug: data.slug,
    nome: data.nome,
    status: data.status ?? "draft",
    collectedBy: data.collectedBy ?? "agent",
    sitoUfficiale: data.sitoUfficiale ?? "",
    codiceMeccanografico: data.codiceMeccanografico ?? "TBD",
    schoolAddress: data.schoolAddress ?? {},
    branding: {
      nome: (data.branding as { nome?: string })?.nome ?? data.nome,
      // logo string path → non importabile come Media ID. L'utente ricarichera'.
    },
    shipToSchool: Boolean(data.shipToSchool),
    shippingMethodLabel: data.shippingMethodLabel ?? "Consegna a scuola",
    shippingPriceEur: Number(data.shippingPriceEur ?? 0),
    catalog: data.catalog ?? { visibleSlugs: [], hiddenSlugs: [] },
    bundles: data.bundles ?? [],
  };
}

async function main(): Promise<void> {
  const dryRun = process.argv.includes("--dry-run");
  const dir = process.env.PENDING_SCHOOLS_EXPORT_DIR
    ? path.resolve(process.env.PENDING_SCHOOLS_EXPORT_DIR)
    : DEFAULT_DIR;

  console.log(`[migrate] source dir: ${dir}`);
  console.log(`[migrate] target: ${kyronTenant.payloadApiUrl}/pending-schools`);
  if (dryRun) console.log("[migrate] DRY RUN — no writes");

  let files: string[];
  try {
    files = await fs.readdir(dir);
  } catch {
    console.log("[migrate] source dir does not exist, nothing to migrate");
    return;
  }

  const mdFiles = files.filter((f) => f.endsWith(".md")).sort();
  console.log(`[migrate] found ${mdFiles.length} .md files`);
  if (mdFiles.length === 0) return;

  const gw = makePayloadGateway(kyronTenant);
  let created = 0;
  let skipped = 0;
  let failed = 0;

  for (const file of mdFiles) {
    const raw = await fs.readFile(path.join(dir, file), "utf-8");
    const data = parseFrontmatter(raw);
    const slug = String(data.slug ?? "");
    if (!slug) {
      console.log(`[migrate] ${file}: missing slug, skipping`);
      failed++;
      continue;
    }

    const existing = await gw.list("pending-schools", {
      where: { slug: { equals: slug } },
      limit: 1,
    });
    if (existing.data.length > 0) {
      console.log(`[migrate] ${slug}: exists in Payload, skipping`);
      skipped++;
      continue;
    }

    if (dryRun) {
      console.log(`[migrate] ${slug}: would create`);
      created++;
      continue;
    }

    try {
      const doc = toPayloadDoc(data);
      const res = await gw.create("pending-schools", doc);
      console.log(`[migrate] ${slug}: created (id=${res.data.id})`);
      created++;
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.error(`[migrate] ${slug}: FAILED — ${msg}`);
      failed++;
    }
  }

  console.log(
    `[migrate] done — created: ${created}, skipped: ${skipped}, failed: ${failed}`,
  );
}

main().catch((err) => {
  console.error("[migrate] fatal:", err);
  process.exit(1);
});
