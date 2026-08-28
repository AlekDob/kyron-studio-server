// Foto Apple fuori dal turno chat: una GET alla scheda prodotto, og:image.
// Niente Playwright. Solo SKU part-number (`…/A`). Wacebo non passa di qui.
import type { SaleorTarget } from "@/features/portals/enable/saleor-admin.js";
import { isAppleSku } from "./danea-sku.js";
import { listProducts } from "./reads.js";
import { addProductImage } from "./writes.js";

const UA = "Mozilla/5.0 (compatible; KyronCatalog/1.0)";

export async function appleOgImageUrl(sku: string): Promise<string | null> {
  if (!isAppleSku(sku)) return null;
  const url = `https://www.apple.com/it/shop/product/${encodeURIComponent(sku)}`;
  const res = await fetch(url, { headers: { "User-Agent": UA }, redirect: "follow" });
  if (!res.ok) return null;
  const html = await res.text();
  const m =
    html.match(/property=["']og:image["'][^>]*content=["']([^"']+)["']/) ??
    html.match(/content=["']([^"']+)["'][^>]*property=["']og:image["']/);
  return m?.[1] ?? null;
}

export async function attachAppleImages(
  target: SaleorTarget,
  slugs: string[],
): Promise<{ attached: string[]; skipped: Array<{ sku: string; reason: string }> }> {
  const products = await listProducts(target, { limit: 500 });
  const wanted = new Set(slugs);
  const attached: string[] = [];
  const skipped: Array<{ sku: string; reason: string }> = [];

  for (const p of products) {
    if (wanted.size && !wanted.has(p.slug)) continue;
    for (const v of p.variants) {
      if (!v.sku) continue;
      if (!isAppleSku(v.sku)) {
        skipped.push({ sku: v.sku, reason: "non e' un part number Apple" });
        continue;
      }
      const imageUrl = await appleOgImageUrl(v.sku);
      if (!imageUrl) {
        skipped.push({ sku: v.sku, reason: "nessuna foto su apple.com" });
        continue;
      }
      await addProductImage(target, { productId: p.id, imageUrl, alt: v.sku });
      attached.push(v.sku);
    }
  }
  return { attached, skipped };
}
