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
  priceEur: number; // listino pieno della variante (undiscounted, fallback price)
}

interface ProductIndex {
  slug: string;
  name: string;
  isProtectionPlan: boolean;
  minPriceEur: number;
  variants: VariantIndex[];
}

// Sottoinsieme di PendingSchool su cui lavora la normalizzazione: cosi' anche
// l'enable (Fase B) puo' normalizzare un PortalDetail gia' parsato, non solo
// il save dell'agente (che passa il PendingSchool completo).
export interface NormalizableSchool {
  catalog: PendingSchool["catalog"];
  bundles: PendingSchool["bundles"];
}

export interface NormalizeResult<T extends NormalizableSchool = PendingSchool> {
  doc: T;
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
            pricing { price { gross { amount } } priceUndiscounted { gross { amount } } }
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
    pricing: {
      price: { gross: { amount: number } } | null;
      priceUndiscounted: { gross: { amount: number } } | null;
    } | null;
    attributes: Array<{ attribute: { slug: string }; values: Array<{ slug: string }> }>;
  }> | null;
}

function isProtection(node: RawNode): boolean {
  const metaFlag = node.metadata.some(
    (m) => m.key === "isProtectionPlan" && m.value === "true",
  );
  return metaFlag || isProtectionSlug(node.slug);
}

/** True se lo slug e' un piano di protezione (AppleCare, Kyron Shield). Usato
 * anche dall'enable per pubblicarli con visibleInListings=true (il toggle dello
 * storefront li trova solo se visibili; il catalogo li esclude via codice). */
export function isProtectionSlug(slug: string): boolean {
  return PROTECTION_SLUG_PREFIXES.some((p) => slug.startsWith(p));
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
        priceEur:
          v.pricing?.priceUndiscounted?.gross.amount ??
          v.pricing?.price?.gross.amount ??
          0,
        capacities: v.attributes
          .filter((a) => a.attribute.slug === "capacita")
          .flatMap((a) => a.values.map((val) => val.slug)),
      })),
    });
  }
  return index;
}

// Tutti gli slug prodotto referenziati dal descriptor, per la verifica esistenza.
function referencedSlugs(doc: NormalizableSchool): string[] {
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
  doc: NormalizableSchool,
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

// L'LLM a volte referenzia un piano con lo slug abbreviato ("kyron-shield"
// invece di "kyron-shield-ipad"): se il referenziato non esiste ma c'e' UN solo
// protection plan reale col prefisso compatibile, rimappiamo in silenzio (fix,
// non errore) cosi' il save passa al primo colpo senza retry ne' messaggi
// d'allarme al commerciale. Ambiguo (0 o >1 candidati) -> resta errore.
function remapProtectionSlugs(
  doc: NormalizableSchool,
  index: Map<string, ProductIndex>,
  fixes: string[],
): void {
  const realPlans = [...index.values()].filter((p) => p.isProtectionPlan);
  for (const ref of referencedSlugs(doc)) {
    if (index.has(ref) || !isProtectionSlug(ref)) continue;
    const cands = realPlans.filter(
      (p) =>
        p.slug === ref || p.slug.startsWith(`${ref}-`) || ref.startsWith(`${p.slug}-`),
    );
    if (cands.length !== 1) continue;
    replaceSlugEverywhere(doc, ref, cands[0].slug);
    fixes.push(`piano protezione "${ref}" -> "${cands[0].slug}" (slug reale Saleor)`);
  }
}

// Rimpiazza ogni occorrenza di uno slug prodotto nel descriptor (tutte le liste
// che referenziano slug: catalogo, varianti, sconti, componenti dei bundle).
function replaceSlugEverywhere(doc: NormalizableSchool, from: string, to: string): void {
  const swap = (s: string) => (s === from ? to : s);
  doc.catalog.visibleSlugs = doc.catalog.visibleSlugs.map(swap);
  doc.catalog.hiddenSlugs = doc.catalog.hiddenSlugs.map(swap);
  for (const v of doc.catalog.visibleVariants) if (v.productSlug === from) v.productSlug = to;
  for (const d of doc.catalog.productDiscounts ?? []) if (d.slug === from) d.slug = to;
  for (const b of doc.bundles)
    for (const c of b.components) if (c.productSlug === from) c.productSlug = to;
}

// I protection plan non vanno mai a catalogo: hidden-but-purchasable, il
// cross-sell dello storefront li propone quando il device e' nel carrello.
function hideProtectionPlans(
  doc: NormalizableSchool,
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
function enforceHeroOutsideBundle(doc: NormalizableSchool, fixes: string[]): void {
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

// Uno sconto (productDiscount) su un prodotto NON pubblicato sul channel
// fallisce in Saleor con "prodotto non disponibile nei canali" (setVariantPrice/
// promotion su un prodotto senza channel listing): bertoni 2026-06-18, AppleCare
// scontata a 75 ma assente da visible/hidden -> enable morto su prod. Garantiamo
// che ogni slug scontato sia pubblicato: se non e' gia' referenziato altrove lo
// aggiungiamo a hiddenSlugs (i protection plan l'enable li pubblica comunque
// "visible" per il toggle storefront). Brain: gotcha-enable-discount-unpublished-product.
function ensureDiscountedProductsPublished(doc: NormalizableSchool, fixes: string[]): void {
  const published = new Set<string>([
    ...doc.catalog.visibleSlugs,
    ...doc.catalog.hiddenSlugs,
    ...doc.catalog.visibleVariants.map((v) => v.productSlug),
    ...doc.bundles.flatMap((b) => b.components.map((c) => c.productSlug)),
  ]);
  for (const d of doc.catalog.productDiscounts ?? []) {
    if (published.has(d.slug)) continue;
    doc.catalog.hiddenSlugs.push(d.slug);
    published.add(d.slug);
    fixes.push(
      `${d.slug}: sconto su prodotto non pubblicato -> aggiunto a hiddenSlugs (sara' pubblicato sul channel)`,
    );
  }
}

// `eur` = PREZZO FINALE, non sconto: un valore molto sotto il listino e' il
// sintomo classico (es. AppleCare value:4 invece di 75).
// Listino di riferimento per validare un productDiscount eur: se lo sconto e'
// su un taglio (capacity), usa il listino minimo delle SOLE varianti di quel
// taglio; altrimenti il minPriceEur del prodotto. Fallback al minPriceEur se il
// taglio non ha varianti prezzate.
function baselineForDiscount(product: ProductIndex, capacity?: string | null): number {
  if (!capacity) return product.minPriceEur;
  const prices = product.variants
    .filter((v) => v.capacities.includes(capacity) && v.priceEur > 0)
    .map((v) => v.priceEur);
  return prices.length ? Math.min(...prices) : product.minPriceEur;
}

function checkDiscounts(
  doc: NormalizableSchool,
  index: Map<string, ProductIndex>,
  fixes: string[],
  errors: string[],
): void {
  const kept: typeof doc.catalog.productDiscounts = [];
  for (const d of doc.catalog.productDiscounts ?? []) {
    const product = index.get(d.slug);
    if (!product) {
      kept.push(d);
      continue;
    }
    if (d.kind === "percent") {
      if (d.value <= 0 || d.value > 90) {
        errors.push(`productDiscount ${d.slug}: percent ${d.value} fuori range (1-90)`);
      }
      kept.push(d);
      continue;
    }
    // Baseline PER-TAGLIO: uno sconto su un taglio alto (es. iPad 256) va
    // confrontato col listino di QUEL taglio, non col minPriceEur del prodotto
    // (= taglio piu' economico). Senza questo, uno sconto valido su un taglio
    // alto veniva scartato come "finale >= listino" (bug capacity-blind).
    const listino = baselineForDiscount(product, d.capacity);
    if (listino > 0 && d.value >= listino) {
      // finale >= listino = nessuno sconto su quella variante (es. "procedi coi
      // prezzi di listino"): NON e' un errore, scarta la voce (resta a listino).
      fixes.push(`productDiscount ${d.slug}: finale ${d.value}EUR = listino ${listino}EUR -> nessuno sconto, rimosso`);
      continue;
    }
    if (listino > 0 && d.value < listino * EUR_FINAL_PRICE_MIN_RATIO) {
      errors.push(
        `productDiscount ${d.slug}: ${d.value}EUR sembra uno SCONTO, ma "eur" e' il PREZZO FINALE (listino ${listino}EUR). Correggere il valore.`,
      );
    }
    kept.push(d);
  }
  doc.catalog.productDiscounts = kept;
}

export async function normalizePendingSchool<T extends NormalizableSchool>(
  doc: T,
): Promise<NormalizeResult<T>> {
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

  // Prima del check esistenza: auto-correggi gli slug-piano abbreviati, cosi'
  // non finiscono come errore bloccante (causa della frase d'allarme al save).
  remapProtectionSlugs(doc, index, fixes);
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
  ensureDiscountedProductsPublished(doc, fixes);
  // Dedupe finale: un prodotto hidden non puo' restare anche in visibleSlugs.
  doc.catalog.visibleSlugs = doc.catalog.visibleSlugs.filter(
    (s) => !doc.catalog.hiddenSlugs.includes(s),
  );
  checkDiscounts(doc, index, fixes, errors);
  return { doc, fixes, errors, skippedValidation: false };
}
