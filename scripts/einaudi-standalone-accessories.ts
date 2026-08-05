import "dotenv/config";
import { findPortalDoc } from "@/features/portals/reader.js";
import { getPortalsGateway, PORTALS_COLLECTION } from "@/features/portals/gateway.js";

// Brain: Einaudi — vendere i 3 accessori del kit anche SFUSI (richiesta Tommaso).
// Cover (coverone 29->23), Penna (dbp01-a35ri 49->39), Alimentatore (ps-25wo1cb 25->20)
// erano solo componenti kit (hiddenSlugs) => visibleInListings=false, non a scaffale.
// Gli sconti eur (~-20%) esistono gia' sul channel: manca solo la visibilita'.
// Fix: li sposto in visibleSlugs, iPad resta kit-only, productDiscounts invariati.
// Idempotente. Dopo: re-enable Einaudi (prod) per ripubblicare su Saleor.
//
// Uso (env PROD dal container studio-server):
//   npx tsx scripts/einaudi-standalone-accessories.ts --dry-run
//   npx tsx scripts/einaudi-standalone-accessories.ts

const SLUG = "einaudi";
const ACCESSORIES = ["coverone", "dbp01-a35ri", "ps-25wo1cb"];

async function main(): Promise<void> {
  const dryRun = process.argv.includes("--dry-run");
  const doc = await findPortalDoc(SLUG);
  if (!doc) throw new Error(`portale "${SLUG}" non trovato`);
  const current = (doc.catalog as Record<string, unknown>) ?? {};

  const currVisible = (current.visibleSlugs as string[]) ?? [];
  const currHidden = (current.hiddenSlugs as string[]) ?? [];

  const nextVisible = [...new Set([...currVisible, ...ACCESSORIES])];
  const nextHidden = currHidden.filter((s) => !ACCESSORIES.includes(s));

  const nextCatalog = {
    ...current,
    visibleSlugs: nextVisible,
    hiddenSlugs: nextHidden, // iPad resta nascosto (venduto solo nei kit)
    // heroOutsideBundle e' l'UNICA leva letta da enforceHeroOutsideBundle
    // (normalize.ts): se false, TUTTI i componenti kit (accessori inclusi)
    // vengono strappati da visibleSlugs. accessoriesOutsideBundle e' solo
    // informativo. Va a true per tenere gli accessori a scaffale; l'iPad
    // resta comunque nascosto perche' non e' in visibleSlugs.
    heroOutsideBundle: true,
    accessoriesOutsideBundle: true,
  };

  console.log("--- PRIMA ---");
  console.log("visibleSlugs:", JSON.stringify(currVisible));
  console.log("hiddenSlugs:", JSON.stringify(currHidden));
  console.log("accessoriesOutsideBundle:", current.accessoriesOutsideBundle);
  console.log("--- DOPO (target) ---");
  console.log("visibleSlugs:", JSON.stringify(nextCatalog.visibleSlugs));
  console.log("hiddenSlugs:", JSON.stringify(nextCatalog.hiddenSlugs));
  console.log("accessoriesOutsideBundle:", nextCatalog.accessoriesOutsideBundle);
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
  console.log("\nOK. Ora re-enable Einaudi (prod) per ripubblicare su Saleor.");
}

main().catch((err) => {
  console.error("[einaudi-standalone-accessories] errore:", err instanceof Error ? err.message : err);
  process.exit(1);
});
