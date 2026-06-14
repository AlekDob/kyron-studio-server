// Arricchimento ordini Saleor con i metadati portale (Payload) per il modulo
// Ordini di Studio (feature 008). Il join e' order.channelSlug === portal.slug:
// per le scuole onboardate slug == channel; il main shop (es. scuola-demo) non ha
// doc portale -> agente/meccanografico vuoti, link al main shop.
import type { OrderSummary } from "@/core/saleor/orders.js";
import { listPortals } from "@/features/portals/reader.js";

// Base URL pubblico dello storefront per costruire il link al portale.
const SHOP_BASE =
  process.env.KYRON_SHOP_BASE_URL ?? "https://kyronedu.it/shop";

export interface PortalMeta {
  nome: string;
  // Email agente commerciale di riferimento (PendingSchools.requestedBy).
  agent: string;
  codiceMeccanografico: string;
}

export interface EnrichedOrder extends OrderSummary {
  agent: string;
  codiceMeccanografico: string;
  portalName: string;
  portalUrl: string;
}

// Indice channelSlug/slug -> metadati portale, una sola listPortals() per request.
export async function buildPortalIndex(): Promise<Map<string, PortalMeta>> {
  const portals = await listPortals();
  const index = new Map<string, PortalMeta>();
  for (const p of portals) {
    index.set(p.slug, {
      nome: p.nome,
      agent: p.requestedBy,
      codiceMeccanografico: p.codiceMeccanografico,
    });
  }
  return index;
}

// Link pubblico al portale a partire dallo slug (== channelSlug per le scuole).
function portalUrl(slug: string): string {
  return `${SHOP_BASE}/${slug}`;
}

export function enrichOrder(
  order: OrderSummary,
  index: Map<string, PortalMeta>,
): EnrichedOrder {
  const meta = index.get(order.channelSlug);
  return {
    ...order,
    agent: meta?.agent ?? "",
    codiceMeccanografico: meta?.codiceMeccanografico ?? "",
    portalName: meta?.nome ?? order.channelName,
    portalUrl: portalUrl(order.channelSlug),
  };
}
