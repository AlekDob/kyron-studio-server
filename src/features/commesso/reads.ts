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
  /** Se c'e', tiene solo i prodotti listati su questo canale (pubblicati o con prezzo). */
  channelSlug?: string;
}

/** True se il prodotto e' pubblicato o ha un prezzo su quel canale. */
export function productOnChannel(p: ProductRow, channelSlug: string): boolean {
  if (p.channels.includes(channelSlug)) return true;
  return p.variants.some((v) =>
    v.channels.some((c) => c.channelSlug === channelSlug),
  );
}

/** Riduce i listing al canale chiesto: meno rumore per il modello, stessi prodotti. */
export function narrowProductToChannel(p: ProductRow, channelSlug: string): ProductRow {
  return {
    ...p,
    channels: p.channels.filter((s) => s === channelSlug),
    variants: p.variants.map((v) => ({
      ...v,
      channels: v.channels.filter((c) => c.channelSlug === channelSlug),
    })),
  };
}

function normChannel(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, "");
}

/** 'orsoline' → orsoline-san-carlo. Un hit solo. Zero o tanti → candidates. */
export function resolveChannelSlug(
  query: string,
  channels: Array<{ slug: string; name: string }>,
): { slug: string } | { candidates: Array<{ slug: string; name: string }> } {
  const q = query.trim();
  if (!q) return { candidates: [] };
  const exact = channels.find((c) => c.slug.toLowerCase() === q.toLowerCase());
  if (exact) return { slug: exact.slug };
  const nq = normChannel(q);
  const hits = channels.filter(
    (c) => normChannel(c.slug).includes(nq) || normChannel(c.name).includes(nq),
  );
  if (hits.length === 1) return { slug: hits[0].slug };
  return { candidates: hits };
}

/**
 * Saleor rifiuta `first` > 100 su ogni connection ("Limit of 100 exceeded").
 * Le pagine oltre la prima si prendono con `after`. Chiedere 200 in un colpo
 * fa cadere `plan_danea_import` anche su un XML da 50 righe: il tetto e' della
 * query catalogo, non del file Danea.
 */
export const SALEOR_PAGE_MAX = 100;

export function nextSaleorPageSize(have: number, wanted: number): number {
  return Math.min(SALEOR_PAGE_MAX, Math.max(0, wanted - have));
}

/**
 * La ricerca la facciamo noi, non Saleor. Il `filter: { search }` di Saleor si
 * appoggia a una colonna di ricerca del database che su questa installazione e'
 * vuota: cercare "iPad" tornava zero risultati anche con l'iPad in catalogo.
 * Scarichiamo fino a `limit` prodotti (a pagine da 100) e filtriamo in memoria.
 */
export function matchesSearch(p: ProductRow, search: string): boolean {
  const q = search.trim().toLowerCase();
  if (!q) return true;
  const haystack = [
    p.name,
    p.slug,
    p.category ?? "",
    ...p.variants.flatMap((v) => [
      v.sku,
      v.name,
      ...v.attributes.map((a) => a.value),
    ]),
  ]
    .join(" ")
    .toLowerCase();
  return q.split(/\s+/).every((word) => haystack.includes(word));
}

/** Catalogo completo (anche non pubblicato), opzionalmente filtrato per testo. */
export async function listProducts(
  target: SaleorTarget,
  opts: ListProductsOptions = {},
): Promise<ProductRow[]> {
  // Senza tetto alto la ricerca per canale vede solo i primi 100 prodotti
  // Saleor (ordine interno, non "i piu' venduti") e Orsoline sparisce.
  const wanted = Math.max(
    1,
    opts.limit ?? (opts.search || opts.channelSlug ? 500 : SALEOR_PAGE_MAX),
  );
  const rows: ProductRow[] = [];
  let after: string | null = null;
  do {
    const first = nextSaleorPageSize(rows.length, wanted);
    if (first === 0) break;
    const data = (await adminRequest(
      target,
      `query ($first: Int!, $after: String) {
        products(first: $first, after: $after) {
          edges { node { ${PRODUCT_FIELDS} } }
          pageInfo { hasNextPage endCursor }
        }
      }`,
      { first, after },
    )) as {
      products: {
        edges: Array<{ node: RawProduct }>;
        pageInfo: { hasNextPage: boolean; endCursor: string | null };
      };
    };
    const conn = data.products;
    rows.push(...conn.edges.map((e: { node: RawProduct }) => toProduct(e.node)));
    after = conn.pageInfo.hasNextPage && rows.length < wanted ? conn.pageInfo.endCursor : null;
  } while (after);
  const searched = opts.search ? rows.filter((p) => matchesSearch(p, opts.search!)) : rows;
  if (!opts.channelSlug) return searched;
  return searched.filter((p) => productOnChannel(p, opts.channelSlug!));
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
  const portals = await portalNamesBySlug();
  return {
    channels: data.channels.map((c) => ({
      slug: c.slug,
      name: portals.get(c.slug) ?? c.name,
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
  const portals = await portalNamesBySlug();
  return data.channels.map((c) => ({ slug: c.slug, name: portals.get(c.slug) ?? c.name }));
}

async function portalNamesBySlug(): Promise<Map<string, string>> {
  try {
    const list = await listPortals();
    return new Map(list.map((p) => [p.slug, p.nome]));
  } catch (e) {
    console.warn("[commesso] portal names unavailable:", String(e));
    return new Map();
  }
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
