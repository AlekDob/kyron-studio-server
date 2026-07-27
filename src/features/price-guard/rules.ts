// Price Guard — registro delle regole. Ogni regola e' una funzione pura che
// legge il contesto portale (gia' caricato) e ritorna Anomaly[]. SOLO LETTURA.
// I 6 tipi di anomalia richiesti sono coperti da 4 regole:
//   kit-reconciliation -> kit-double-discount | kit-overcharge | voucher-missing | component-missing
//   discount-vanished  -> discount-vanished
//   channel-orphan     -> channel-orphan
//   stale-variant      -> stale-variant-buyable
import { EUR_TOL, type Anomaly, type PortalContext } from "./check.js";
import { voucherCodeFor } from "@/features/portals/enable/seed-steps.js";
import {
  fetchProduct,
  resolveVariant,
  readVoucherDiscount,
  readChannelSettings,
  findOrdersWithVoucher,
} from "./reads.js";

export interface Rule {
  id: string;
  run: (ctx: PortalContext) => Promise<Anomaly[]>;
}

const round2 = (n: number): number => Math.round(n * 100) / 100;

function base(ctx: PortalContext): Pick<Anomaly, "portal" | "portalName"> {
  return { portal: ctx.portal.slug, portalName: ctx.portal.nome };
}

// Somma i prezzi SCONTATI dei componenti sul channel scuola (quanto Saleor
// addebita prima del voucher) + verso quale voucher e' agganciato il kit.
async function reconcileBundle(
  ctx: PortalContext,
  bundle: PortalContext["config"]["bundles"][number],
): Promise<{ sum: number; voucher: number | null; missing: string[] }> {
  let sum = 0;
  const missing: string[] = [];
  for (const comp of bundle.components) {
    const product = await fetchProduct(ctx.target, comp.productSlug, ctx.channel, ctx.cache);
    const variant = product ? resolveVariant(product, comp) : null;
    if (!variant) {
      missing.push(comp.productSlug);
      continue;
    }
    sum += variant.priceAmount; // prezzo scontato sul channel scuola
  }
  const code = voucherCodeFor(ctx.config.slug, bundle.slug);
  const voucher = await readVoucherDiscount(ctx.target, ctx.channel, code);
  return { sum: round2(sum), voucher, missing };
}

// REGOLA 1 — riconciliazione kit: (somma scontati - voucher) deve == prezzo mostrato.
const kitReconciliation: Rule = {
  id: "kit-reconciliation",
  run: async (ctx) => {
    const out: Anomaly[] = [];
    for (const bundle of ctx.config.bundles) {
      const { sum, voucher, missing } = await reconcileBundle(ctx, bundle);
      if (missing.length) {
        out.push({
          ...base(ctx),
          type: "component-missing",
          severity: "medium",
          kit: bundle.slug,
          detail: `Componenti non risolti su Saleor (SKU errato o prodotto assente): ${missing.join(", ")}. Verifica il campo variantSku del kit: spesso contiene lo slug del prodotto invece dello SKU.`,
        });
        // Senza tutti i componenti la somma e' incompleta: riconciliare darebbe
        // uno scarto inventato (es. "scontati 0€ − voucher"). Il problema da
        // risolvere e' lo SKU; la riconciliazione tornera' valida dopo il fix.
        continue;
      }
      if (voucher === null) {
        out.push({
          ...base(ctx),
          type: "voucher-missing",
          severity: "high",
          kit: bundle.slug,
          detail: `Voucher ${voucherCodeFor(ctx.config.slug, bundle.slug)} assente su questo channel`,
        });
        continue;
      }
      const expected = round2(sum - voucher);
      const delta = round2(expected - bundle.finalPriceEur);
      if (Math.abs(delta) <= EUR_TOL) continue;
      // Ordini colpiti da questa configurazione nel periodo del digest (ieri).
      // Best-effort: se la lettura fallisce l'anomalia esce comunque, senza lista.
      let orders: Anomaly["orders"] = [];
      try {
        orders = await findOrdersWithVoucher(
          ctx.target,
          ctx.channel,
          voucherCodeFor(ctx.config.slug, bundle.slug),
          ctx.ordersFrom,
        );
      } catch {
        orders = [];
      }
      out.push({
        ...base(ctx),
        type: delta < 0 ? "kit-double-discount" : "kit-overcharge",
        severity: "high",
        kit: bundle.slug,
        expected,
        shown: bundle.finalPriceEur,
        delta,
        orders,
        detail:
          delta < 0
            ? `scontati ${sum}€ − voucher ${voucher}€ = ${expected}€, ma il portale mostra ${bundle.finalPriceEur}€`
            : `scontati ${sum}€ − voucher ${voucher}€ = ${expected}€, ma il portale mostra ${bundle.finalPriceEur}€`,
      });
    }
    return out;
  },
};

// Prezzo atteso di una variante dato un productDiscount (eur = prezzo finale).
function expectedDiscounted(kind: "eur" | "percent", value: number, undisc: number): number {
  return kind === "eur" ? value : round2(undisc * (1 - value / 100));
}

// REGOLA 2 — sconto sparito: un productDiscount su Payload non riflesso su Saleor.
const discountVanished: Rule = {
  id: "discount-vanished",
  run: async (ctx) => {
    const out: Anomaly[] = [];
    for (const d of ctx.portal.catalog.productDiscounts) {
      const product = await fetchProduct(ctx.target, d.slug, ctx.channel, ctx.cache);
      if (!product) continue;
      const variants = d.capacity
        ? product.variants.filter((v) =>
            v.attributes.some((a) => a.values.some((x) => x.slug === d.capacity)),
          )
        : product.variants;
      for (const v of variants) {
        const want = expectedDiscounted(d.kind, d.value, v.undiscountedAmount);
        if (v.priceAmount > want + EUR_TOL) {
          out.push({
            ...base(ctx),
            type: "discount-vanished",
            severity: "high",
            kit: `${d.slug}${d.capacity ? ` (${d.capacity})` : ""}`,
            expected: want,
            shown: v.priceAmount,
            delta: round2(v.priceAmount - want),
            detail:
              v.priceAmount >= v.undiscountedAmount
                ? `Sconto non applicato su Saleor: prezzo pieno ${v.priceAmount}€, atteso ${want}€`
                : `Sconto applicato solo in parte su Saleor: prezzo ${v.priceAmount}€ (listino ${v.undiscountedAmount}€), atteso ${want}€`,
          });
          break; // un'anomalia per discount basta
        }
      }
    }
    return out;
  },
};

// REGOLA 3 — channel orfano: inattivo o senza allowUnpaidOrders -> ordini persi.
const channelOrphan: Rule = {
  id: "channel-orphan",
  run: async (ctx) => {
    const s = await readChannelSettings(ctx.target, ctx.channel);
    if (!s) {
      return [{ ...base(ctx), type: "channel-orphan", severity: "high", detail: "Channel Saleor non trovato" }];
    }
    const out: Anomaly[] = [];
    if (!s.isActive) {
      out.push({ ...base(ctx), type: "channel-orphan", severity: "high", detail: "Channel Saleor non attivo" });
    }
    if (s.allowUnpaid === false) {
      out.push({
        ...base(ctx),
        type: "channel-orphan",
        severity: "high",
        detail: "allowUnpaidOrders=false: ordini Bonifico/Carta Docente non creati (orfani)",
      });
    }
    return out;
  },
};

// REGOLA 4 — taglio stale: variante listata sul channel ma fuori da visibleVariants
// (e non usata da un kit) -> comprabile per errore.
const staleVariant: Rule = {
  id: "stale-variant",
  run: async (ctx) => {
    const out: Anomaly[] = [];
    const visible = ctx.portal.catalog.visibleVariants;
    const productSlugs = [...new Set(visible.map((v) => v.productSlug))];
    for (const slug of productSlugs) {
      const product = await fetchProduct(ctx.target, slug, ctx.channel, ctx.cache);
      if (!product) continue;
      const allowed = new Set(visible.filter((v) => v.productSlug === slug).map((v) => v.value));
      if (!allowed.size) continue;
      for (const v of product.variants) {
        if (v.priceAmount <= 0) continue; // non listato sul channel
        const caps = v.attributes.flatMap((a) => a.values.map((x) => x.slug));
        // Stale solo se il taglio della variante NON e' tra quelli visibili.
        if (caps.length && caps.every((c) => !allowed.has(c))) {
          out.push({
            ...base(ctx),
            type: "stale-variant-buyable",
            severity: "medium",
            kit: slug,
            detail: `Variante acquistabile su Saleor ma fuori dai tagli visibili (${v.sku})`,
          });
        }
      }
    }
    return out;
  },
};

export const RULES: Rule[] = [kitReconciliation, discountVanished, channelOrphan, staleVariant];
