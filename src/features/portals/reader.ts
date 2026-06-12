import { getPortalsGateway, PORTALS_COLLECTION } from "./gateway.js";
import { kyronTenant } from "@/config/tenants/kyron.js";

// Brain: decision-016 — portali su Payload collection `pending-schools`.
// reader.ts traduce i doc Payload nelle interfacce PortalSummary/PortalDetail
// che il frontend (PortalsList, PortalDetail) e l'agente consumano.
// La firma delle funzioni public (listPortals, getPortal, resolvePortal)
// resta identica al vecchio reader filesystem per non rompere i call site.

export interface PortalSummary {
  slug: string;
  nome: string;
  city: string;
  countryArea: string;
  status: string;
  collectedBy: string;
  // Email dell'agente Studio che ha richiesto l'onboarding (vuoto se sconosciuto).
  requestedBy: string;
  collectedAt: string;
  bundleCount: number;
  productCount: number;
  // URL assoluto del logo (media Payload, depth>=1) o null se non caricato.
  logoUrl: string | null;
}

export interface PortalDetail extends PortalSummary {
  id: string;
  sitoUfficiale: string;
  codiceMeccanografico: string;
  schoolAddress: Record<string, unknown>;
  branding: { nome: string; logoUrl: string | null };
  shipToSchool: boolean;
  shippingMethodLabel: string;
  shippingPriceEur: number;
  catalog: {
    visibleSlugs: string[];
    visibleVariants: VisibleVariant[];
    hiddenSlugs: string[];
    productDiscounts: ProductDiscount[];
    heroOutsideBundle: boolean;
    accessoriesOutsideBundle: boolean;
  };
  bundles: Array<{
    slug: string;
    name: string;
    finalPriceEur: number;
    components: Array<Record<string, unknown>>;
  }>;
}

function asArray(value: unknown): unknown[] {
  if (Array.isArray(value)) return value;
  if (typeof value === "string") {
    try {
      const parsed = JSON.parse(value);
      return Array.isArray(parsed) ? parsed : [];
    } catch {
      return [];
    }
  }
  return [];
}

function asStringArray(value: unknown): string[] {
  return asArray(value).map((v) => String(v));
}

export interface ProductDiscount {
  slug: string;
  // Taglio (slug valore capacita, es. "128gb") o null = prodotto intero.
  capacity: string | null;
  kind: "percent" | "eur";
  value: number;
}

export interface VisibleVariant {
  productSlug: string;
  attribute: string;
  value: string;
}

// Normalizza catalog.productDiscounts dal doc Payload (jsonb).
function asProductDiscounts(value: unknown): ProductDiscount[] {
  return asArray(value)
    .map((v) => v as Record<string, unknown>)
    .filter((v) => v && typeof v.slug === "string")
    .map((v) => ({
      slug: String(v.slug),
      capacity: typeof v.capacity === "string" ? v.capacity : null,
      kind: v.kind === "eur" ? "eur" : "percent",
      value: Number(v.value ?? 0),
    }));
}

// Normalizza catalog.visibleVariants (tagli pubblicati) dal doc Payload (jsonb).
function asVisibleVariants(value: unknown): VisibleVariant[] {
  return asArray(value)
    .map((v) => v as Record<string, unknown>)
    .filter((v) => v && typeof v.productSlug === "string")
    .map((v) => ({
      productSlug: String(v.productSlug),
      attribute: String(v.attribute ?? "capacita"),
      value: String(v.value ?? ""),
    }));
}

function toSummary(doc: Record<string, unknown>): PortalSummary {
  const addr = (doc.schoolAddress as Record<string, string>) ?? {};
  const catalog =
    (doc.catalog as { visibleSlugs?: unknown; visibleVariants?: unknown }) ?? {};
  const bundles = asArray(doc.bundles);
  return {
    slug: String(doc.slug ?? ""),
    nome: String(doc.nome ?? ""),
    city: String(addr.city ?? ""),
    countryArea: String(addr.countryArea ?? ""),
    status: String(doc.status ?? "draft"),
    collectedBy: String(doc.collectedBy ?? "agent"),
    requestedBy: String(doc.requestedBy ?? ""),
    collectedAt: String(doc.createdAt ?? doc.updatedAt ?? ""),
    bundleCount: bundles.length,
    // I tagli (visibleVariants) sono prodotti a catalogo a tutti gli effetti.
    productCount:
      asStringArray(catalog.visibleSlugs).length +
      asVisibleVariants(catalog.visibleVariants).length,
    // listPortals usa depth=1: branding.logo e' gia' popolato come media.
    logoUrl: brandingLogoUrl((doc.branding as Record<string, unknown>) ?? {}),
  };
}

// Origin pubblico del cms (serve i media), derivato da payloadApiUrl togliendo /api.
function mediaOrigin(): string {
  return kyronTenant.payloadApiUrl.replace(/\/api\/?$/, "");
}

// Estrae l'URL assoluto del logo dal branding. Con depth>=1 il campo
// branding.logo (relazione upload->media) e' popolato come {url, filename}.
function brandingLogoUrl(branding: Record<string, unknown>): string | null {
  const logo = branding.logo;
  if (logo && typeof logo === "object") {
    const url = (logo as Record<string, unknown>).url;
    if (typeof url === "string" && url) {
      return url.startsWith("http") ? url : `${mediaOrigin()}${url}`;
    }
  }
  return null;
}

function toDetail(doc: Record<string, unknown>): PortalDetail {
  const summary = toSummary(doc);
  const catalogRaw = (doc.catalog as Record<string, unknown>) ?? {};
  const bundlesRaw = asArray(doc.bundles) as Array<Record<string, unknown>>;
  return {
    ...summary,
    id: String(doc.id ?? ""),
    sitoUfficiale: String(doc.sitoUfficiale ?? ""),
    codiceMeccanografico: String(doc.codiceMeccanografico ?? ""),
    schoolAddress: (doc.schoolAddress as Record<string, unknown>) ?? {},
    branding: {
      nome: String((doc.branding as Record<string, unknown>)?.nome ?? ""),
      logoUrl: brandingLogoUrl((doc.branding as Record<string, unknown>) ?? {}),
    },
    shipToSchool: Boolean(doc.shipToSchool),
    shippingMethodLabel: String(doc.shippingMethodLabel ?? ""),
    shippingPriceEur: Number(doc.shippingPriceEur ?? 0),
    catalog: {
      visibleSlugs: asStringArray(catalogRaw.visibleSlugs),
      visibleVariants: asVisibleVariants(catalogRaw.visibleVariants),
      hiddenSlugs: asStringArray(catalogRaw.hiddenSlugs),
      productDiscounts: asProductDiscounts(catalogRaw.productDiscounts),
      heroOutsideBundle: Boolean(catalogRaw.heroOutsideBundle),
      accessoriesOutsideBundle: Boolean(catalogRaw.accessoriesOutsideBundle),
    },
    bundles: bundlesRaw.map((b) => ({
      slug: String(b.slug ?? ""),
      name: String(b.name ?? ""),
      finalPriceEur: Number(b.finalPriceEur ?? 0),
      components: asArray(b.components) as Array<Record<string, unknown>>,
    })),
  };
}

export async function listPortals(): Promise<PortalSummary[]> {
  const gw = getPortalsGateway();
  const res = await gw.list(PORTALS_COLLECTION, {
    limit: 200,
    sort: "-updatedAt",
    depth: 1,
  });
  return res.data.map(toSummary);
}

export async function getPortal(slug: string): Promise<PortalDetail | null> {
  const doc = await findPortalDoc(slug);
  return doc ? toDetail(doc) : null;
}

// Internal: ritorna il raw doc Payload (con id) per poter fare update/delete.
export async function findPortalDoc(
  slug: string,
): Promise<Record<string, unknown> | null> {
  const gw = getPortalsGateway();
  const res = await gw.list(PORTALS_COLLECTION, {
    where: { slug: { equals: slug } },
    limit: 1,
    depth: 1,
  });
  return res.data[0] ?? null;
}

export interface PortalResolution {
  portal: PortalDetail | null;
  candidates: PortalSummary[];
}

function norm(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, "");
}

export async function resolvePortal(query: string): Promise<PortalResolution> {
  const direct = await getPortal(query);
  if (direct) return { portal: direct, candidates: [] };
  const all = await listPortals();
  const q = norm(query);
  const matches = all.filter(
    (p) => norm(p.slug).includes(q) || norm(p.nome).includes(q),
  );
  if (matches.length === 1) {
    const portal = await getPortal(matches[0].slug);
    return { portal, candidates: [] };
  }
  return { portal: null, candidates: matches };
}
