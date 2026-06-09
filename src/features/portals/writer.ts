import { findPortalDoc } from "./reader.js";
import { getPortalsGateway, PORTALS_COLLECTION } from "./gateway.js";

// Brain: decision-016 — writer scrive in Payload via gateway REST.
// Conservata la firma pubblica del vecchio writer filesystem. Le mutation
// che toccano array (bundles) o group (schoolAddress/catalog) leggono il
// doc, applicano il patch in memoria, e fanno PATCH dell'intero doc. Se
// la full-doc validation Payload fallisce, switch a raw SQL (vedi GOTCHA
// in cms/CLAUDE.md, pattern lib/studio/data/raw-write.ts).

export interface UpdateFields {
  nome?: string;
  sitoUfficiale?: string;
  codiceMeccanografico?: string;
  streetAddress1?: string;
  postalCode?: string;
  city?: string;
  countryArea?: string;
  phone?: string;
  shipToSchool?: boolean;
  status?: string;
}

const ADDRESS_FIELDS = new Set([
  "streetAddress1",
  "postalCode",
  "city",
  "countryArea",
  "phone",
  "firstName",
  "lastName",
  "companyName",
  "country",
]);

async function requirePortalId(slug: string): Promise<string> {
  const doc = await findPortalDoc(slug);
  if (!doc) throw new Error(`portal "${slug}" not found`);
  return String(doc.id);
}

export async function updatePortal(
  slug: string,
  updates: UpdateFields,
): Promise<{ ok: boolean; slug: string; updatedFields: string[] }> {
  const doc = await findPortalDoc(slug);
  if (!doc) throw new Error(`portal "${slug}" not found`);

  const patch: Record<string, unknown> = {};
  const updatedFields: string[] = [];
  const currentAddress =
    (doc.schoolAddress as Record<string, unknown>) ?? {};
  const nextAddress: Record<string, unknown> = { ...currentAddress };
  let addressTouched = false;

  for (const [key, val] of Object.entries(updates)) {
    if (val == null) continue;
    if (ADDRESS_FIELDS.has(key)) {
      nextAddress[key] = val;
      addressTouched = true;
      updatedFields.push(`schoolAddress.${key}`);
    } else {
      patch[key] = val;
      updatedFields.push(key);
    }
  }
  if (addressTouched) patch.schoolAddress = nextAddress;

  if (Object.keys(patch).length === 0) {
    return { ok: true, slug, updatedFields: [] };
  }

  const gw = getPortalsGateway();
  await gw.update(PORTALS_COLLECTION, String(doc.id), patch);
  return { ok: true, slug, updatedFields };
}

export interface BundleInput {
  slug: string;
  name: string;
  finalPriceEur: number;
  components: Array<{
    productSlug: string;
    selection:
      | { kind: "fixed"; variantSku: string }
      | { kind: "variant"; variantSku: string }
      | {
          kind: "by-attribute";
          attribute: string;
          valueFilter?: Record<string, string>;
        };
  }>;
}

function readBundles(doc: Record<string, unknown>): Array<Record<string, unknown>> {
  const raw = doc.bundles;
  if (Array.isArray(raw)) return raw as Array<Record<string, unknown>>;
  if (typeof raw === "string") {
    try {
      const parsed = JSON.parse(raw);
      return Array.isArray(parsed) ? parsed : [];
    } catch {
      return [];
    }
  }
  return [];
}

function writableBundle(b: Record<string, unknown>): Record<string, unknown> {
  // Drop Payload-managed id when overwriting array: il PATCH array totale
  // crea nuove righe; gli id originali non vanno riproposti.
  const { id: _id, ...rest } = b;
  void _id;
  return rest;
}

export async function addBundleToPortal(
  slug: string,
  bundle: BundleInput,
): Promise<{ ok: boolean; slug: string; bundleSlug: string; total: number }> {
  const doc = await findPortalDoc(slug);
  if (!doc) throw new Error(`portal "${slug}" not found`);
  const current = readBundles(doc);
  const exists = current.some((b) => b?.slug === bundle.slug);
  const next = exists
    ? current.map((b) => (b?.slug === bundle.slug ? bundle : writableBundle(b)))
    : [...current.map(writableBundle), bundle];

  const gw = getPortalsGateway();
  await gw.update(PORTALS_COLLECTION, String(doc.id), { bundles: next });
  return { ok: true, slug, bundleSlug: bundle.slug, total: next.length };
}

export async function updatePortalCatalog(
  slug: string,
  visibleSlugs: string[],
): Promise<{ ok: boolean; slug: string; total: number }> {
  const doc = await findPortalDoc(slug);
  if (!doc) throw new Error(`portal "${slug}" not found`);
  // Preserva gli altri campi del catalog (visibleVariants, productDiscounts,
  // hero/accessoriesOutsideBundle): sovrascrivere solo visibleSlugs evita di
  // azzerare tagli/sconti/flag impostati durante l'onboarding.
  const currentCatalog =
    (doc.catalog as Record<string, unknown>) ?? {};
  const nextCatalog = {
    ...currentCatalog,
    visibleSlugs: [...new Set(visibleSlugs)],
  };
  const gw = getPortalsGateway();
  await gw.update(PORTALS_COLLECTION, String(doc.id), { catalog: nextCatalog });
  return { ok: true, slug, total: nextCatalog.visibleSlugs.length };
}

export interface BundlePatch {
  name?: string;
  finalPriceEur?: number;
  components?: BundleInput["components"];
}

export async function updateBundleInPortal(
  slug: string,
  bundleSlug: string,
  patch: BundlePatch,
): Promise<{
  ok: boolean;
  slug: string;
  bundleSlug: string;
  updatedFields: string[];
}> {
  const doc = await findPortalDoc(slug);
  if (!doc) throw new Error(`portal "${slug}" not found`);
  const bundles = readBundles(doc);
  const idx = bundles.findIndex((b) => b?.slug === bundleSlug);
  if (idx === -1) {
    throw new Error(`bundle "${bundleSlug}" not found on portal "${slug}"`);
  }
  const updatedFields: string[] = [];
  const next = bundles.map(writableBundle);
  if (patch.name != null) {
    next[idx].name = patch.name;
    updatedFields.push("name");
  }
  if (patch.finalPriceEur != null) {
    next[idx].finalPriceEur = patch.finalPriceEur;
    updatedFields.push("finalPriceEur");
  }
  if (patch.components != null) {
    next[idx].components = patch.components;
    updatedFields.push("components");
  }

  const gw = getPortalsGateway();
  await gw.update(PORTALS_COLLECTION, String(doc.id), { bundles: next });
  return { ok: true, slug, bundleSlug, updatedFields };
}

export async function removeBundleFromPortal(
  slug: string,
  bundleSlug: string,
): Promise<{ ok: boolean; slug: string; bundleSlug: string; total: number }> {
  const doc = await findPortalDoc(slug);
  if (!doc) throw new Error(`portal "${slug}" not found`);
  const bundles = readBundles(doc);
  const next = bundles
    .filter((b) => b?.slug !== bundleSlug)
    .map(writableBundle);
  if (next.length === bundles.length) {
    throw new Error(`bundle "${bundleSlug}" not found on portal "${slug}"`);
  }

  const gw = getPortalsGateway();
  await gw.update(PORTALS_COLLECTION, String(doc.id), { bundles: next });
  return { ok: true, slug, bundleSlug, total: next.length };
}

export async function deletePortal(
  slug: string,
): Promise<{ ok: boolean; slug: string }> {
  const id = await requirePortalId(slug);
  const gw = getPortalsGateway();
  await gw.remove(PORTALS_COLLECTION, id);
  return { ok: true, slug };
}

// Stub: la nuova savePortalLogo (Fase 5) carica il file in Payload Media
// e linka l'ID al branding.logo del PendingSchool. Implementata in
// `./logo.ts` per separare la complessita' multipart upload.
export { savePortalLogo } from "./logo.js";
