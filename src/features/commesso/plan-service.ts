// Colla tra le letture Saleor e il motore puro del piano. Sta qui e non nel
// tool perche' plan_prices e apply_price_plan devono calcolare il piano
// ESATTAMENTE nello stesso modo: l'apply ricalcola invece di fidarsi del turno
// precedente, altrimenti le guardie girerebbero su dati vecchi.
import type { SaleorTarget } from "@/features/portals/enable/saleor-admin.js";
import { findBundleUses } from "./bundle-usage.js";
import { buildPricePlan, type PlanRequest, type PricePlan, type VoucherUpdate } from "./price-plan.js";
import { listProducts } from "./reads.js";

export interface PlanPricesInput {
  channelSlug: string;
  requests: PlanRequest[];
  voucherUpdates?: VoucherUpdate[];
}

export async function planPrices(
  target: SaleorTarget,
  input: PlanPricesInput,
): Promise<PricePlan> {
  const skus = new Set(input.requests.map((r) => r.sku));
  // Una sola query per SKU: il filtro search di Saleor non accetta liste.
  const found = await Promise.all(
    [...skus].map((sku) => listProducts(target, { search: sku, limit: 20 })),
  );

  const current = found.flat().flatMap((product) =>
    product.variants
      .filter((v) => v.sku && skus.has(v.sku))
      .map((v) => ({
        sku: v.sku,
        variantId: v.id,
        productSlug: product.slug,
        priceEur:
          v.channels.find((c) => c.channelSlug === input.channelSlug)?.priceEur ?? null,
      })),
  );

  const { uses, unreadable } = await findBundleUses(
    target,
    [...new Set(current.map((c) => c.productSlug))],
  );

  const plan = buildPricePlan({
    channelSlug: input.channelSlug,
    requests: input.requests,
    current,
    bundleUses: uses,
    voucherUpdates: input.voucherUpdates,
  });
  // Un kit illeggibile non e' una garanzia: lo diciamo, non lo nascondiamo.
  for (const bundle of unreadable) {
    plan.warnings.push(`Kit "${bundle}" non leggibile: verificalo a mano.`);
  }
  return plan;
}
