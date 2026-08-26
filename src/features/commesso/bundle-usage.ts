// R1 — chi usa questo prodotto dentro un kit.
//
// Il voucher di un kit e' un importo FISSO in euro (decision-011): il prezzo
// che il cliente paga e' (somma componenti sul canale - voucher). Cambiare il
// prezzo di un componente senza ricalcolare il voucher fa vendere il kit al
// prezzo sbagliato, in silenzio. Prima di lasciar toccare un prezzo, Nico deve
// sapere se quel prodotto e' dentro un kit e quale voucher va rifatto.
import { listPortalDetails } from "@/features/portals/reader.js";
import { voucherCodeFor } from "@/features/portals/enable/seed-steps.js";
import { readVoucherDiscount } from "@/features/price-guard/reads.js";
import type { SaleorTarget } from "@/features/portals/enable/saleor-admin.js";
import type { BundleUse } from "./price-plan.js";

export interface BundleUsageResult {
  uses: BundleUse[];
  /** Kit che non siamo riusciti a leggere: non sono una garanzia di sicurezza. */
  unreadable: string[];
}

// I componenti nel jsonb Payload hanno forme diverse per epoca del descriptor:
// qui serve solo il productSlug e lo peschiamo difensivamente, perche' un
// descriptor malformato di un portale non deve bloccare i prezzi di tutti.
function componentSlugs(components: Array<Record<string, unknown>>): string[] {
  return components
    .map((c) => c.productSlug)
    .filter((s): s is string => typeof s === "string" && s.length > 0);
}

/**
 * Tutti i kit (su tutti i portali) che usano uno dei prodotti indicati, con il
 * codice voucher e lo sconto attuale sul canale del portale.
 */
export async function findBundleUses(
  target: SaleorTarget,
  productSlugs: string[],
): Promise<BundleUsageResult> {
  const wanted = new Set(productSlugs);
  const portals = await listPortalDetails();
  const uses: BundleUse[] = [];
  const unreadable: string[] = [];

  for (const portal of portals) {
    for (const bundle of portal.bundles) {
      const slugs = componentSlugs(bundle.components);
      if (slugs.length !== bundle.components.length) {
        unreadable.push(`${portal.slug}/${bundle.slug}`);
      }
      const hits = slugs.filter((s) => wanted.has(s));
      if (!hits.length) continue;
      const voucherCode = voucherCodeFor(portal.slug, bundle.slug);
      // Best-effort: se la lettura del voucher fallisce il kit resta comunque
      // nell'elenco (currentVoucherEur null) e la guardia scatta uguale.
      let currentVoucherEur: number | null = null;
      try {
        currentVoucherEur = await readVoucherDiscount(target, portal.slug, voucherCode);
      } catch {
        currentVoucherEur = null;
      }
      for (const productSlug of new Set(hits)) {
        uses.push({
          productSlug,
          portalSlug: portal.slug,
          bundleSlug: bundle.slug,
          voucherCode,
          currentVoucherEur,
        });
      }
    }
  }
  return { uses, unreadable };
}
