import "dotenv/config";
import { getPortal } from "@/features/portals/reader.js";
import {
  patchPortalCatalog,
  updateBundleInPortal,
  type BundleInput,
} from "@/features/portals/writer.js";

// Brain: gotcha-portal-kit-slug-mismatch — risoluzione one-shot del portale PBS
// (accademia-professionale-pbs). Il doc Payload ha 3 valori regrediti nella
// migrazione .md->Payload (WS5) che bloccano il re-publish (enable -> normalize):
//   1. kit-pbs comp `ipada16`: selection fixed variantSku "ipada16" (slug, NON
//      uno SKU reale) -> deve essere by-attribute colore + capacita 128gb.
//   2. sconto applecare-plus-ipad-a16: eur 4 -> eur 75 (prezzo FINALE, listino 79).
//   3. sconto dbp01-a35ri: eur 0 -> eur 44 (prezzo FINALE, listino 49).
// Valori verificati 1:1 contro Saleor PROD (api.kyronedu.it) il 2026-06-30 e
// contro ecommerce/documentation/schools/accademia-professionale-pbs.md.
//
// Patcha SOLO catalog.productDiscounts e i components di kit-pbs: nome del kit,
// finalPriceEur, visibleSlugs, indirizzo ecc. restano intatti (il rename fatto
// dall'operatore in Studio e' preservato). Idempotente: rilanciabile.
//
// Uso (env PROD: TENANT_KYRON_PAYLOAD_API_URL + _API_KEY del server prod):
//   cd studio-server
//   npx tsx scripts/fix-pbs-descriptor.ts --dry-run   # mostra solo il diff
//   npx tsx scripts/fix-pbs-descriptor.ts             # applica

const SLUG = "accademia-professionale-pbs";
const BUNDLE_SLUG = "kit-pbs";

const FIXED_DISCOUNTS = [
  { slug: "applecare-plus-ipad-a16", capacity: null, kind: "eur" as const, value: 75 },
  { slug: "dbp01-a35ri", capacity: null, kind: "eur" as const, value: 44 },
];

const FIXED_COMPONENTS: BundleInput["components"] = [
  {
    productSlug: "ipada16",
    selection: { kind: "by-attribute", attribute: "colore", valueFilter: { capacita: "128gb" } },
  },
  { productSlug: "coverone", selection: { kind: "variant", variantSku: "CoverONE" } },
  { productSlug: "ps-25wo1cb", selection: { kind: "variant", variantSku: "PS-25WO1CB" } },
];

async function main(): Promise<void> {
  const dryRun = process.argv.includes("--dry-run");
  const portal = await getPortal(SLUG);
  if (!portal) throw new Error(`portale "${SLUG}" non trovato (env Payload giusto?)`);

  const bundle = portal.bundles.find((b) => b.slug === BUNDLE_SLUG);
  if (!bundle) throw new Error(`bundle "${BUNDLE_SLUG}" non trovato su ${SLUG}`);

  console.log(`Portale: ${portal.nome} (${SLUG}) — status ${portal.status}`);
  console.log(`Kit "${bundle.slug}": "${bundle.name}" @ ${bundle.finalPriceEur} EUR`);
  console.log("\n--- PRIMA ---");
  console.log("productDiscounts:", JSON.stringify(portal.catalog.productDiscounts));
  console.log("components:", JSON.stringify(bundle.components));
  console.log("\n--- DOPO (target) ---");
  console.log("productDiscounts:", JSON.stringify(FIXED_DISCOUNTS));
  console.log("components:", JSON.stringify(FIXED_COMPONENTS));

  if (dryRun) {
    console.log("\n[dry-run] nessuna modifica applicata.");
    return;
  }

  await patchPortalCatalog(SLUG, { productDiscounts: FIXED_DISCOUNTS });
  await updateBundleInPortal(SLUG, BUNDLE_SLUG, { components: FIXED_COMPONENTS });

  const after = await getPortal(SLUG);
  const afterBundle = after?.bundles.find((b) => b.slug === BUNDLE_SLUG);
  console.log("\n--- APPLICATO ---");
  console.log("productDiscounts:", JSON.stringify(after?.catalog.productDiscounts));
  console.log("components:", JSON.stringify(afterBundle?.components));
  console.log("\nOK. Ora rilancia 'Ri-esegui seed Saleor' dal portale (o /enable).");
}

main().catch((err) => {
  console.error("[fix-pbs-descriptor] errore:", err instanceof Error ? err.message : err);
  process.exit(1);
});
