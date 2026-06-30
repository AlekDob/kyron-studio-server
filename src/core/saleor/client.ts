// Brain: WS04 Phase 3 — gateway Saleor GraphQL per il picker prodotti.
// Query pubblica (no auth), channel-aware. Lo studio-server funge da
// gateway (decision-014) normalizzando il response in formato flat
// compatibile con ProductPicker/BundleBuilder frontend.
//
// Tagli (capacita): i prodotti con attributo variante `capacita` (es. iPad
// 128/256/512) vengono espansi in UNA RIGA PER TAGLIO. Cosi' Studio puo'
// selezionarli/scontarli singolarmente. Il colore resta scelta del cliente al
// checkout (bundle by-attribute). Chiave riga `id`: slug per i prodotti interi,
// `slug#capacitySlug` per i tagli (es. `ipada16#128gb`).
//
// Protezione (Kyron Shield): i piani protezione con piu' varianti distinte solo
// per NOME ("24 mesi"/"36 mesi"), senza attributo Saleor, vengono espansi in UNA
// RIGA PER VARIANTE *solo quando richiesto dal contesto* (BundleBuilder), via
// `opts.expandProtectionVariants`. Chiave riga `id`: `slug#sku` (es.
// `kyron-shield-ipad#KSHIELD24`). Nel ProductPicker (catalogo) restano UN prodotto
// intero, perche' li' servono come prodotto per il toggle add-on storefront
// (Pintor/Pacinotti): espanderli a tappeto romperebbe quel caso.

const DEFAULT_URL = "https://api-staging.kyronedu.it/graphql/";
const DEFAULT_CHANNEL = "default-channel";
const CAPACITY_ATTR = "capacita";
// Prefissi slug dei piani protezione (fallback se il metadata isProtectionPlan
// non c'e'). Allineato a onboard-school/normalize.ts.
const PROTECTION_SLUG_PREFIXES = ["applecare", "kyron-shield"];

export function saleorApiUrl(): string {
  return process.env.SALEOR_API_URL ?? DEFAULT_URL;
}

function getChannel(): string {
  return process.env.SALEOR_DEFAULT_CHANNEL ?? DEFAULT_CHANNEL;
}

interface SaleorProduct {
  // Chiave univoca di riga: slug (prodotto intero), `slug#capacitySlug` (taglio)
  // o `slug#variantSku` (riga-variante protezione).
  id: string;
  slug: string;
  name: string;
  priceEur: number;
  category: string;
  imageUrl?: string;
  // Valorizzati solo per le righe-taglio (prodotti con attributo capacita).
  capacity?: string; // display, es. "128GB"
  capacitySlug?: string; // slug Saleor del valore, es. "128gb"
  // Valorizzati solo per le righe-variante protezione (Kyron Shield 24/36).
  variantSku?: string; // SKU Saleor della variante, es. "KSHIELD24"
  variantLabel?: string; // display, es. "24 mesi"
  // True per i piani protezione (AppleCare, Kyron Shield), indipendentemente
  // dall'espansione. Permette al BundleBuilder di filtrarli per contesto.
  isProtectionPlan?: boolean;
}

interface AttributeValue {
  slug: string;
  name: string;
}

interface VariantNode {
  sku: string;
  name: string; // es. "24 mesi" (serve per le righe-variante protezione)
  attributes: Array<{
    attribute: { slug: string; name: string };
    values: AttributeValue[];
  }>;
  pricing: { price: { gross: { amount: number } } } | null;
}

interface SaleorProductNode {
  slug: string;
  name: string;
  metadata: Array<{ key: string; value: string }>;
  pricing: {
    priceRange: {
      start: { gross: { amount: number; currency: string } };
    };
  } | null;
  category: { name: string; slug: string } | null;
  thumbnail: { url: string; alt: string } | null;
  variants: VariantNode[] | null;
}

interface ProductsResponse {
  data: {
    products: {
      edges: Array<{ node: SaleorProductNode }>;
      totalCount: number;
    };
  };
}

const PRODUCTS_QUERY = `
  query StudioProducts($channel: String!, $first: Int!) {
    products(channel: $channel, first: $first) {
      edges {
        node {
          slug
          name
          metadata { key value }
          pricing {
            priceRange {
              start { gross { amount currency } }
            }
          }
          category { name slug }
          thumbnail(size: 256) { url alt }
          variants {
            sku
            name
            attributes {
              attribute { slug name }
              values { slug name }
            }
            pricing { price { gross { amount } } }
          }
        }
      }
      totalCount
    }
  }
`;

// Estrae il valore dell'attributo capacita da una variante (null se assente).
function capacityOf(v: VariantNode): AttributeValue | null {
  const attr = v.attributes.find((a) => a.attribute.slug === CAPACITY_ATTR);
  return attr?.values[0] ?? null;
}

// True se il prodotto e' un piano protezione (metadata isProtectionPlan o prefisso slug).
function isProtectionPlanNode(node: SaleorProductNode): boolean {
  const metaFlag = node.metadata.some(
    (m) => m.key === "isProtectionPlan" && m.value === "true",
  );
  return (
    metaFlag || PROTECTION_SLUG_PREFIXES.some((p) => node.slug.startsWith(p))
  );
}

// Espande un piano protezione con varianti distinte solo per NOME ("24 mesi"/
// "36 mesi") in una riga per variante. Ritorna null se non e' un protection plan,
// ha <=1 variante, oppure ha varianti per `capacita` (quelle le gestisce
// expandByCapacity). Chiave riga `id`: `slug#sku`.
function expandByVariant(node: SaleorProductNode): SaleorProduct[] | null {
  if (!isProtectionPlanNode(node)) return null;
  const variants = node.variants ?? [];
  if (variants.length <= 1) return null;
  if (variants.some((v) => capacityOf(v))) return null;
  const category = node.category?.name ?? "senza categoria";
  return variants.map((v) => ({
    id: `${node.slug}#${v.sku}`,
    slug: node.slug,
    name: `${node.name} ${v.name}`,
    priceEur: v.pricing?.price.gross.amount ?? 0,
    category,
    imageUrl: node.thumbnail?.url,
    variantSku: v.sku,
    variantLabel: v.name,
    isProtectionPlan: true,
  }));
}

// Espande un prodotto con tagli in una riga per capacita distinta (prezzo = min
// tra le SKU di quel taglio; uniforme per colore). Ritorna null se nessun taglio.
function expandByCapacity(node: SaleorProductNode): SaleorProduct[] | null {
  const byCap = new Map<string, { name: string; price: number }>();
  for (const v of node.variants ?? []) {
    const cap = capacityOf(v);
    if (!cap) continue;
    const price = v.pricing?.price.gross.amount ?? 0;
    const prev = byCap.get(cap.slug);
    if (!prev || price < prev.price) byCap.set(cap.slug, { name: cap.name, price });
  }
  if (byCap.size === 0) return null;
  const category = node.category?.name ?? "senza categoria";
  return Array.from(byCap.entries()).map(([capacitySlug, { name, price }]) => ({
    id: `${node.slug}#${capacitySlug}`,
    slug: node.slug,
    name: `${node.name} ${name}`,
    priceEur: price,
    category,
    imageUrl: node.thumbnail?.url,
    capacity: name,
    capacitySlug,
  }));
}

// Prodotto senza tagli → una riga singola keyed sullo slug. Se ha UNA sola
// variante esponiamo il suo SKU reale: il bundle editor manuale costruisce cosi'
// una selection {kind:"variant", variantSku} corretta invece di usare lo slug
// (gotcha-portal-kit-slug-mismatch). Multi-variante senza `capacita` (es. Kyron
// Shield 24/36) resta senza SKU: la riga non e' aggiungibile come componente
// fisso finche' non viene espansa per variante.
function wholeProduct(node: SaleorProductNode): SaleorProduct {
  const variants = node.variants ?? [];
  const singleSku = variants.length === 1 ? variants[0].sku : undefined;
  return {
    id: node.slug,
    slug: node.slug,
    name: node.name,
    priceEur: node.pricing?.priceRange.start.gross.amount ?? 0,
    category: node.category?.name ?? "senza categoria",
    imageUrl: node.thumbnail?.url,
    ...(singleSku ? { variantSku: singleSku } : {}),
    ...(isProtectionPlanNode(node) ? { isProtectionPlan: true } : {}),
  };
}

interface FetchOptions {
  // BundleBuilder: espande i piani protezione multi-variante (Kyron Shield) in
  // righe 24/36. Default false: nel catalogo (ProductPicker) restano interi per
  // il toggle add-on storefront (NODO Pintor/Pacinotti).
  expandProtectionVariants?: boolean;
}

export async function fetchSaleorProducts(
  channel?: string,
  first = 100,
  opts?: FetchOptions,
): Promise<SaleorProduct[]> {
  const res = await fetch(saleorApiUrl(), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      query: PRODUCTS_QUERY,
      variables: { channel: channel ?? getChannel(), first },
    }),
  });

  if (!res.ok) {
    throw new Error(`Saleor ${res.status}: ${await res.text()}`);
  }

  const json = (await res.json()) as ProductsResponse;
  return json.data.products.edges.flatMap(({ node }) => {
    // L'espansione per variante (protezione) e' condizionata al contesto: solo
    // il BundleBuilder la chiede. expandByCapacity resta sempre attiva (iPad).
    const varianti = opts?.expandProtectionVariants ? expandByVariant(node) : null;
    const tagli = expandByCapacity(node);
    return varianti ?? tagli ?? [wholeProduct(node)];
  });
}
