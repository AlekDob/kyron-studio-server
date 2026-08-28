import type { SaleorTarget } from "@/features/portals/enable/saleor-admin.js";
import { matchSkuFromFilename } from "./danea-sku.js";
import { listProducts } from "./reads.js";
import { addProductImageFile } from "./writes.js";

export interface ImageFile {
  name: string;
  bytes: Buffer;
  mime: string;
}

export interface ImageApplyResult {
  attached: Array<{ sku: string; file: string; productSlug: string }>;
  unmatched: string[];
}

function mimeOf(name: string): string {
  const lower = name.toLowerCase();
  if (lower.endsWith(".png")) return "image/png";
  if (lower.endsWith(".webp")) return "image/webp";
  if (lower.endsWith(".gif")) return "image/gif";
  return "image/jpeg";
}

export async function applyImagesBySku(
  target: SaleorTarget,
  files: ImageFile[],
): Promise<ImageApplyResult> {
  const products = await listProducts(target, { limit: 500 });
  const skuToProduct = new Map<string, { id: string; slug: string }>();
  for (const p of products) {
    for (const v of p.variants) {
      if (v.sku) skuToProduct.set(v.sku, { id: p.id, slug: p.slug });
    }
  }
  const skus = [...skuToProduct.keys()];
  const attached: ImageApplyResult["attached"] = [];
  const unmatched: string[] = [];

  for (const file of files) {
    const sku = matchSkuFromFilename(file.name, skus);
    if (!sku) {
      unmatched.push(file.name);
      continue;
    }
    const product = skuToProduct.get(sku)!;
    await addProductImageFile(target, {
      productId: product.id,
      bytes: file.bytes,
      filename: file.name.split(/[/\\]/).pop() ?? file.name,
      mime: file.mime || mimeOf(file.name),
      alt: sku,
    });
    attached.push({ sku, file: file.name, productSlug: product.slug });
  }
  return { attached, unmatched };
}
