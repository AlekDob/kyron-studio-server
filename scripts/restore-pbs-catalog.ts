import "dotenv/config";
import { findPortalDoc } from "@/features/portals/reader.js";
import { getPortalsGateway, PORTALS_COLLECTION } from "@/features/portals/gateway.js";

// Brain: risoluzione PBS (parte 2) — ripristina i prodotti sfusi a prezzo pieno.
// Il doc era stato normalizzato a `visibleSlugs:['dbp01-a35ri']` (heroOutsideBundle
// =false => iPad/cover/alimentatore tolti dal catalogo, solo bundle). Scelta Alek
// (2026-06-30, opzione A): iPad a prezzo pieno sfuso (sconto solo nel kit) +
// cover/alimentatore a listino + Pencil/AppleCare scontati. => tutti e 5 a
// catalogo, heroOutsideBundle + accessoriesOutsideBundle = true. productDiscounts
// (75/44) e bundle invariati. Idempotente. Dopo: re-enable per ri-pubblicare su Saleor.
//
// Uso (env PROD dal container studio-server):
//   npx tsx scripts/restore-pbs-catalog.ts --dry-run
//   npx tsx scripts/restore-pbs-catalog.ts

const SLUG = "accademia-professionale-pbs";
const VISIBLE = [
  "applecare-plus-ipad-a16",
  "coverone",
  "ipada16",
  "dbp01-a35ri",
  "ps-25wo1cb",
];

async function main(): Promise<void> {
  const dryRun = process.argv.includes("--dry-run");
  const doc = await findPortalDoc(SLUG);
  if (!doc) throw new Error(`portale "${SLUG}" non trovato`);
  const current = (doc.catalog as Record<string, unknown>) ?? {};

  const nextCatalog = {
    ...current,
    visibleSlugs: VISIBLE,
    hiddenSlugs: [], // normalize ri-aggiunge AppleCare come protection plan
    heroOutsideBundle: true,
    accessoriesOutsideBundle: true,
  };

  console.log("--- PRIMA ---");
  console.log("visibleSlugs:", JSON.stringify(current.visibleSlugs));
  console.log("hiddenSlugs:", JSON.stringify(current.hiddenSlugs));
  console.log("heroOutsideBundle:", current.heroOutsideBundle, "| accessoriesOutsideBundle:", current.accessoriesOutsideBundle);
  console.log("--- DOPO (target) ---");
  console.log("visibleSlugs:", JSON.stringify(nextCatalog.visibleSlugs));
  console.log("heroOutsideBundle:", nextCatalog.heroOutsideBundle, "| accessoriesOutsideBundle:", nextCatalog.accessoriesOutsideBundle);
  console.log("productDiscounts (invariati):", JSON.stringify(current.productDiscounts));

  if (dryRun) {
    console.log("\n[dry-run] nessuna modifica applicata.");
    return;
  }

  const gw = getPortalsGateway();
  await gw.update(PORTALS_COLLECTION, String(doc.id), { catalog: nextCatalog });

  const after = await findPortalDoc(SLUG);
  const ac = (after?.catalog as Record<string, unknown>) ?? {};
  console.log("\n--- APPLICATO ---");
  console.log("visibleSlugs:", JSON.stringify(ac.visibleSlugs));
  console.log("heroOutsideBundle:", ac.heroOutsideBundle, "| accessoriesOutsideBundle:", ac.accessoriesOutsideBundle);
  console.log("\nOK. Ora re-enable PBS per ri-pubblicare su Saleor.");
}

main().catch((err) => {
  console.error("[restore-pbs-catalog] errore:", err instanceof Error ? err.message : err);
  process.exit(1);
});
