// UNICO punto di scrittura dei prezzi in tutto il modulo Commesso.
//
// Perche' uno solo: sui canali con promo in percentuale scrivere il prezzo base
// fa ricalcolare la base all'incontrario (804,82 invece di 799 — R2). Quindi
// nessuna funzione qui accetta "il prezzo del prodotto": il canale e' sempre un
// parametro obbligatorio e si scrive SEMPRE il listing di quel canale.
import {
  adminRequest,
  checkErrors,
  type SaleorTarget,
} from "@/features/portals/enable/saleor-admin.js";
import { setVariantPrice } from "@/features/portals/enable/seed-steps.js";
import { detectDrift, type PricePlan } from "./price-plan.js";
import { readVariantPrice } from "./reads.js";

export interface ApplyResult {
  written: Array<{ sku: string; toEur: number }>;
  vouchers: Array<{ code: string; toEur: number }>;
  drift: string[];
}

// Audit su stdout: i log del container sono l'unico posto durevole che abbiamo
// (il filesystem si azzera a ogni redeploy). Riga sola, strutturata, grepabile.
function audit(entry: Record<string, unknown>): void {
  console.info(`[commesso] ${JSON.stringify(entry)}`);
}

// Le mutation di listing (prezzo variante e sconto voucher) vogliono l'ID del
// canale, non lo slug. Lo slug e' quello che scrive l'utente, quindi la
// traduzione sta qui e non gira dentro il piano.
export async function resolveChannelId(
  target: SaleorTarget,
  channelSlug: string,
): Promise<string> {
  const data = await adminRequest<{ channels: Array<{ id: string; slug: string }> }>(
    target,
    `query { channels { id slug } }`,
  );
  const channel = data.channels.find((c) => c.slug === channelSlug);
  if (!channel) throw new Error(`Canale ${channelSlug} non trovato su ${target}`);
  return channel.id;
}

async function resolveVoucherId(
  target: SaleorTarget,
  voucherCode: string,
): Promise<string> {
  const data = await adminRequest<{
    vouchers: { edges: Array<{ node: { id: string; code: string } }> };
  }>(
    target,
    `query ($code: String!) {
      vouchers(first: 5, filter: { search: $code }) { edges { node { id code } } }
    }`,
    { code: voucherCode },
  );
  const voucher = data.vouchers.edges.find((e) => e.node.code === voucherCode)?.node;
  if (!voucher) throw new Error(`Voucher ${voucherCode} non trovato su ${target}`);
  return voucher.id;
}

async function writeVoucherDiscount(
  target: SaleorTarget,
  voucherCode: string,
  channelSlug: string,
  discountEur: number,
): Promise<void> {
  const [voucherId, channelId] = await Promise.all([
    resolveVoucherId(target, voucherCode),
    resolveChannelId(target, channelSlug),
  ]);
  const data = await adminRequest<{
    voucherChannelListingUpdate: {
      errors: Array<{ field?: string | null; message: string }>;
    };
  }>(
    target,
    `mutation ($id: ID!, $input: VoucherChannelListingInput!) {
      voucherChannelListingUpdate(id: $id, input: $input) { errors { field message } }
    }`,
    {
      id: voucherId,
      input: { addChannels: [{ channelId, discountValue: discountEur }] },
    },
  );
  checkErrors(data.voucherChannelListingUpdate.errors, "voucherChannelListingUpdate");
}

/**
 * Applica un piano prezzi. Rilegge i prezzi prima di scrivere: se qualcosa si e'
 * mosso da quando il piano e' stato calcolato non scrive NIENTE. E' questo il
 * sostituto del gate di approvazione umana.
 */
export async function applyPricePlan(
  target: SaleorTarget,
  plan: PricePlan,
): Promise<ApplyResult> {
  if (plan.errors.length) {
    throw new Error(`Piano non applicabile: ${plan.errors.join(" ")}`);
  }
  const fresh = await Promise.all(
    plan.lines.map(async (l) => ({
      sku: l.sku,
      priceEur: await readVariantPrice(target, l.variantId, plan.channelSlug),
    })),
  );
  const drift = detectDrift(plan, fresh);
  if (drift.length) {
    audit({ action: "price-plan-aborted", target, channel: plan.channelSlug, drift });
    return { written: [], vouchers: [], drift };
  }

  const channelId = await resolveChannelId(target, plan.channelSlug);
  const written: ApplyResult["written"] = [];
  for (const line of plan.lines) {
    await setVariantPrice(target, line.variantId, channelId, line.toEur);
    audit({
      action: "price-write",
      target,
      channel: plan.channelSlug,
      sku: line.sku,
      from: line.fromEur,
      to: line.toEur,
    });
    written.push({ sku: line.sku, toEur: line.toEur });
  }

  const vouchers: ApplyResult["vouchers"] = [];
  for (const v of plan.voucherLines) {
    await writeVoucherDiscount(target, v.voucherCode, v.portalSlug, v.newDiscountEur);
    audit({
      action: "voucher-write",
      target,
      portal: v.portalSlug,
      code: v.voucherCode,
      from: v.fromEur,
      to: v.newDiscountEur,
    });
    vouchers.push({ code: v.voucherCode, toEur: v.newDiscountEur });
  }
  return { written, vouchers, drift: [] };
}
