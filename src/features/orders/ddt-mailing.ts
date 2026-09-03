// Comunicazioni ai clienti a partire da un file di DDT Danea.
//
// Qui c'e' solo la FONTE dei destinatari: il file DDT caricato, agganciato agli
// ordini Saleor. Piano, lotti, allowlist, kill switch, claim anti-doppio-invio e
// invio vivono in `core/email/campaign.ts`, condivisi con le comunicazioni ai
// clienti di Bea.
import { fetchOrdersForRange, setOrderMeta } from "@/core/saleor/orders.js";
import {
  planCampaign,
  sendCampaign,
  sendCampaignTestMail,
  assertMailEnabled,
  assertOneEmail,
  BATCH_SIZE,
  type CampaignPlan,
  type CampaignSendResult,
  type Recipient,
} from "@/core/email/campaign.js";
import { getDdtImport, type StoredDdtImport } from "@/features/commesso/danea-uploads.js";
import { matchDocuments, rangeForDocuments } from "./ddt-match.js";
import { ddtDetailsHtml, type DdtCampaign } from "./ddt-mail-template.js";

export { BATCH_SIZE };
export type DdtMailPlan = CampaignPlan;
export type DdtSendResult = CampaignSendResult;

/** Indice DDT -> ordine, calcolato una volta e tenuto nello store per il TTL. */
async function orderIndex(entry: StoredDdtImport): Promise<Record<string, { orderId: string; orderNumber: string }>> {
  if (entry.orderIndex) return entry.orderIndex;
  const { from, to } = rangeForDocuments(entry.documents);
  const orders = from ? await fetchOrdersForRange(from, to) : [];
  const index: Record<string, { orderId: string; orderNumber: string }> = {};
  for (const m of matchDocuments(entry.documents, orders)) {
    if (m.matched) index[m.docKey] = { orderId: m.orderId, orderNumber: m.orderNumber };
  }
  entry.orderIndex = index;
  return index;
}

async function ddtPlan(args: { importId: string; campaignId: string; campaign: DdtCampaign }): Promise<CampaignPlan> {
  const entry = getDdtImport(args.importId);
  const index = await orderIndex(entry);
  const recipients: Recipient[] = entry.documents.map((d) => ({
    key: d.docKey,
    email: d.customerEmail,
    name: d.customerName,
    group: d.portalSlug,
    orderNumber: index[d.docKey]?.orderNumber ?? "",
    matched: Boolean(index[d.docKey]),
    detailsHtml: ddtDetailsHtml(d),
  }));
  return planCampaign({ source: entry.filename, campaignId: args.campaignId, campaign: args.campaign, recipients });
}

export const planDdtMailing = ddtPlan;

export async function sendDdtTestMail(args: {
  importId: string;
  campaignId: string;
  campaign: DdtCampaign;
  previewIndex: number;
  to: string;
}): Promise<{ to: string; docKey: string }> {
  assertOneEmail(args.to);
  const plan = await ddtPlan(args);
  const res = await sendCampaignTestMail({ plan, previewIndex: args.previewIndex, to: args.to });
  return { to: res.to, docKey: res.key };
}

export async function sendDdtMailing(args: {
  importId: string;
  campaignId: string;
  campaign: DdtCampaign;
}): Promise<DdtSendResult> {
  assertMailEnabled();
  const entry = getDdtImport(args.importId);
  const plan = await ddtPlan(args);
  return sendCampaign({
    plan,
    // Display sulla scheda ordine: e' un promemoria, non una guardia.
    onSent: async (r) => {
      const orderId = entry.orderIndex?.[r.key]?.orderId;
      if (orderId) await setOrderMeta(orderId, "kyron_comms", args.campaignId);
    },
  });
}
