// Price Guard — letture Saleor condivise, SOLO lettura (nessuna mutation).
// Riusa fetchProduct (query prodotto+prezzi sul channel) e adminRequest (query).
// Il channel di una scuola onboarded coincide con lo slug del portale.
import {
  fetchProduct,
  type ProductRef,
  type VariantRef,
} from "@/features/portals/enable/seed-steps.js";
import type { BundleComponentConfig } from "@/features/portals/enable/config.js";
import { adminRequest as rawAdminRequest, type SaleorTarget } from "@/features/portals/enable/saleor-admin.js";

// Guardia read-only: Price Guard controlla, non modifica. adminRequest e'
// generico (accetta anche mutation), qui lo avvolgiamo per rifiutare a runtime
// qualsiasi operazione che non sia una query — vale anche per chi estendera'
// questo modulo domani.
async function adminRequest<T>(
  target: SaleorTarget,
  query: string,
  variables: Record<string, unknown> = {},
): Promise<T> {
  if (/\bmutation\b/i.test(query)) {
    throw new Error("price-guard: solo query di lettura, mutation non ammesse");
  }
  return rawAdminRequest<T>(target, query, variables);
}

// Risolve la variante Saleor di un componente kit (stessa logica di
// resolveBundleSaving, ma read-only): by-attribute con filtro, o SKU fisso.
export function resolveVariant(
  product: ProductRef,
  comp: BundleComponentConfig,
): VariantRef | null {
  const sel = comp.selection;
  if (sel.kind === "fixed") {
    return product.variants.find((v) => v.sku === sel.variantSku) ?? null;
  }
  return (
    product.variants.find((v) => {
      if (!sel.valueFilter) return true;
      return Object.entries(sel.valueFilter).every(([attr, val]) =>
        v.attributes.some(
          (a) => a.attribute.slug === attr && a.values.some((x) => x.slug === val),
        ),
      );
    }) ?? null
  );
}

// Legge il valore FIXED del voucher ENTIRE_ORDER sul channel dato. null se il
// voucher non esiste o non ha listing su quel channel.
export async function readVoucherDiscount(
  target: SaleorTarget,
  channel: string,
  code: string,
): Promise<number | null> {
  const data = await adminRequest<{
    vouchers: {
      edges: Array<{
        node: {
          codes: { edges: Array<{ node: { code: string } }> } | null;
          channelListings: Array<{
            channel: { slug: string };
            discountValue: number;
          }>;
        };
      }>;
    };
  }>(
    target,
    // I voucher Saleor sono MULTI-CODICE: il campo scalare `code` e' deprecato
    // e non torna il codice cercato -> confrontarlo dava "voucher assente" su
    // voucher esistenti (20 falsi positivi, 2026-08-27). Si matcha su `codes`.
    `query ($code: String!) {
      vouchers(first: 5, filter: { search: $code }) {
        edges { node {
          codes(first: 20) { edges { node { code } } }
          channelListings { channel { slug } discountValue }
        } }
      }
    }`,
    { code },
  );
  const node = data.vouchers.edges.find((e) =>
    (e.node.codes?.edges ?? []).some((c) => c.node.code === code),
  )?.node;
  if (!node) return null;
  const listing = node.channelListings.find((l) => l.channel.slug === channel);
  return listing ? listing.discountValue : null;
}

// Impostazioni channel rilevanti per gli ordini (isActive + allowUnpaidOrders).
// Difensiva: se lo schema Saleor non espone il campo, torna allowUnpaid=undefined.
export async function readChannelSettings(
  target: SaleorTarget,
  slug: string,
): Promise<{ isActive: boolean; allowUnpaid?: boolean } | null> {
  try {
    const data = await adminRequest<{
      channel: { isActive: boolean; orderSettings?: { allowUnpaidOrders?: boolean } } | null;
    }>(
      target,
      `query ($slug: String!) {
        channel(slug: $slug) { isActive orderSettings { allowUnpaidOrders } }
      }`,
      { slug },
    );
    if (!data.channel) return null;
    return {
      isActive: data.channel.isActive,
      allowUnpaid: data.channel.orderSettings?.allowUnpaidOrders,
    };
  } catch {
    // Campo orderSettings/allowUnpaidOrders assente su questa versione: fallback
    // alla sola isActive per non far fallire la regola.
    const data = await adminRequest<{ channel: { isActive: boolean } | null }>(
      target,
      `query ($slug: String!) { channel(slug: $slug) { isActive } }`,
      { slug },
    );
    return data.channel ? { isActive: data.channel.isActive } : null;
  }
}

// Ordine colpito da un'anomalia: numero, data e totale pagato.
export interface AffectedOrder {
  number: string;
  created: string; // ISO
  totalGross: number;
}

// Ordini di un channel che hanno usato un dato voucher, da una data in poi
// (`from` = YYYY-MM-DD). Serve a mostrare nel report QUALI ordini sono stati
// colpiti (numero + data). Sola lettura. Saleor non filtra per codice voucher:
// filtriamo lato client.
export async function findOrdersWithVoucher(
  target: SaleorTarget,
  channel: string,
  voucherCode: string,
  from: string,
): Promise<AffectedOrder[]> {
  const data = await adminRequest<{
    orders: {
      edges: Array<{
        node: {
          number: string;
          created: string;
          voucher: { code: string } | null;
          total: { gross: { amount: number } };
        };
      }>;
    };
  }>(
    target,
    `query ($channel: String!, $from: Date!) {
      orders(first: 100, filter: { channels: [$channel], created: { gte: $from } }) {
        edges { node { number created voucher { code } total { gross { amount } } } }
      }
    }`,
    { channel, from },
  );
  return data.orders.edges
    .filter((e) => e.node.voucher?.code === voucherCode)
    .map((e) => ({
      number: e.node.number,
      created: e.node.created,
      totalGross: e.node.total.gross.amount,
    }));
}

export { fetchProduct };
export type { ProductRef, VariantRef };
