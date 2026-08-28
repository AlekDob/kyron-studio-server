import type { SaleorTarget } from "@/features/portals/enable/saleor-admin.js";
import { enablePortal } from "@/features/portals/enable/enable.js";
import { getPortal } from "@/features/portals/reader.js";
import { patchPortalCatalog } from "@/features/portals/writer.js";

export async function addProductsToPortals(args: {
  productSlugs: string[];
  portalSlugs: string[];
  target: SaleorTarget;
}): Promise<Array<{ portal: string; visible: number }>> {
  const out: Array<{ portal: string; visible: number }> = [];
  for (const portalSlug of args.portalSlugs) {
    const portal = await getPortal(portalSlug);
    if (!portal) throw new Error(`Portale "${portalSlug}" non trovato`);
    const visible = [...new Set([...portal.catalog.visibleSlugs, ...args.productSlugs])];
    await patchPortalCatalog(portalSlug, { visibleSlugs: visible });
    await enablePortal(portalSlug, [args.target]);
    out.push({ portal: portalSlug, visible: visible.length });
  }
  return out;
}
