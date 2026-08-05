// One-shot: rinomina IN PLACE il portale `de-amicis` -> `dantealighieri`.
// Il portale non e' mai stato diffuso alle famiglie (0 ordini reali), quindi
// niente migrazione: cambiamo solo l'identita' (slug) mantenendo LO STESSO
// canale Saleor (stesso channelId) e i prodotti/prezzi/promozioni gia' seedati.
//
// Perche' 3 passi (vedi diario 2026-07-09): lo slug del portale e' la chiave
// che si propaga a (1) doc Payload, (2) slug del canale Saleor [portals-runtime
// usa `channel: doc.slug`], (3) codici voucher kit [ricalcolati da slug a
// runtime via voucherCodeFor]. Le PROMOZIONI (sconti prodotto) sono agganciate
// a channelId+varianti: restano valide, il loro nome con lo slug e' cosmetico.
//
// Non distruttivo: sui voucher AGGIUNGIAMO il nuovo codice (addCodes) senza
// cancellare il vecchio (un voucher Saleor puo' avere piu' codici). Il vecchio
// KIT-DEAMICIS-... resta inerte, lo storefront usa il nuovo.
//
// Uso (env prod passato dal container, vedi memoria studio-deploy-and-portal-data-fix):
//   ...env... npx tsx scripts/rename-portal-de-amicis-to-dantealighieri.ts [--apply]
import "dotenv/config";
import { findPortalDoc, getPortal } from "../src/features/portals/reader.js";
import { getPortalsGateway, PORTALS_COLLECTION } from "../src/features/portals/gateway.js";
import { adminRequest } from "../src/features/portals/enable/saleor-admin.js";
import { voucherCodeFor } from "../src/features/portals/enable/seed-steps.js";

const OLD_SLUG = "de-amicis";
const NEW_SLUG = "dantealighieri";
// Nome visibile della scuola (confermato da Alek, 2026-07-09): resta il nome
// completo, cambia solo lo slug.
const NEW_NOME = 'IC "De Amicis - Alighieri"';
const TARGET = "prod" as const;

async function main() {
  const apply = process.argv.includes("--apply");
  const log = (m: string) => console.log(`${apply ? "" : "[DRY] "}${m}`);

  // Leggo tutto PRIMA di mutare, cosi' i bundle li ho anche a rename fatto.
  const doc = await findPortalDoc(OLD_SLUG);
  if (!doc) throw new Error(`portale ${OLD_SLUG} non trovato su Payload`);
  const portal = await getPortal(OLD_SLUG);
  const bundles = portal?.bundles ?? [];
  log(`Payload doc id=${doc.id} slug=${doc.slug} channelId=${doc.channelId ?? "-"}`);
  log(`bundle trovati: ${bundles.map((b) => b.slug).join(", ") || "(nessuno)"}`);

  // 1) Payload: slug + nome
  log(`1) Payload: slug ${OLD_SLUG} -> ${NEW_SLUG}, nome -> "${NEW_NOME}"`);
  if (apply) {
    await getPortalsGateway().update(PORTALS_COLLECTION, String(doc.id), {
      slug: NEW_SLUG,
      nome: NEW_NOME,
    });
  }

  // 2) Saleor: rinomina lo slug del canale mantenendo lo stesso id
  const { channels } = await adminRequest<{
    channels: Array<{ id: string; slug: string }>;
  }>(TARGET, `query { channels { id slug } }`);
  const channel = channels.find((c) => c.slug === OLD_SLUG);
  if (!channel) throw new Error(`canale Saleor con slug ${OLD_SLUG} non trovato`);
  log(`2) Saleor channel id=${channel.id}: slug ${OLD_SLUG} -> ${NEW_SLUG}`);
  if (apply) {
    const res = await adminRequest<{
      channelUpdate: { errors: Array<{ field: string | null; message: string }> };
    }>(
      TARGET,
      `mutation ($id: ID!, $slug: String!) {
        channelUpdate(id: $id, input: { slug: $slug }) { errors { field message } }
      }`,
      { id: channel.id, slug: NEW_SLUG },
    );
    if (res.channelUpdate.errors.length) {
      throw new Error(`channelUpdate: ${JSON.stringify(res.channelUpdate.errors)}`);
    }
  }

  // 3) Voucher kit: aggiungo il nuovo codice a ogni voucher (additivo)
  for (const b of bundles) {
    const oldCode = voucherCodeFor(OLD_SLUG, b.slug);
    const newCode = voucherCodeFor(NEW_SLUG, b.slug);
    const search = await adminRequest<{
      vouchers: {
        edges: Array<{
          node: { id: string; codes: { edges: Array<{ node: { code: string } }> } };
        }>;
      };
    }>(
      TARGET,
      `query ($code: String!) {
        vouchers(first: 100, filter: { search: $code }) {
          edges { node { id codes(first: 50) { edges { node { code } } } } }
        }
      }`,
      { code: oldCode },
    );
    const found = search.vouchers.edges.find((e) =>
      e.node.codes.edges.some((c) => c.node.code === oldCode),
    );
    if (!found) {
      log(`3) [SKIP] voucher ${oldCode} non trovato (bundle ${b.slug})`);
      continue;
    }
    const already = found.node.codes.edges.some((c) => c.node.code === newCode);
    log(`3) voucher ${b.slug}: ${oldCode} + addCode ${newCode}${already ? " (gia' presente)" : ""}`);
    if (apply && !already) {
      const res = await adminRequest<{
        voucherUpdate: { errors: Array<{ field: string | null; message: string }> };
      }>(
        TARGET,
        `mutation ($id: ID!, $codes: [String!]!) {
          voucherUpdate(id: $id, input: { addCodes: $codes }) { errors { field message } }
        }`,
        { id: found.node.id, codes: [newCode] },
      );
      if (res.voucherUpdate.errors.length) {
        throw new Error(`voucherUpdate: ${JSON.stringify(res.voucherUpdate.errors)}`);
      }
    }
  }

  log(apply ? "FATTO." : "DRY-RUN completo (aggiungi --apply per scrivere).");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
