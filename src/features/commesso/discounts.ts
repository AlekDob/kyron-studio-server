// Sconti per portale di un prodotto. Sul channel listing il prezzo e' sempre il
// listino (509 EUR su tutti i 42 portali): lo sconto vero vive nelle promotion
// CATALOGUE, e sommarle a mano vorrebbe dire indovinare come Saleor le combina.
// Quindi lo chiediamo a Saleor: una query, un alias per portale, e `pricing`
// torna prezzo finale + listino + sconto per variante.
import { adminRequest, type SaleorTarget } from "@/features/portals/enable/saleor-admin.js";
import { getProduct } from "./reads.js";

export interface PortalDiscount {
  channelSlug: string;
  /** Prezzo minimo davvero pagato su questo portale. */
  fromEur: number | null;
  /** Listino minimo, cioe' quanto costerebbe senza promozioni. */
  fromListEur: number | null;
  /** Sconto piu' alto trovato tra le varianti, in euro. */
  maxDiscountEur: number;
  /** Varianti in sconto su quante sono listate qui. */
  onSale: number;
  listed: number;
}

interface RawPricing {
  onSale: boolean | null;
  price: { net: { amount: number } } | null;
  priceUndiscounted: { net: { amount: number } } | null;
  discount: { net: { amount: number } } | null;
}

interface RawVariant {
  sku: string | null;
  pricing: RawPricing | null;
}

// Un alias per portale: 42 giri HTTP separati per una scheda prodotto sarebbero
// mezzo secondo buttato, e il costo della query resta basso (un prodotto solo).
function aliasQuery(slug: string, channels: string[]): string {
  const parts = channels.map(
    (ch, i) => `c${i}: product(slug: ${JSON.stringify(slug)}, channel: ${JSON.stringify(ch)}) {
      variants { sku pricing {
        onSale
        price { net { amount } }
        priceUndiscounted { net { amount } }
        discount { net { amount } }
      } }
    }`,
  );
  return `query { ${parts.join("\n")} }`;
}

function summarize(channelSlug: string, variants: RawVariant[]): PortalDiscount {
  const priced = variants.filter((v) => v.pricing?.price);
  const finals = priced.map((v) => v.pricing!.price!.net.amount);
  const lists = priced.map(
    (v) => v.pricing!.priceUndiscounted?.net.amount ?? v.pricing!.price!.net.amount,
  );
  const discounts = priced.map((v) => v.pricing!.discount?.net.amount ?? 0);
  return {
    channelSlug,
    fromEur: finals.length ? Math.min(...finals) : null,
    fromListEur: lists.length ? Math.min(...lists) : null,
    maxDiscountEur: discounts.length ? Math.max(...discounts) : 0,
    onSale: priced.filter((v) => v.pricing?.onSale).length,
    listed: priced.length,
  };
}

/** Sconto per portale, in ordine di sconto decrescente. */
export async function listProductDiscounts(
  target: SaleorTarget,
  slug: string,
): Promise<PortalDiscount[]> {
  const product = await getProduct(target, slug);
  if (!product) throw new Error(`Prodotto "${slug}" non trovato`);
  const channels = product.channels;
  if (channels.length === 0) return [];

  const rows: PortalDiscount[] = [];
  // A blocchi di 20: una query con 42 alias passa, ma il costo cresce col
  // numero di varianti e non vale rischiare il limite di Saleor.
  for (let i = 0; i < channels.length; i += 20) {
    const chunk = channels.slice(i, i + 20);
    const data = await adminRequest<Record<string, { variants: RawVariant[] } | null>>(
      target,
      aliasQuery(slug, chunk),
    );
    chunk.forEach((ch, j) => {
      const node = data[`c${j}`];
      if (node) rows.push(summarize(ch, node.variants ?? []));
    });
  }
  return rows.sort((a, b) => b.maxDiscountEur - a.maxDiscountEur);
}
