import { getPortalsGateway, PORTALS_COLLECTION } from "./gateway.js";

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
  collectedAt: string;
  bundleCount: number;
  productCount: number;
}

export interface PortalDetail extends PortalSummary {
  id: string;
  sitoUfficiale: string;
  codiceMeccanografico: string;
  schoolAddress: Record<string, unknown>;
  branding: Record<string, unknown>;
  shipToSchool: boolean;
  shippingMethodLabel: string;
  shippingPriceEur: number;
  catalog: {
    visibleSlugs: string[];
    hiddenSlugs: string[];
    productDiscounts: ProductDiscount[];
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
  kind: "percent" | "eur";
  value: number;
}

// Normalizza catalog.productDiscounts dal doc Payload (jsonb).
function asProductDiscounts(value: unknown): ProductDiscount[] {
  return asArray(value)
    .map((v) => v as Record<string, unknown>)
    .filter((v) => v && typeof v.slug === "string")
    .map((v) => ({
      slug: String(v.slug),
      kind: v.kind === "eur" ? "eur" : "percent",
      value: Number(v.value ?? 0),
    }));
}

function toSummary(doc: Record<string, unknown>): PortalSummary {
  const addr = (doc.schoolAddress as Record<string, string>) ?? {};
  const catalog = (doc.catalog as { visibleSlugs?: unknown }) ?? {};
  const bundles = asArray(doc.bundles);
  return {
    slug: String(doc.slug ?? ""),
    nome: String(doc.nome ?? ""),
    city: String(addr.city ?? ""),
    countryArea: String(addr.countryArea ?? ""),
    status: String(doc.status ?? "draft"),
    collectedBy: String(doc.collectedBy ?? "agent"),
    collectedAt: String(doc.createdAt ?? doc.updatedAt ?? ""),
    bundleCount: bundles.length,
    productCount: asStringArray(catalog.visibleSlugs).length,
  };
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
    branding: (doc.branding as Record<string, unknown>) ?? {},
    shipToSchool: Boolean(doc.shipToSchool),
    shippingMethodLabel: String(doc.shippingMethodLabel ?? ""),
    shippingPriceEur: Number(doc.shippingPriceEur ?? 0),
    catalog: {
      visibleSlugs: asStringArray(catalogRaw.visibleSlugs),
      hiddenSlugs: asStringArray(catalogRaw.hiddenSlugs),
      productDiscounts: asProductDiscounts(catalogRaw.productDiscounts),
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
