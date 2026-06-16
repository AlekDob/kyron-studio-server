// Brain: decision-019 — allinea il voucher Saleor BONIFICO-2 (ENTIRE_ORDER
// PERCENTAGE, auto-applicato dallo storefront quando il metodo e' bonifico) alla
// % impostata da Studio. Source of truth del CALCOLO = questo voucher; Studio
// lo aggiorna su tutti i channel del target. Riusa l'admin client di portals/enable.
import {
  adminRequest,
  checkErrors,
  type SaleorTarget,
} from "@/features/portals/enable/saleor-admin.js";

export const BONIFICO_VOUCHER_CODE = "BONIFICO-2";

async function findVoucherId(
  target: SaleorTarget,
  code: string,
): Promise<string | null> {
  const data = await adminRequest<{
    vouchers: {
      edges: Array<{
        node: { id: string; codes: { edges: Array<{ node: { code: string } }> } };
      }>;
    };
  }>(
    target,
    `query ($code: String!) {
      vouchers(first: 100, filter: { search: $code }) {
        edges { node { id codes(first: 50) { edges { node { code } } } } }
      }
    }`,
    { code },
  );
  return (
    data.vouchers.edges.find((e) =>
      e.node.codes.edges.some((c) => c.node.code === code),
    )?.node.id ?? null
  );
}

async function createPercentageVoucher(
  target: SaleorTarget,
  code: string,
): Promise<string> {
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
        name: "Sconto bonifico bancario",
        code,
        type: "ENTIRE_ORDER",
        discountValueType: "PERCENTAGE",
        applyOncePerOrder: false,
        startDate: new Date().toISOString(),
      },
    },
  );
  checkErrors(created.voucherCreate.errors, "voucherCreate");
  const id = created.voucherCreate.voucher?.id;
  if (!id) throw new Error("voucherCreate returned null");
  return id;
}

/** Imposta la % del voucher BONIFICO-2 su tutti i channel del target Saleor.
 *  Crea il voucher se assente. Lancia su errore Saleor. */
export async function applyBonificoPercent(
  target: SaleorTarget,
  percent: number,
): Promise<{ voucherId: string; channels: number }> {
  const voucherId =
    (await findVoucherId(target, BONIFICO_VOUCHER_CODE)) ??
    (await createPercentageVoucher(target, BONIFICO_VOUCHER_CODE));

  const data = await adminRequest<{ channels: Array<{ id: string }> }>(
    target,
    `query { channels { id } }`,
  );
  const addChannels = data.channels.map((c) => ({
    channelId: c.id,
    discountValue: percent,
  }));

  const listing = await adminRequest<{
    voucherChannelListingUpdate: {
      errors: Array<{ field: string | null; message: string }>;
    };
  }>(
    target,
    `mutation ($id: ID!, $input: VoucherChannelListingInput!) {
      voucherChannelListingUpdate(id: $id, input: $input) { errors { field message } }
    }`,
    { id: voucherId, input: { addChannels } },
  );
  const dup = listing.voucherChannelListingUpdate.errors.every((e) =>
    /already/i.test(e.message),
  );
  if (!dup) {
    checkErrors(listing.voucherChannelListingUpdate.errors, "voucherChannelListing");
  }
  return { voucherId, channels: addChannels.length };
}

/** Applica la % su staging + prod best-effort. Non lancia se un target fallisce
 *  (es. credenziali prod assenti in dev): ritorna l'esito per target. */
export async function applyBonificoPercentAllTargets(
  percent: number,
): Promise<Record<SaleorTarget, { ok: boolean; error?: string }>> {
  const targets: SaleorTarget[] = ["staging", "prod"];
  const result = {} as Record<SaleorTarget, { ok: boolean; error?: string }>;
  for (const t of targets) {
    try {
      await applyBonificoPercent(t, percent);
      result[t] = { ok: true };
    } catch (err) {
      result[t] = { ok: false, error: (err as Error).message };
    }
  }
  return result;
}
