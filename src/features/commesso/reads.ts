// Letture catalogo per Nico (modulo Commesso). Passano dall'admin API e non
// dal client pubblico di core/saleor: qui servono anche i prodotti non
// pubblicati, le giacenze e i prezzi per singolo canale, che la query pubblica
// non espone.
import { adminRequest, type SaleorTarget } from "@/features/portals/enable/saleor-admin.js";
import { listPortals } from "@/features/portals/reader.js";

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

/**
 * La ricerca la facciamo noi, non Saleor. Il `filter: { search }` di Saleor si
 * appoggia a una colonna di ricerca del database che su questa installazione e'
 * vuota: cercare "iPad" tornava zero risultati anche con l'iPad in catalogo.
 * Il catalogo sta in una pagina, quindi filtrare qui costa niente ed e' immune
 * al problema.
 * ponytail: filtro in memoria sulla prima pagina. Se il catalogo passa le 200
 * righe serve la ricerca vera (search vector di Saleor da ripopolare).
 */
export function matchesSearch(p: ProductRow, search: string): boolean {
  const q = search.trim().toLowerCase();
  if (!q) return true;
  const haystack = [p.name, p.slug, p.category ?? "", ...p.variants.map((v) => v.sku)]
    .join(" ")
    .toLowerCase();
  return q.split(/\s+/).every((word) => haystack.includes(word));
}

/** Catalogo completo (anche non pubblicato), opzionalmente filtrato per testo. */
export async function listProducts(
  target: SaleorTarget,
  opts: ListProductsOptions = {},
): Promise<ProductRow[]> {
  const data = await adminRequest<{ products: { edges: Array<{ node: RawProduct }> } }>(
    target,
    `query ($first: Int!) {
      products(first: $first) {
        edges { node { ${PRODUCT_FIELDS} } }
      }
    }`,
    { first: Math.min(opts.limit ?? 100, 200) },
  );
  const rows = data.products.edges.map((e) => toProduct(e.node));
  return opts.search ? rows.filter((p) => matchesSearch(p, opts.search!)) : rows;
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

/**
 * Canali con il nome leggibile della scuola. Il nome vero sta su Payload
 * (pending-schools.nome); il nome canale Saleor e' il fallback per il main shop
 * e per i portali pilot che non hanno il doc Payload.
 */
export async function getChannelDirectory(
  target: SaleorTarget,
): Promise<Array<{ slug: string; name: string }>> {
  const data = await adminRequest<{ channels: Array<{ slug: string; name: string }> }>(
    target,
    `query { channels { slug name } }`,
  );
  let portals = new Map<string, string>();
  try {
    const list = await listPortals();
    portals = new Map(list.map((p) => [p.slug, p.nome]));
  } catch (e) {
    console.warn("[commesso] portal names unavailable:", String(e));
  }
  return data.channels.map((c) => ({ slug: c.slug, name: portals.get(c.slug) ?? c.name }));
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
