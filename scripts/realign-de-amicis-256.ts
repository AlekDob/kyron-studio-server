// One-shot: riallinea il descriptor Payload di de-amicis con lo sconto
// ipada16-256gb 599EUR gia' applicato direttamente su Saleor (2026-07-08).
// Merge NON distruttivo: legge la lista productDiscounts corrente, aggiunge la
// voce 256gb solo se manca, riscrive la lista completa via patchPortalCatalog.
// Uso (env prod passato dal container, vedi memoria studio-deploy-and-portal-data-fix):
//   TENANT_KYRON_PAYLOAD_API_URL=... TENANT_KYRON_PAYLOAD_API_KEY=... npx tsx scripts/realign-de-amicis-256.ts [--apply]
import "dotenv/config";
import { findPortalDoc } from "../src/features/portals/reader.js";
import { patchPortalCatalog } from "../src/features/portals/writer.js";

const SLUG = "de-amicis";
// Mirror di cio' che e' LIVE su Saleor de-amicis ma mancava nel descriptor
// (entrambi gli sconti iPad erano stati persi da update_discounts).
const NEW = [
  { slug: "ipada16", capacity: "128gb", kind: "eur", value: 469 },
  { slug: "ipada16", capacity: "256gb", kind: "eur", value: 599 },
];

async function main() {
  const apply = process.argv.includes("--apply");
  const doc = await findPortalDoc(SLUG);
  if (!doc) throw new Error(`portale ${SLUG} non trovato`);
  const catalog = (doc.catalog as Record<string, unknown>) ?? {};
  const current = (catalog.productDiscounts as typeof NEW) ?? [];
  console.log("productDiscounts attuali:", JSON.stringify(current));

  const toAdd = NEW.filter(
    (n) => !current.some((d) => d.slug === n.slug && (d.capacity ?? null) === n.capacity),
  );
  if (toAdd.length === 0) {
    console.log("Sconti iPad gia' nel descriptor, nessuna modifica.");
    return;
  }
  const next = [...current, ...toAdd];
  console.log("productDiscounts NUOVI:", JSON.stringify(next));
  if (!apply) {
    console.log("DRY-RUN (aggiungi --apply per scrivere).");
    return;
  }
  const res = await patchPortalCatalog(SLUG, { productDiscounts: next });
  console.log("Scritto:", JSON.stringify(res));
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
