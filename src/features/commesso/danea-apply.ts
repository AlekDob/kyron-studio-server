// Applica la parte SICURA di un piano Danea: prodotti e varianti che non
// esistono ancora, col loro prezzo sul canale indicato.
//
// Una variante che nasce ora non e' componente di nessun kit e non ha un prezzo
// vecchio da cui far cascare niente: scriverlo subito e' sicuro (R1/R2 non si
// applicano). I prezzi che CAMBIANO su varianti esistenti restano fuori: quelli
// passano dal piano prezzi. I prodotti nuovi nascono NON pubblicati (R3).
import type { SaleorTarget } from "@/features/portals/enable/saleor-admin.js";
import { setVariantPrice } from "@/features/portals/enable/seed-steps.js";
import type { DaneaPlanGroup } from "./danea-plan.js";
import { getProduct } from "./reads.js";
import { createProduct, upsertVariant } from "./writes.js";
import { resolveChannelId } from "./price-writes.js";

/** Come l'utente vuole che si chiami un gruppo su Saleor. */
export interface GroupMapping {
  aggregator: string;
  productName: string;
  slug: string;
  productTypeId: string;
  categorySlug: string;
}

export interface DaneaApplyResult {
  createdProducts: string[];
  createdVariants: Array<{ sku: string; priceEur: number }>;
  skipped: Array<{ aggregator: string; reason: string }>;
}

async function productIdFor(
  target: SaleorTarget,
  group: DaneaPlanGroup,
  mapping: GroupMapping,
  result: DaneaApplyResult,
): Promise<string> {
  const existing = await getProduct(target, mapping.slug);
  if (existing) return existing.id;
  const created = await createProduct(target, {
    name: mapping.productName,
    slug: mapping.slug,
    productTypeId: mapping.productTypeId,
    categorySlug: mapping.categorySlug,
  });
  result.createdProducts.push(mapping.slug);
  void group;
  return created.id;
}

export function aggregatorsSkippedWithoutMapping(
  groups: DaneaPlanGroup[],
  mappings: GroupMapping[],
): string[] {
  const byAggregator = new Map(mappings.map((m) => [m.aggregator, m]));
  return groups
    .filter((g) => g.newVariants.length > 0 && !byAggregator.has(g.aggregator))
    .map((g) => g.aggregator);
}

export async function applyDaneaPlan(
  target: SaleorTarget,
  args: {
    channelSlug: string;
    groups: DaneaPlanGroup[];
    mappings: GroupMapping[];
  },
): Promise<DaneaApplyResult> {
  const result: DaneaApplyResult = {
    createdProducts: [],
    createdVariants: [],
    skipped: [],
  };
  const channelId = await resolveChannelId(target, args.channelSlug);
  const byAggregator = new Map(args.mappings.map((m) => [m.aggregator, m]));

  for (const group of args.groups) {
    if (group.newVariants.length === 0) continue;
    const mapping = byAggregator.get(group.aggregator);
    if (!mapping) {
      // Senza nome e categoria non inventiamo niente: lo diciamo e si va avanti.
      result.skipped.push({
        aggregator: group.aggregator,
        reason: "manca nome/categoria/tipo prodotto",
      });
      continue;
    }
    const productId = await productIdFor(target, group, mapping, result);
    for (const variant of group.newVariants) {
      const created = await upsertVariant(target, {
        productId,
        sku: variant.sku,
        name: variant.name,
      });
      await setVariantPrice(target, created.id, channelId, variant.priceEur);
      console.info(
        `[commesso] ${JSON.stringify({
          action: "danea-variant-created",
          target,
          channel: args.channelSlug,
          sku: variant.sku,
          priceEur: variant.priceEur,
        })}`,
      );
      result.createdVariants.push({ sku: variant.sku, priceEur: variant.priceEur });
    }
  }
  return result;
}
