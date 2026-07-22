// Brain: decision-019 — cambio colore come ANNOTAZIONE su ordini gia' confermati.
// Le mutation order-line di Saleor operano solo su DRAFT/UNCONFIRMED: su un ordine
// pagato non si puo' riscrivere la riga. Qui il colore scelto viene salvato come
// metadata PUBBLICO `kyron_line_colors` (acquisto originale -> nuovo colore), letto
// da Studio, area ordini cliente (storefront) ed export Danea. Non tocca il money-path.
import {
  fetchOrderMeta,
  setOrderMeta,
  parseLineColors,
  type LineColorChange,
} from "@/core/saleor/orders.js";

const META_KEY = "kyron_line_colors";

// Upsert del cambio colore per SKU. Se `to` e' vuoto o uguale all'originale, rimuove
// l'annotazione (torna al colore acquistato). Ritorna la lista aggiornata.
export async function setLineColor(
  orderId: string,
  change: LineColorChange,
): Promise<LineColorChange[]> {
  const current = parseLineColors(await fetchOrderMeta(orderId, META_KEY));
  const next = current.filter((c) => c.sku !== change.sku);
  if (change.to && change.to !== change.from) next.push(change);
  await setOrderMeta(orderId, META_KEY, next.length ? JSON.stringify(next) : "");
  return next;
}
