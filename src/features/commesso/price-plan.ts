// Motore del piano prezzi di Nico. Funzioni PURE: nessuna chiamata di rete,
// nessuna scrittura. Il piano si calcola qui, si mostra all'utente, e solo un
// secondo tool lo applica. Cosi' un prezzo non si puo' cambiare in un turno.
//
// Le guardie che stanno qui esistono per incidenti reali, non per prudenza:
// R1 — il voucher di un kit e' un importo FISSO in euro. Se cambia il prezzo di
//      un componente e il voucher resta fermo, il kit si vende al prezzo
//      sbagliato senza che nessuno se ne accorga. E' costato ~734 EUR su 25
//      ordini. Quindi: componente di kit senza nuovo voucher = piano rifiutato.
// R2 — il canale e' sempre esplicito, mai "il prezzo del prodotto": sui canali
//      con promo in percentuale scrivere la base fa cascare il conto
//      all'incontrario (804,82 invece di 799).

/** Oltre questa variazione il piano avvisa: probabile zero di troppo. */
const BIG_CHANGE_PCT = 30;

export interface PlanRequest {
  sku: string;
  newPriceEur: number;
}

export interface CurrentVariant {
  sku: string;
  variantId: string;
  productSlug: string;
  priceEur: number | null;
}

/** Un kit che usa questo prodotto come componente, su un portale. */
export interface BundleUse {
  productSlug: string;
  portalSlug: string;
  bundleSlug: string;
  voucherCode: string;
  currentVoucherEur: number | null;
}

export interface VoucherUpdate {
  voucherCode: string;
  newDiscountEur: number;
}

export interface PlanLine {
  sku: string;
  variantId: string;
  productSlug: string;
  fromEur: number | null;
  toEur: number;
  deltaEur: number;
  deltaPct: number | null;
}

export interface PricePlan {
  channelSlug: string;
  lines: PlanLine[];
  voucherLines: Array<VoucherUpdate & { fromEur: number | null; portalSlug: string }>;
  warnings: string[];
  /** Se non vuoto il piano NON e' applicabile. */
  errors: string[];
}

export interface BuildPlanInput {
  channelSlug: string;
  requests: PlanRequest[];
  current: CurrentVariant[];
  /** Kit che usano i prodotti toccati (vuoto se nessuno). */
  bundleUses: BundleUse[];
  voucherUpdates?: VoucherUpdate[];
}

const round2 = (n: number): number => Math.round(n * 100) / 100;

// Saleor rifiuta piu' di 2 decimali; zero o negativo non e' un prezzo.
function priceError(sku: string, price: number): string | null {
  if (!Number.isFinite(price) || price <= 0) {
    return `${sku}: prezzo non valido (${price}).`;
  }
  if (round2(price) !== price) {
    return `${sku}: prezzo con piu' di 2 decimali (${price}). Saleor lo rifiuta.`;
  }
  return null;
}

function toLine(req: PlanRequest, cur: CurrentVariant): PlanLine {
  const from = cur.priceEur;
  const deltaEur = from === null ? 0 : round2(req.newPriceEur - from);
  return {
    sku: cur.sku,
    variantId: cur.variantId,
    productSlug: cur.productSlug,
    fromEur: from,
    toEur: req.newPriceEur,
    deltaEur,
    deltaPct: from && from > 0 ? round2((deltaEur / from) * 100) : null,
  };
}

// Ogni kit toccato deve avere il suo voucher nel piano, altrimenti R1.
function checkBundleVouchers(
  lines: PlanLine[],
  bundleUses: BundleUse[],
  updates: VoucherUpdate[],
): { errors: string[]; voucherLines: PricePlan["voucherLines"] } {
  const touched = new Set(lines.map((l) => l.productSlug));
  const affected = bundleUses.filter((u) => touched.has(u.productSlug));
  const byCode = new Map(updates.map((u) => [u.voucherCode, u]));
  const errors: string[] = [];
  const voucherLines: PricePlan["voucherLines"] = [];
  const seen = new Set<string>();

  for (const use of affected) {
    if (seen.has(use.voucherCode)) continue;
    seen.add(use.voucherCode);
    const update = byCode.get(use.voucherCode);
    if (!update) {
      errors.push(
        `"${use.productSlug}" e' componente del kit "${use.bundleSlug}" sul portale ${use.portalSlug}. Il voucher ${use.voucherCode} e' un importo fisso: cambiando il prezzo del componente senza ricalcolarlo il kit si vende al prezzo sbagliato. Aggiungi il nuovo importo voucher al piano.`,
      );
      continue;
    }
    const bad = priceError(use.voucherCode, update.newDiscountEur);
    if (bad) {
      errors.push(bad);
      continue;
    }
    voucherLines.push({
      ...update,
      fromEur: use.currentVoucherEur,
      portalSlug: use.portalSlug,
    });
  }
  return { errors, voucherLines };
}

export function buildPricePlan(input: BuildPlanInput): PricePlan {
  const bySku = new Map(input.current.map((c) => [c.sku, c]));
  const lines: PlanLine[] = [];
  const warnings: string[] = [];
  const errors: string[] = [];

  for (const req of input.requests) {
    const cur = bySku.get(req.sku);
    if (!cur) {
      errors.push(`SKU ${req.sku} non trovato sul canale ${input.channelSlug}.`);
      continue;
    }
    const bad = priceError(req.sku, req.newPriceEur);
    if (bad) {
      errors.push(bad);
      continue;
    }
    // Un no-op non e' un errore: si scarta e si dice, senza scrivere niente.
    if (cur.priceEur !== null && round2(cur.priceEur) === round2(req.newPriceEur)) {
      warnings.push(`${req.sku} e' gia' a ${req.newPriceEur} EUR: riga scartata.`);
      continue;
    }
    const line = toLine(req, cur);
    if (line.deltaPct !== null && Math.abs(line.deltaPct) > BIG_CHANGE_PCT) {
      warnings.push(
        `${req.sku}: variazione ${line.deltaPct}% (da ${line.fromEur} a ${line.toEur}). Controlla che non ci sia uno zero di troppo.`,
      );
    }
    lines.push(line);
  }

  const bundle = checkBundleVouchers(lines, input.bundleUses, input.voucherUpdates ?? []);
  return {
    channelSlug: input.channelSlug,
    lines,
    voucherLines: bundle.voucherLines,
    warnings,
    errors: [...errors, ...bundle.errors],
  };
}

/**
 * Il piano regge ancora? Confronta i prezzi del piano con una lettura fresca.
 * Se qualcuno ha cambiato un prezzo nel frattempo il piano e' vecchio e non si
 * applica NIENTE: e' questo, non un click di conferma, a proteggere il prezzo.
 */
export function detectDrift(
  plan: PricePlan,
  fresh: Array<{ sku: string; priceEur: number | null }>,
): string[] {
  const bySku = new Map(fresh.map((f) => [f.sku, f.priceEur]));
  const drift: string[] = [];
  for (const line of plan.lines) {
    const now = bySku.get(line.sku);
    if (now === undefined) {
      drift.push(`${line.sku}: variante non piu' leggibile sul canale.`);
      continue;
    }
    const same =
      (now === null && line.fromEur === null) ||
      (now !== null && line.fromEur !== null && round2(now) === round2(line.fromEur));
    if (!same) {
      drift.push(
        `${line.sku}: il piano partiva da ${line.fromEur} EUR, adesso il prezzo e' ${now} EUR.`,
      );
    }
  }
  return drift;
}
