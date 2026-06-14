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

const DEFAULT_URL = "https://api-staging.kyronedu.it/graphql/";
const DEFAULT_CHANNEL = "default-channel";
const CAPACITY_ATTR = "capacita";

export function saleorApiUrl(): string {
  return process.env.SALEOR_API_URL ?? DEFAULT_URL;
}

function getChannel(): string {
  return process.env.SALEOR_DEFAULT_CHANNEL ?? DEFAULT_CHANNEL;
}

interface SaleorProduct {
  // Chiave univoca di riga: slug (prodotto intero) o `slug#capacitySlug` (taglio).
  id: string;
  slug: string;
  name: string;
  priceEur: number;
  category: string;
  imageUrl?: string;
  // Valorizzati solo per le righe-taglio (prodotti con attributo capacita).
  capacity?: string; // display, es. "128GB"
  capacitySlug?: string; // slug Saleor del valore, es. "128gb"
}

interface AttributeValue {
  slug: string;
  name: string;
}

interface VariantNode {
  sku: string;
  attributes: Array<{
    attribute: { slug: string; name: string };
    values: AttributeValue[];
  }>;
  pricing: { price: { gross: { amount: number } } } | null;
}

interface SaleorProductNode {
  slug: string;
  name: string;
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
          pricing {
            priceRange {
              start { gross { amount currency } }
            }
          }
          category { name slug }
          thumbnail(size: 256) { url alt }
          variants {
            sku
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

// Prodotto senza tagli → una riga singola keyed sullo slug.
function wholeProduct(node: SaleorProductNode): SaleorProduct {
  return {
    id: node.slug,
    slug: node.slug,
    name: node.name,
    priceEur: node.pricing?.priceRange.start.gross.amount ?? 0,
    category: node.category?.name ?? "senza categoria",
    imageUrl: node.thumbnail?.url,
  };
}

export async function fetchSaleorProducts(
  channel?: string,
  first = 100,
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
    const tagli = expandByCapacity(node);
    return tagli ?? [wholeProduct(node)];
  });
}
