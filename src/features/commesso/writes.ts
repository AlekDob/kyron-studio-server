// Scritture catalogo di Kevin. Nessuna di queste funzioni tocca un prezzo:
// i prezzi passano solo da price-writes.ts (money-path, un punto solo).
//
// R3 — dopo create/update il prodotto NON viene pubblicato su nessun canale.
// L'enable dei portali non de-lista i tagli vecchi, quindi una variante nuova
// pubblicata a tappeto diventerebbe comprabile dove non deve. La pubblicazione
// e' un gesto esplicito, non un effetto collaterale della creazione.
import {
  adminRequest,
  checkErrors,
  type SaleorTarget,
} from "@/features/portals/enable/saleor-admin.js";

type Errors = Array<{ field?: string | null; message: string }>;

// Le description Saleor sono JSONString EditorJS: il testo che scrive Kevin va
// impacchettato, altrimenti l'admin lo mostra vuoto.
function toEditorJs(text: string): string {
  return JSON.stringify({
    time: 0,
    blocks: text
      .split(/\n{2,}/)
      .filter(Boolean)
      .map((t) => ({ type: "paragraph", data: { text: t } })),
    version: "2.24.3",
  });
}

export interface CreateProductInput {
  name: string;
  slug: string;
  productTypeId: string;
  categorySlug: string;
  description?: string;
}

async function categoryId(target: SaleorTarget, slug: string): Promise<string> {
  const data = await adminRequest<{ category: { id: string } | null }>(
    target,
    `query ($slug: String!) { category(slug: $slug) { id } }`,
    { slug },
  );
  if (!data.category) throw new Error(`Categoria "${slug}" non trovata su ${target}`);
  return data.category.id;
}

/** Crea il prodotto. Non pubblica, non prezza: sono passi separati (R3, R2). */
export async function createProduct(
  target: SaleorTarget,
  input: CreateProductInput,
): Promise<{ id: string; slug: string }> {
  const data = await adminRequest<{
    productCreate: { product: { id: string; slug: string } | null; errors: Errors };
  }>(
    target,
    `mutation ($input: ProductCreateInput!) {
      productCreate(input: $input) { product { id slug } errors { field message } }
    }`,
    {
      input: {
        name: input.name,
        slug: input.slug,
        productType: input.productTypeId,
        category: await categoryId(target, input.categorySlug),
        ...(input.description ? { description: toEditorJs(input.description) } : {}),
      },
    },
  );
  checkErrors(data.productCreate.errors, "productCreate");
  const product = data.productCreate.product;
  if (!product) throw new Error("productCreate non ha restituito il prodotto");
  return product;
}

export interface UpdateProductInput {
  name?: string;
  description?: string;
  categorySlug?: string;
}

export async function updateProduct(
  target: SaleorTarget,
  productId: string,
  patch: UpdateProductInput,
): Promise<void> {
  const input: Record<string, unknown> = {};
  if (patch.name) input.name = patch.name;
  if (patch.description) input.description = toEditorJs(patch.description);
  if (patch.categorySlug) input.category = await categoryId(target, patch.categorySlug);
  if (!Object.keys(input).length) throw new Error("Nessun campo da aggiornare");

  const data = await adminRequest<{ productUpdate: { errors: Errors } }>(
    target,
    `mutation ($id: ID!, $input: ProductInput!) {
      productUpdate(id: $id, input: $input) { errors { field message } }
    }`,
    { id: productId, input },
  );
  checkErrors(data.productUpdate.errors, "productUpdate");
}

/** Crea o rinomina una variante. Il prezzo resta fuori: R2. */
export async function upsertVariant(
  target: SaleorTarget,
  args: { productId: string; sku: string; name: string; variantId?: string },
): Promise<{ id: string }> {
  if (args.variantId) {
    const data = await adminRequest<{ productVariantUpdate: { errors: Errors } }>(
      target,
      `mutation ($id: ID!, $input: ProductVariantInput!) {
        productVariantUpdate(id: $id, input: $input) { errors { field message } }
      }`,
      { id: args.variantId, input: { name: args.name, sku: args.sku } },
    );
    checkErrors(data.productVariantUpdate.errors, "productVariantUpdate");
    return { id: args.variantId };
  }
  const data = await adminRequest<{
    productVariantCreate: { productVariant: { id: string } | null; errors: Errors };
  }>(
    target,
    `mutation ($input: ProductVariantCreateInput!) {
      productVariantCreate(input: $input) {
        productVariant { id } errors { field message }
      }
    }`,
    // attributes: [] e' obbligatorio anche quando non ce ne sono.
    { input: { product: args.productId, sku: args.sku, name: args.name, attributes: [] } },
  );
  checkErrors(data.productVariantCreate.errors, "productVariantCreate");
  const variant = data.productVariantCreate.productVariant;
  if (!variant) throw new Error("productVariantCreate non ha restituito la variante");
  return variant;
}

export async function setStock(
  target: SaleorTarget,
  args: { variantId: string; warehouseId: string; quantity: number },
): Promise<void> {
  if (!Number.isInteger(args.quantity) || args.quantity < 0) {
    throw new Error(`Giacenza non valida: ${args.quantity}`);
  }
  const data = await adminRequest<{ productVariantStocksUpdate: { errors: Errors } }>(
    target,
    `mutation ($id: ID!, $stocks: [StockInput!]!) {
      productVariantStocksUpdate(variantId: $id, stocks: $stocks) {
        errors { field message }
      }
    }`,
    {
      id: args.variantId,
      stocks: [{ warehouse: args.warehouseId, quantity: args.quantity }],
    },
  );
  checkErrors(data.productVariantStocksUpdate.errors, "productVariantStocksUpdate");
}

/** Immagine da URL: Saleor la scarica lui, non passiamo per il multipart. */
export async function addProductImage(
  target: SaleorTarget,
  args: { productId: string; imageUrl: string; alt?: string },
): Promise<void> {
  const data = await adminRequest<{ productMediaCreate: { errors: Errors } }>(
    target,
    `mutation ($input: ProductMediaCreateInput!) {
      productMediaCreate(input: $input) { errors { field message } }
    }`,
    {
      input: {
        product: args.productId,
        mediaUrl: args.imageUrl,
        alt: args.alt ?? "",
      },
    },
  );
  checkErrors(data.productMediaCreate.errors, "productMediaCreate");
}

/** Pubblicazione esplicita su un canale (R3: mai automatica). */
export async function publishOnChannel(
  target: SaleorTarget,
  args: { productId: string; channelId: string; visibleInListings: boolean },
): Promise<void> {
  const data = await adminRequest<{ productChannelListingUpdate: { errors: Errors } }>(
    target,
    `mutation ($id: ID!, $input: ProductChannelListingUpdateInput!) {
      productChannelListingUpdate(id: $id, input: $input) {
        errors { field message }
      }
    }`,
    {
      id: args.productId,
      input: {
        updateChannels: [
          {
            channelId: args.channelId,
            isPublished: true,
            isAvailableForPurchase: true,
            visibleInListings: args.visibleInListings,
          },
        ],
      },
    },
  );
  checkErrors(data.productChannelListingUpdate.errors, "productChannelListingUpdate");
}
