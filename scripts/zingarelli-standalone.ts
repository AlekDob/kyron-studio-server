import "dotenv/config";
import { findPortalDoc } from "@/features/portals/reader.js";
import { getPortalsGateway, PORTALS_COLLECTION } from "@/features/portals/gateway.js";

// Brain: Zingarelli (Bari) — Tommaso vuole vendere SFUSI sia gli accessori sia
// l'iPad, non solo dentro i kit. Stessa meccanica del fix Einaudi
// ([[einaudi-standalone-accessories-hero-flag]]), ma qui rendiamo sfuso ANCHE
// l'iPad (ipada16), quindi lo mettiamo in visibleSlugs (a Einaudi restava kit-only).
//
// Perche' non si vedevano: enforceHeroOutsideBundle (normalize.ts) con
// heroOutsideBundle=false STRAPPA da visibleSlugs ogni prodotto che e'
// componente di un kit (iPad + accessori) e lo forza in hiddenSlugs. L'unica
// leva che conta e' heroOutsideBundle=true (accessoriesOutsideBundle e' solo
// informativo). Con true la funzione esce subito e la visibilita' regge.
//
// Uso (env PROD dal container studio-server):
//   npx tsx scripts/zingarelli-standalone.ts --dry-run
//   npx tsx scripts/zingarelli-standalone.ts

const SLUG = "zingarelli";
// iPad hero + 3 accessori, tutti resi acquistabili sfusi.
const STANDALONE = ["ipada16", "coverone", "dbp01-a35ri", "ps-25wo1cb"];

async function main(): Promise<void> {
  const dryRun = process.argv.includes("--dry-run");
  const doc = await findPortalDoc(SLUG);
  if (!doc) throw new Error(`portale "${SLUG}" non trovato`);
  const current = (doc.catalog as Record<string, unknown>) ?? {};

  const currVisible = (current.visibleSlugs as string[]) ?? [];
  const currHidden = (current.hiddenSlugs as string[]) ?? [];

  const nextVisible = [...new Set([...currVisible, ...STANDALONE])];
  const nextHidden = currHidden.filter((s) => !STANDALONE.includes(s));

  const nextCatalog = {
    ...current,
    visibleSlugs: nextVisible,
    hiddenSlugs: nextHidden,
    // Unica leva letta da enforceHeroOutsideBundle: con true non strappa piu' i
    // componenti kit da visibleSlugs (iPad e accessori restano a scaffale).
    heroOutsideBundle: true,
    accessoriesOutsideBundle: true,
  };

  console.log("--- PRIMA ---");
  console.log("visibleSlugs:", JSON.stringify(currVisible));
  console.log("hiddenSlugs:", JSON.stringify(currHidden));
  console.log("heroOutsideBundle:", current.heroOutsideBundle);
  console.log("accessoriesOutsideBundle:", current.accessoriesOutsideBundle);
  console.log("--- DOPO (target) ---");
  console.log("visibleSlugs:", JSON.stringify(nextCatalog.visibleSlugs));
  console.log("hiddenSlugs:", JSON.stringify(nextCatalog.hiddenSlugs));
  console.log("heroOutsideBundle:", nextCatalog.heroOutsideBundle);
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
  console.log("hiddenSlugs:", JSON.stringify(ac.hiddenSlugs));
  console.log("\nOK. Ora re-enable Zingarelli (prod) per ripubblicare su Saleor.");
}

main().catch((err) => {
  console.error("[zingarelli-standalone] errore:", err instanceof Error ? err.message : err);
  process.exit(1);
});
