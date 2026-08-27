// Colla tra l'import in memoria, il catalogo Saleor e il diff puro.
import type { SaleorTarget } from "@/features/portals/enable/saleor-admin.js";
import { buildDaneaPlan, type DaneaPlan, type ExistingVariant } from "./danea-plan.js";
import { getProductsImport } from "./danea-uploads.js";
import { listProducts } from "./reads.js";

// Il catalogo intero in una query: un file Danea porta decine di codici e
// cercarli uno a uno sarebbe una query admin per SKU.
async function existingVariants(
  target: SaleorTarget,
  channelSlug: string,
): Promise<ExistingVariant[]> {
  const products = await listProducts(target, { limit: 200 });
  return products.flatMap((p) =>
    p.variants
      .filter((v) => v.sku)
      .map((v) => ({
        sku: v.sku,
        productSlug: p.slug,
        priceEur: v.channels.find((c) => c.channelSlug === channelSlug)?.priceEur ?? null,
      })),
  );
}

export async function planDaneaImport(
  target: SaleorTarget,
  args: { importId: string; channelSlug: string },
): Promise<DaneaPlan & { filename: string }> {
  const entry = getProductsImport(args.importId);
  const plan = buildDaneaPlan({
    channelSlug: args.channelSlug,
    groups: entry.groups,
    existing: await existingVariants(target, args.channelSlug),
  });
  return { ...plan, filename: entry.filename };
}
