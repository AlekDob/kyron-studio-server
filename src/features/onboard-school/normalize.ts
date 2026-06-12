// Brain: normalizzazione descriptor PRE-save (Fase A pipeline onboarding).
// L'onboarding agentico produceva errori sistematici corretti a mano ad ogni
// scuola (Pacinotti 2026-06-09, Siotto 2026-06-12): SKU minuscoli, protection
// plan in visibleSlugs, visibleVariants in contraddizione con
// heroOutsideBundle:false, productDiscount eur con "sconto" al posto del
// prezzo finale. Qui le stesse regole girano server-side contro il catalogo
// Saleor reale, cosi' il descriptor esce gia' corretto dal save.
import type { PendingSchool } from "./schema.js";

const DEFAULT_URL = "https://api-staging.kyronedu.it/graphql/";
// Prefissi slug dei piani protezione (decision-012: hidden-but-purchasable).
const PROTECTION_SLUG_PREFIXES = ["applecare", "kyron-shield"];
// Sotto questa frazione del listino un `eur` e' quasi certamente uno SCONTO
// scritto al posto del PREZZO FINALE (gotcha-onboarding-productdiscount-final-price).
const EUR_FINAL_PRICE_MIN_RATIO = 0.3;

interface VariantIndex {
  sku: string;
  capacities: string[]; // slug valori attributo capacita (di norma 1)
}

interface ProductIndex {
  slug: string;
  name: string;
  isProtectionPlan: boolean;
  minPriceEur: number;
  variants: VariantIndex[];
}

export interface NormalizeResult {
  doc: PendingSchool;
  fixes: string[]; // correzioni applicate automaticamente (da riferire all'operatore)
  errors: string[]; // blocchi: il save deve fallire e l'agente chiedere/correggere
  skippedValidation: boolean; // Saleor irraggiungibile: salvato senza validazione
}

const CATALOG_INDEX_QUERY = `
  query NormalizeCatalogIndex($channel: String!) {
    products(channel: $channel, first: 100) {
      edges {
        node {
          slug
          name
          metadata { key value }
          pricing { priceRange { start { gross { amount } } } }
          variants {
            sku
            attributes { attribute { slug } values { slug } }
          }
        }
      }
    }
  }
`;

interface RawNode {
  slug: string;
  name: string;
  metadata: Array<{ key: string; value: string }>;
  pricing: { priceRange: { start: { gross: { amount: number } } } } | null;
  variants: Array<{
    sku: string;
    attributes: Array<{ attribute: { slug: string }; values: Array<{ slug: string }> }>;
  }> | null;
}

function isProtection(node: RawNode): boolean {
  const metaFlag = node.metadata.some(
    (m) => m.key === "isProtectionPlan" && m.value === "true",
  );
  return metaFlag || PROTECTION_SLUG_PREFIXES.some((p) => node.slug.startsWith(p));
}

export async function fetchCatalogIndex(): Promise<Map<string, ProductIndex>> {
  const url = process.env.SALEOR_API_URL ?? DEFAULT_URL;
  const channel = process.env.SALEOR_DEFAULT_CHANNEL ?? "default-channel";
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ query: CATALOG_INDEX_QUERY, variables: { channel } }),
  });
  if (!res.ok) throw new Error(`Saleor ${res.status}`);
  const json = (await res.json()) as {
    data: { products: { edges: Array<{ node: RawNode }> } };
  };
  const index = new Map<string, ProductIndex>();
  for (const { node } of json.data.products.edges) {
    index.set(node.slug, {
      slug: node.slug,
      name: node.name,
      isProtectionPlan: isProtection(node),
      minPriceEur: node.pricing?.priceRange.start.gross.amount ?? 0,
      variants: (node.variants ?? []).map((v) => ({
        sku: v.sku,
        capacities: v.attributes
          .filter((a) => a.attribute.slug === "capacita")
          .flatMap((a) => a.values.map((val) => val.slug)),
      })),
    });
  }
  return index;
}

// Tutti gli slug prodotto referenziati dal descriptor, per la verifica esistenza.
function referencedSlugs(doc: PendingSchool): string[] {
  const slugs = new Set<string>([
    ...doc.catalog.visibleSlugs,
    ...doc.catalog.hiddenSlugs,
    ...doc.catalog.visibleVariants.map((v) => v.productSlug),
    ...(doc.catalog.productDiscounts ?? []).map((d) => d.slug),
    ...doc.bundles.flatMap((b) => b.components.map((c) => c.productSlug)),
  ]);
  return [...slugs];
}

function fixVariantSkuCase(
  doc: PendingSchool,
  index: Map<string, ProductIndex>,
  fixes: string[],
  errors: string[],
): void {
  for (const bundle of doc.bundles) {
    for (const comp of bundle.components) {
      const sel = comp.selection;
      if (sel.kind !== "fixed" && sel.kind !== "variant") continue;
      const product = index.get(comp.productSlug);
      if (!product) continue; // gia' segnalato come slug sconosciuto
      const exact = product.variants.find((v) => v.sku === sel.variantSku);
      if (exact) continue;
      const ci = product.variants.find(
        (v) => v.sku.toLowerCase() === sel.variantSku.toLowerCase(),
      );
      if (ci) {
        fixes.push(
          `variantSku "${sel.variantSku}" -> "${ci.sku}" (case reale Saleor, bundle ${bundle.slug})`,
        );
        sel.variantSku = ci.sku;
      } else {
        errors.push(
          `Bundle ${bundle.slug}: SKU "${sel.variantSku}" inesistente su ${comp.productSlug}. SKU disponibili: ${product.variants.map((v) => v.sku).join(", ")}`,
        );
      }
    }
  }
}

// I protection plan non vanno mai a catalogo: hidden-but-purchasable, il
// cross-sell dello storefront li propone quando il device e' nel carrello.
function hideProtectionPlans(
  doc: PendingSchool,
  index: Map<string, ProductIndex>,
  fixes: string[],
): void {
  const stillVisible: string[] = [];
  for (const slug of doc.catalog.visibleSlugs) {
    if (index.get(slug)?.isProtectionPlan) {
      if (!doc.catalog.hiddenSlugs.includes(slug)) doc.catalog.hiddenSlugs.push(slug);
      fixes.push(`${slug}: protection plan spostato in hiddenSlugs (decision-012)`);
    } else {
      stillVisible.push(slug);
    }
  }
  doc.catalog.visibleSlugs = stillVisible;
}

// heroOutsideBundle:false = i device dei bundle si vendono SOLO nel kit.
// L'operatore pero' spesso seleziona i tagli anche nel picker catalogo: la
// selezione contraddittoria si risolve a favore del flag esplicito.
function enforceHeroOutsideBundle(doc: PendingSchool, fixes: string[]): void {
  if (doc.catalog.heroOutsideBundle) return;
  const bundleProducts = new Set(
    doc.bundles.flatMap((b) => b.components.map((c) => c.productSlug)),
  );
  const kept = doc.catalog.visibleVariants.filter((vv) => {
    if (!bundleProducts.has(vv.productSlug)) return true;
    if (!doc.catalog.hiddenSlugs.includes(vv.productSlug)) {
      doc.catalog.hiddenSlugs.push(vv.productSlug);
    }
    fixes.push(
      `${vv.productSlug} ${vv.value}: rimosso da visibleVariants (heroOutsideBundle=false -> bundle-only)`,
    );
    return false;
  });
  doc.catalog.visibleVariants = kept;
  // Stesso principio per il prodotto intero in visibleSlugs.
  doc.catalog.visibleSlugs = doc.catalog.visibleSlugs.filter((slug) => {
    if (!bundleProducts.has(slug)) return true;
    if (!doc.catalog.hiddenSlugs.includes(slug)) doc.catalog.hiddenSlugs.push(slug);
    fixes.push(`${slug}: rimosso da visibleSlugs (heroOutsideBundle=false -> bundle-only)`);
    return false;
  });
}

// `eur` = PREZZO FINALE, non sconto: un valore molto sotto il listino e' il
// sintomo classico (es. AppleCare value:4 invece di 75).
function checkDiscounts(
  doc: PendingSchool,
  index: Map<string, ProductIndex>,
  errors: string[],
): void {
  for (const d of doc.catalog.productDiscounts ?? []) {
    const product = index.get(d.slug);
    if (!product) continue;
    if (d.kind === "percent") {
      if (d.value <= 0 || d.value > 90) {
        errors.push(`productDiscount ${d.slug}: percent ${d.value} fuori range (1-90)`);
      }
      continue;
    }
    const listino = product.minPriceEur;
    if (listino > 0 && d.value >= listino) {
      errors.push(
        `productDiscount ${d.slug}: prezzo finale ${d.value}EUR >= listino ${listino}EUR (nessuno sconto)`,
      );
    } else if (listino > 0 && d.value < listino * EUR_FINAL_PRICE_MIN_RATIO) {
      errors.push(
        `productDiscount ${d.slug}: ${d.value}EUR sembra uno SCONTO, ma "eur" e' il PREZZO FINALE (listino ${listino}EUR). Correggere il valore.`,
      );
    }
  }
}

export async function normalizePendingSchool(
  doc: PendingSchool,
): Promise<NormalizeResult> {
  const fixes: string[] = [];
  const errors: string[] = [];
  let index: Map<string, ProductIndex>;
  try {
    index = await fetchCatalogIndex();
  } catch {
    // Fail-open: Saleor giu' non deve bloccare la raccolta dati; la validazione
    // vera la rifara' comunque l'enable (Fase B) prima di toccare Saleor.
    return { doc, fixes, errors, skippedValidation: true };
  }

  for (const slug of referencedSlugs(doc)) {
    if (!index.has(slug)) {
      errors.push(
        `Prodotto "${slug}" inesistente su Saleor (default-channel). Slug validi: ${[...index.keys()].join(", ")}`,
      );
    }
  }
  fixVariantSkuCase(doc, index, fixes, errors);
  hideProtectionPlans(doc, index, fixes);
  enforceHeroOutsideBundle(doc, fixes);
  // Dedupe finale: un prodotto hidden non puo' restare anche in visibleSlugs.
  doc.catalog.visibleSlugs = doc.catalog.visibleSlugs.filter(
    (s) => !doc.catalog.hiddenSlugs.includes(s),
  );
  checkDiscounts(doc, index, errors);
  return { doc, fixes, errors, skippedValidation: false };
}
