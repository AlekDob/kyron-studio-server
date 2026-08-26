// Letture catalogo per Nico (modulo Commesso). Passano dall'admin API e non
// dal client pubblico di core/saleor: qui servono anche i prodotti non
// pubblicati, le giacenze e i prezzi per singolo canale, che la query pubblica
// non espone.
import { adminRequest, type SaleorTarget } from "@/features/portals/enable/saleor-admin.js";

export interface VariantChannelPrice {
  channelSlug: string;
  priceEur: number | null;
  published: boolean;
}

export interface VariantRow {
  id: string;
  sku: string;
  name: string;
  stock: number;
  /** Attributi variante (capacita, colore) come coppie leggibili. */
  attributes: Array<{ name: string; value: string }>;
  channels: VariantChannelPrice[];
}

export interface ProductRow {
  id: string;
  slug: string;
  name: string;
  category: string | null;
  productType: string;
  description: string;
  imageUrl: string | null;
  channels: string[];
  variants: VariantRow[];
}

const PRODUCT_FIELDS = `
  id slug name
  description
  category { name }
  productType { name }
  thumbnail(size: 256) { url }
  channelListings { channel { slug } isPublished }
  variants {
    id sku name
    quantityAvailable
    attributes { attribute { name } values { name } }
    channelListings { channel { slug } price { amount } }
  }
`;

interface RawVariant {
  id: string;
  sku: string | null;
  name: string;
  quantityAvailable: number | null;
  attributes: Array<{ attribute: { name: string }; values: Array<{ name: string }> }>;
  channelListings: Array<{ channel: { slug: string }; price: { amount: number } | null }> | null;
}

interface RawProduct {
  id: string;
  slug: string;
  name: string;
  description: string | null;
  category: { name: string } | null;
  productType: { name: string };
  thumbnail: { url: string } | null;
  channelListings: Array<{ channel: { slug: string }; isPublished: boolean }> | null;
  variants: RawVariant[] | null;
}

// La description Saleor e' un JSONString EditorJS: per la chat serve il testo,
// non il documento. Estraiamo i paragrafi e buttiamo il resto.
function plainDescription(raw: string | null): string {
  if (!raw) return "";
  try {
    const doc = JSON.parse(raw) as { blocks?: Array<{ data?: { text?: string } }> };
    return (doc.blocks ?? [])
      .map((b) => b.data?.text ?? "")
      .filter(Boolean)
      .join("\n\n")
      .replace(/<[^>]+>/g, "");
  } catch {
    return raw;
  }
}

function toVariant(v: RawVariant): VariantRow {
  return {
    id: v.id,
    sku: v.sku ?? "",
    name: v.name,
    stock: v.quantityAvailable ?? 0,
    attributes: v.attributes.flatMap((a) =>
      a.values.map((val) => ({ name: a.attribute.name, value: val.name })),
    ),
    channels: (v.channelListings ?? []).map((cl) => ({
      channelSlug: cl.channel.slug,
      priceEur: cl.price?.amount ?? null,
      published: true,
    })),
  };
}

function toProduct(p: RawProduct): ProductRow {
  return {
    id: p.id,
    slug: p.slug,
    name: p.name,
    category: p.category?.name ?? null,
    productType: p.productType.name,
    description: plainDescription(p.description),
    imageUrl: p.thumbnail?.url ?? null,
    channels: (p.channelListings ?? [])
      .filter((cl) => cl.isPublished)
      .map((cl) => cl.channel.slug),
    variants: (p.variants ?? []).map(toVariant),
  };
}

export interface ListProductsOptions {
  search?: string;
  limit?: number;
}

/** Catalogo completo (anche non pubblicato), opzionalmente filtrato per testo. */
export async function listProducts(
  target: SaleorTarget,
  opts: ListProductsOptions = {},
): Promise<ProductRow[]> {
  const data = await adminRequest<{ products: { edges: Array<{ node: RawProduct }> } }>(
    target,
    `query ($first: Int!, $search: String) {
      products(first: $first, filter: { search: $search }) {
        edges { node { ${PRODUCT_FIELDS} } }
      }
    }`,
    { first: Math.min(opts.limit ?? 100, 200), search: opts.search ?? null },
  );
  return data.products.edges.map((e) => toProduct(e.node));
}

export async function getProduct(
  target: SaleorTarget,
  slug: string,
): Promise<ProductRow | null> {
  const data = await adminRequest<{ product: RawProduct | null }>(
    target,
    `query ($slug: String!) { product(slug: $slug) { ${PRODUCT_FIELDS} } }`,
    { slug },
  );
  return data.product ? toProduct(data.product) : null;
}

export interface CatalogMeta {
  channels: Array<{ slug: string; name: string; currency: string }>;
  categories: Array<{ slug: string; name: string }>;
  productTypes: Array<{ id: string; name: string; hasVariants: boolean }>;
  warehouses: Array<{ id: string; name: string }>;
}

/** Le liste di riferimento che servono per creare un prodotto senza inventare id. */
export async function getCatalogMeta(target: SaleorTarget): Promise<CatalogMeta> {
  const data = await adminRequest<{
    channels: Array<{ slug: string; name: string; currencyCode: string }>;
    categories: { edges: Array<{ node: { slug: string; name: string } }> };
    productTypes: { edges: Array<{ node: { id: string; name: string; hasVariants: boolean } }> };
    warehouses: { edges: Array<{ node: { id: string; name: string } }> };
  }>(
    target,
    `query {
      channels { slug name currencyCode }
      categories(first: 100) { edges { node { slug name } } }
      productTypes(first: 50) { edges { node { id name hasVariants } } }
      warehouses(first: 20) { edges { node { id name } } }
    }`,
  );
  return {
    channels: data.channels.map((c) => ({
      slug: c.slug,
      name: c.name,
      currency: c.currencyCode,
    })),
    categories: data.categories.edges.map((e) => e.node),
    productTypes: data.productTypes.edges.map((e) => e.node),
    warehouses: data.warehouses.edges.map((e) => e.node),
  };
}

/** Prezzo attuale di una variante su un canale. Usato dal drift check. */
export async function readVariantPrice(
  target: SaleorTarget,
  variantId: string,
  channelSlug: string,
): Promise<number | null> {
  const data = await adminRequest<{
    productVariant: {
      channelListings: Array<{ channel: { slug: string }; price: { amount: number } | null }> | null;
    } | null;
  }>(
    target,
    `query ($id: ID!) {
      productVariant(id: $id) {
        channelListings { channel { slug } price { amount } }
      }
    }`,
    { id: variantId },
  );
  const listing = (data.productVariant?.channelListings ?? []).find(
    (cl) => cl.channel.slug === channelSlug,
  );
  return listing?.price?.amount ?? null;
}
