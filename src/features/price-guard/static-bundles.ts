// Kit STATICI dello storefront (bundles.ts). Per 5 tenant "pilot" i kit vivono
// nel codice dello storefront e VINCONO sui cloni Payload: e' quello che il
// cliente compra davvero. La Price Guard costruisce il contesto da Payload,
// quindi senza questa lettura riconcilia i cloni (sempre allineati, perche' li
// risincronizza enablePortal) e non vede mai un voucher stale sul kit vero.
// Trovato il 2026-08-31 su ic-massari-galilei: +26 EUR al checkout.
// Brain: kit-voucher-stale-overcharge.
import type { BundleConfig } from "@/features/portals/enable/config.js";

// Lo storefront vive sotto /shop (basePath Next): senza quel pezzo la fetch
// finisce sul CMS all'apex e torna 404 — la guardia perdeva i kit statici.
const STOREFRONT_URL = process.env.STOREFRONT_URL ?? "https://kyronedu.it/shop";

interface StaticBundle extends BundleConfig {
  tenantSlug: string;
}

// tenantSlug -> kit statici. Vuota se lo storefront non risponde: la guardia
// continua sui kit Payload invece di saltare l'intero run.
export async function fetchStaticBundles(): Promise<Map<string, BundleConfig[]>> {
  const byTenant = new Map<string, BundleConfig[]>();
  try {
    const res = await fetch(`${STOREFRONT_URL}/api/bundles`, {
      signal: AbortSignal.timeout(15_000),
    });
    if (!res.ok) return byTenant;
    for (const b of (await res.json()) as StaticBundle[]) {
      const list = byTenant.get(b.tenantSlug) ?? [];
      list.push({
        slug: b.slug,
        name: b.name,
        finalPriceEur: b.finalPriceEur,
        components: b.components,
      });
      byTenant.set(b.tenantSlug, list);
    }
  } catch {
    return byTenant;
  }
  return byTenant;
}
