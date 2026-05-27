// Brain: WS04 Phase 3 — gateway Saleor GraphQL per il picker prodotti.
// Query pubblica (no auth), channel-aware. Lo studio-server funge da
// gateway (decision-014) normalizzando il response in formato flat
// compatibile con ProductPicker/BundleBuilder frontend.

const DEFAULT_URL = "https://api-staging.kyronedu.it/graphql/";
const DEFAULT_CHANNEL = "default-channel";

function getUrl(): string {
  return process.env.SALEOR_API_URL ?? DEFAULT_URL;
}

function getChannel(): string {
  return process.env.SALEOR_DEFAULT_CHANNEL ?? DEFAULT_CHANNEL;
}

interface SaleorProduct {
  slug: string;
  name: string;
  priceEur: number;
  category: string;
  imageUrl?: string;
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
        }
      }
      totalCount
    }
  }
`;

export async function fetchSaleorProducts(
  channel?: string,
  first = 100,
): Promise<SaleorProduct[]> {
  const res = await fetch(getUrl(), {
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
  return json.data.products.edges.map(({ node }) => ({
    slug: node.slug,
    name: node.name,
    priceEur:
      node.pricing?.priceRange.start.gross.amount ?? 0,
    category: node.category?.name ?? "senza categoria",
    imageUrl: node.thumbnail?.url,
  }));
}
