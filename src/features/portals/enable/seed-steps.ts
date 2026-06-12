// Brain: Fase B pipeline onboarding — port server-side degli step Saleor di
// ecommerce/seed/onboard-school.ts (channel, shipping, visibility+pricing,
// productDiscounts come Promotion, voucher bundle). Idempotente: ogni step e'
// un ensure. La logica replica 1:1 il seed CLI, inclusi i gotcha documentati
// (hidden-but-purchasable, listino pieno come baseline del barrato,
// applyOncePerOrder:false sui voucher FIXED).
import {
  adminRequest,
  checkErrors,
  type SaleorTarget,
} from "./saleor-admin.js";
import type { EnablePortalConfig, BundleConfig } from "./config.js";

export type { SaleorTarget };

const ZONE_NAME = "Italia";
const CAPACITY_ATTR = "capacita";

export interface VariantRef {
  id: string;
  sku: string;
  attributes: Array<{
    attribute: { slug: string };
    values: Array<{ slug: string }>;
  }>;
  priceAmount: number;
  undiscountedAmount: number;
}

export interface ProductRef {
  id: string;
  slug: string;
  variants: VariantRef[];
}

export function variantHasCapacity(v: VariantRef, capacitySlug: string): boolean {
  const attr = v.attributes.find((a) => a.attribute.slug === CAPACITY_ATTR);
  return Boolean(attr?.values.some((val) => val.slug === capacitySlug));
}

export async function fetchProduct(
  target: SaleorTarget,
  slug: string,
  channel: string,
  cache: Map<string, ProductRef>,
): Promise<ProductRef | null> {
  const cached = cache.get(slug);
  if (cached) return cached;
  const data = await adminRequest<{
    product: {
      id: string;
      slug: string;
      variants: Array<{
        id: string;
        sku: string;
        attributes: VariantRef["attributes"];
        pricing: {
          price: { gross: { amount: number } };
          priceUndiscounted: { gross: { amount: number } } | null;
        } | null;
      }>;
    } | null;
  }>(
    target,
    `query ($slug: String!, $channel: String!) {
      product(slug: $slug, channel: $channel) {
        id slug
        variants {
          id sku
          attributes { attribute { slug } values { slug } }
          pricing { price { gross { amount } } priceUndiscounted { gross { amount } } }
        }
      }
    }`,
    { slug, channel },
  );
  if (!data.product) return null;
  const ref: ProductRef = {
    id: data.product.id,
    slug: data.product.slug,
    variants: data.product.variants.map((v) => ({
      id: v.id,
      sku: v.sku,
      attributes: v.attributes,
      priceAmount: v.pricing?.price.gross.amount ?? 0,
      undiscountedAmount:
        v.pricing?.priceUndiscounted?.gross.amount ??
        v.pricing?.price.gross.amount ??
        0,
    })),
  };
  cache.set(slug, ref);
  return ref;
}

export async function ensureChannel(
  target: SaleorTarget,
  slug: string,
  name: string,
): Promise<{ id: string; created: boolean }> {
  const list = await adminRequest<{ channels: Array<{ id: string; slug: string }> }>(
    target,
    `query { channels { id slug } }`,
  );
  const existing = list.channels.find((c) => c.slug === slug);
  if (existing) return { id: existing.id, created: false };
  const created = await adminRequest<{
    channelCreate: {
      channel: { id: string } | null;
      errors: Array<{ field: string | null; message: string }>;
    };
  }>(
    target,
    `mutation ($input: ChannelCreateInput!) {
      channelCreate(input: $input) { channel { id } errors { field message } }
    }`,
    { input: { name, slug, currencyCode: "EUR", defaultCountry: "IT" } },
  );
  checkErrors(created.channelCreate.errors, "channelCreate");
  const id = created.channelCreate.channel?.id;
  if (!id) throw new Error("channelCreate returned null");
  await adminRequest(
    target,
    `mutation ($id: ID!) { channelActivate(id: $id) { errors { message } } }`,
    { id },
  );
  return { id, created: true };
}

export async function ensureShipping(
  target: SaleorTarget,
  channelId: string,
  methodName: string,
  priceEur: number,
): Promise<void> {
  const zones = await adminRequest<{
    shippingZones: {
      edges: Array<{
        node: {
          id: string;
          name: string;
          channels: Array<{ id: string }>;
          shippingMethods: Array<{ id: string; name: string }>;
        };
      }>;
    };
  }>(
    target,
    `query { shippingZones(first: 50) { edges { node {
      id name channels { id } shippingMethods { id name }
    } } } }`,
  );
  let zone = zones.shippingZones.edges.find((e) => e.node.name === ZONE_NAME)?.node;
  if (!zone) {
    const created = await adminRequest<{
      shippingZoneCreate: {
        shippingZone: typeof zone | null;
        errors: Array<{ field: string | null; message: string }>;
      };
    }>(
      target,
      `mutation ($input: ShippingZoneCreateInput!) {
        shippingZoneCreate(input: $input) {
          shippingZone { id name channels { id } shippingMethods { id name } }
          errors { field message }
        }
      }`,
      { input: { name: ZONE_NAME, countries: ["IT"], addChannels: [channelId] } },
    );
    checkErrors(created.shippingZoneCreate.errors, "shippingZoneCreate");
    zone = created.shippingZoneCreate.shippingZone ?? undefined;
    if (!zone) throw new Error("shippingZoneCreate returned null");
  } else if (!zone.channels.some((c) => c.id === channelId)) {
    await adminRequest(
      target,
      `mutation ($id: ID!, $input: ShippingZoneUpdateInput!) {
        shippingZoneUpdate(id: $id, input: $input) { errors { message } }
      }`,
      { id: zone.id, input: { addChannels: [channelId] } },
    );
  }
  let methodId = zone.shippingMethods.find((m) => m.name === methodName)?.id;
  if (!methodId) {
    const created = await adminRequest<{
      shippingPriceCreate: {
        shippingMethod: { id: string } | null;
        errors: Array<{ field: string | null; message: string }>;
      };
    }>(
      target,
      `mutation ($input: ShippingPriceInput!) {
        shippingPriceCreate(input: $input) { shippingMethod { id } errors { field message } }
      }`,
      { input: { name: methodName, type: "PRICE", shippingZone: zone.id } },
    );
    checkErrors(created.shippingPriceCreate.errors, "shippingPriceCreate");
    methodId = created.shippingPriceCreate.shippingMethod?.id;
    if (!methodId) throw new Error("shippingPriceCreate returned null");
  }
  await adminRequest(
    target,
    `mutation ($id: ID!, $input: ShippingMethodChannelListingInput!) {
      shippingMethodChannelListingUpdate(id: $id, input: $input) { errors { message } }
    }`,
    { id: methodId, input: { addChannels: [{ channelId, price: priceEur }] } },
  );
}

// gotcha-saleor-bundle-hidden-but-purchasable: hidden = isPublished:true +
// visibleInListings:false + isAvailableForPurchase:true, MAI tutto false.
export async function setVisibility(
  target: SaleorTarget,
  productId: string,
  channelId: string,
  mode: "visible" | "hidden-purchasable",
): Promise<void> {
  const flags =
    mode === "visible"
      ? { isPublished: true, visibleInListings: true, isAvailableForPurchase: true }
      : { isPublished: true, visibleInListings: false, isAvailableForPurchase: true };
  const data = await adminRequest<{
    productChannelListingUpdate: {
      errors: Array<{ field: string | null; message: string }>;
    };
  }>(
    target,
    `mutation ($id: ID!, $input: ProductChannelListingUpdateInput!) {
      productChannelListingUpdate(id: $id, input: $input) { errors { field message } }
    }`,
    { id: productId, input: { updateChannels: [{ channelId, ...flags }] } },
  );
  checkErrors(data.productChannelListingUpdate.errors, "productChannelListingUpdate");
}

export async function setVariantPrice(
  target: SaleorTarget,
  variantId: string,
  channelId: string,
  price: number,
): Promise<void> {
  const data = await adminRequest<{
    productVariantChannelListingUpdate: {
      errors: Array<{ field: string | null; message: string }>;
    };
  }>(
    target,
    `mutation ($id: ID!, $input: [ProductVariantChannelListingAddInput!]!) {
      productVariantChannelListingUpdate(id: $id, input: $input) { errors { field message } }
    }`,
    { id: variantId, input: [{ channelId, price }] },
  );
  checkErrors(
    data.productVariantChannelListingUpdate.errors,
    "productVariantChannelListingUpdate",
  );
}

// Promotion CATALOGUE per-variante, idempotente per nome (delete+create).
export async function upsertPromotion(
  target: SaleorTarget,
  input: {
    name: string;
    ruleName: string;
    rewardValueType: "PERCENTAGE" | "FIXED";
    rewardValue: number;
    variantIds: string[];
    channelId: string;
  },
): Promise<void> {
  const list = await adminRequest<{
    promotions: { edges: Array<{ node: { id: string; name: string } }> };
  }>(target, `query { promotions(first: 100) { edges { node { id name } } } }`);
  const existing = list.promotions.edges.find((e) => e.node.name === input.name);
  if (existing) {
    await adminRequest(
      target,
      `mutation ($id: ID!) { promotionDelete(id: $id) { errors { message } } }`,
      { id: existing.node.id },
    );
  }
  const created = await adminRequest<{
    promotionCreate: {
      promotion: { id: string } | null;
      errors: Array<{ field: string | null; message: string }>;
    };
  }>(
    target,
    `mutation ($input: PromotionCreateInput!) {
      promotionCreate(input: $input) { promotion { id } errors { field message } }
    }`,
    {
      input: {
        name: input.name,
        type: "CATALOGUE",
        startDate: new Date().toISOString(),
        rules: [
          {
            name: input.ruleName,
            cataloguePredicate: { variantPredicate: { ids: input.variantIds } },
            rewardValueType: input.rewardValueType,
            rewardValue: input.rewardValue,
            channels: [input.channelId],
          },
        ],
      },
    },
  );
  checkErrors(created.promotionCreate.errors, "promotionCreate");
}

// Voucher ENTIRE_ORDER FIXED auto-applicato (decision-011).
// gotcha applyOncePerOrder: true capperebbe lo sconto alla riga piu' economica.
export async function ensureVoucher(
  target: SaleorTarget,
  params: { channelId: string; code: string; name: string; discountEur: number },
): Promise<string> {
  const search = await adminRequest<{
    vouchers: {
      edges: Array<{
        node: {
          id: string;
          codes: { edges: Array<{ node: { code: string } }> };
        };
      }>;
    };
  }>(
    target,
    `query ($code: String!) {
      vouchers(first: 100, filter: { search: $code }) {
        edges { node { id codes(first: 50) { edges { node { code } } } } }
      }
    }`,
    { code: params.code },
  );
  let voucherId = search.vouchers.edges.find((e) =>
    e.node.codes.edges.some((c) => c.node.code === params.code),
  )?.node.id;
  if (!voucherId) {
    const created = await adminRequest<{
      voucherCreate: {
        voucher: { id: string } | null;
        errors: Array<{ field: string | null; message: string }>;
      };
    }>(
      target,
      `mutation ($input: VoucherInput!) {
        voucherCreate(input: $input) { voucher { id } errors { field message } }
      }`,
      {
        input: {
          name: params.name,
          code: params.code,
          type: "ENTIRE_ORDER",
          discountValueType: "FIXED",
          applyOncePerOrder: false,
          startDate: new Date().toISOString(),
        },
      },
    );
    checkErrors(created.voucherCreate.errors, "voucherCreate");
    voucherId = created.voucherCreate.voucher?.id;
    if (!voucherId) throw new Error("voucherCreate returned null");
  } else {
    await adminRequest(
      target,
      `mutation ($id: ID!, $input: VoucherInput!) {
        voucherUpdate(id: $id, input: $input) { errors { message } }
      }`,
      { id: voucherId, input: { applyOncePerOrder: false } },
    );
  }
  const listing = await adminRequest<{
    voucherChannelListingUpdate: {
      errors: Array<{ field: string | null; message: string }>;
    };
  }>(
    target,
    `mutation ($id: ID!, $input: VoucherChannelListingInput!) {
      voucherChannelListingUpdate(id: $id, input: $input) { errors { field message } }
    }`,
    {
      id: voucherId,
      input: { addChannels: [{ channelId: params.channelId, discountValue: params.discountEur }] },
    },
  );
  const dup = listing.voucherChannelListingUpdate.errors.every((e) =>
    /already/i.test(e.message),
  );
  if (!dup) checkErrors(listing.voucherChannelListingUpdate.errors, "voucherChannelListing");
  return voucherId;
}

// Somma listino dei componenti bundle su default-channel (prezzo corrente,
// come il seed CLI: il saving del voucher parte dai prezzi vendita).
export async function resolveBundleSaving(
  target: SaleorTarget,
  bundle: BundleConfig,
  cache: Map<string, ProductRef>,
): Promise<number> {
  let sum = 0;
  for (const comp of bundle.components) {
    const product = await fetchProduct(target, comp.productSlug, "default-channel", cache);
    if (!product) throw new Error(`Prodotto "${comp.productSlug}" non trovato`);
    const sel = comp.selection;
    const variant =
      sel.kind === "by-attribute"
        ? product.variants.find((v) => {
            if (!sel.valueFilter) return true;
            return Object.entries(sel.valueFilter).every(([attr, val]) =>
              v.attributes.some(
                (a) => a.attribute.slug === attr && a.values.some((x) => x.slug === val),
              ),
            );
          })
        : product.variants.find((v) => v.sku === sel.variantSku);
    if (!variant) {
      throw new Error(`Bundle ${bundle.slug}: nessuna variante per ${comp.productSlug}`);
    }
    sum += variant.priceAmount;
  }
  const saving = Math.round((sum - bundle.finalPriceEur) * 100) / 100;
  if (saving <= 0) {
    throw new Error(
      `Bundle ${bundle.slug}: saving non positivo (${sum} - ${bundle.finalPriceEur})`,
    );
  }
  return saving;
}

// Stessa convenzione del seed CLI e dello storefront: il voucher code e'
// derivabile da (tenant, bundle) — KIT-<TENANT12>-<BUNDLE>-AUTO.
export function voucherCodeFor(tenantSlug: string, bundleSlug: string): string {
  const t = tenantSlug.replace(/[^a-z0-9]/gi, "").toUpperCase().slice(0, 12);
  const b = bundleSlug.replace(/[^a-z0-9]/gi, "").toUpperCase();
  return `KIT-${t}-${b}-AUTO`;
}

export type { EnablePortalConfig };
