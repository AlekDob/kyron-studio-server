// Comunicazioni ai clienti a partire da un file di DDT Danea.
//
// Due passaggi, come per i prezzi: prima il piano (sola lettura), poi l'invio
// con conferma esplicita. Il piano NON viaggia tra i turni: l'invio ricalcola
// tutto da importId + campagna, cosi' due conferme di fila non raddoppiano
// niente.
//
// Il lotto e' il cursore: 50 documenti per chiamata, sempre i primi non ancora
// inviati in ordine di docKey. Niente job in background, niente stato di
// avanzamento da tenere.
import { fetchOrdersForRange, setOrderMeta } from "@/core/saleor/orders.js";
import { allowlistFromEnv, passesAllowlist, sendBulk, type BulkMessage } from "@/core/email/bulk.js";
import { excludedEmails } from "@/features/commesso/sales.js";
import { getDdtImport, type StoredDdtImport } from "@/features/commesso/danea-uploads.js";
import type { DaneaDocument } from "@/features/commesso/danea-ddt.js";
import { matchDocuments, rangeForDocuments } from "./ddt-match.js";
import { claimSend, listSent, markFailed } from "./email-log.js";
import { campaignPlainText, renderDdtEmail, type DdtCampaign } from "./ddt-mail-template.js";

export const BATCH_SIZE = 50;
const ALLOW_ENV = "DDT_MAIL_ALLOW";

export interface DdtRecipient {
  docKey: string;
  email: string;
  customerName: string;
  portalSlug: string;
  orderNumber: string;
  matched: boolean;
}

export interface DdtMailPlan {
  filename: string;
  campaignId: string;
  campaign: DdtCampaign;
  total: number;
  eligible: number;
  alreadySent: number;
  matched: number;
  excluded: number;
  blockedByAllowlist: number;
  allowlistActive: boolean;
  recipients: DdtRecipient[];
  previews: { email: string; subject: string; html: string }[];
}

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

/** Chi riceve davvero: ha una mail, non e' un nostro indirizzo di test, passa l'allowlist. */
function selectRecipients(
  docs: DaneaDocument[],
  index: Record<string, { orderId: string; orderNumber: string }>,
  allow: string[],
): { recipients: DdtRecipient[]; excluded: number; blocked: number } {
  const skip = excludedEmails().map((e) => e.toLowerCase());
  let excluded = 0;
  let blocked = 0;
  const recipients: DdtRecipient[] = [];
  for (const d of [...docs].sort((a, b) => a.docKey.localeCompare(b.docKey))) {
    if (!d.customerEmail || skip.includes(d.customerEmail)) {
      excluded++;
      continue;
    }
    if (!passesAllowlist(d.customerEmail, allow)) {
      blocked++;
      continue;
    }
    const hit = index[d.docKey];
    recipients.push({
      docKey: d.docKey,
      email: d.customerEmail,
      customerName: d.customerName,
      portalSlug: d.portalSlug,
      orderNumber: hit?.orderNumber ?? "",
      matched: Boolean(hit),
    });
  }
  return { recipients, excluded, blocked };
}

export async function planDdtMailing(args: {
  importId: string;
  campaignId: string;
  campaign: DdtCampaign;
}): Promise<DdtMailPlan> {
  const entry = getDdtImport(args.importId);
  const index = await orderIndex(entry);
  const allow = allowlistFromEnv(ALLOW_ENV);
  const { recipients, excluded, blocked } = selectRecipients(entry.documents, index, allow);
  const sent = await listSent(args.campaignId);
  const pending = recipients.filter((r) => !sent.has(r.docKey));
  const byKey = new Map(entry.documents.map((d) => [d.docKey, d]));
  return {
    filename: entry.filename,
    campaignId: args.campaignId,
    campaign: args.campaign,
    total: entry.documents.length,
    eligible: pending.length,
    alreadySent: recipients.length - pending.length,
    matched: recipients.filter((r) => r.matched).length,
    excluded,
    blockedByAllowlist: blocked,
    allowlistActive: allow.length > 0,
    recipients: pending,
    previews: pending.slice(0, 3).map((r) => ({
      email: r.email,
      subject: args.campaign.subject,
      html: renderDdtEmail(byKey.get(r.docKey) as DaneaDocument, args.campaign),
    })),
  };
}

export interface DdtSendResult {
  sent: number;
  skipped: number;
  failed: { email: string; error: string }[];
  remaining: number;
}

export async function sendDdtMailing(args: {
  importId: string;
  campaignId: string;
  campaign: DdtCampaign;
}): Promise<DdtSendResult> {
  if (process.env.DDT_MAIL_ENABLED !== "true") {
    throw new Error("Invio comunicazioni disattivato: manca DDT_MAIL_ENABLED=true.");
  }
  const entry = getDdtImport(args.importId);
  const plan = await planDdtMailing(args);
  const batch = plan.recipients.slice(0, BATCH_SIZE);
  const byKey = new Map(entry.documents.map((d) => [d.docKey, d]));
  const text = campaignPlainText(args.campaign);

  // Claim PRIMA di inviare: se Payload non risponde ci fermiamo, non mandiamo.
  const claims = new Map<string, string>();
  const messages: BulkMessage[] = [];
  let skipped = 0;
  for (const r of batch) {
    const doc = byKey.get(r.docKey) as DaneaDocument;
    const id = await claimSend({
      campaign: args.campaignId,
      docKey: r.docKey,
      email: r.email,
      orderNumber: r.orderNumber,
      subject: args.campaign.subject,
      body: text,
    });
    if (!id) {
      skipped++;
      continue;
    }
    claims.set(r.docKey, id);
    messages.push({
      key: r.docKey,
      to: r.email,
      subject: args.campaign.subject,
      html: renderDdtEmail(doc, args.campaign),
    });
  }

  const byDocKey = new Map(batch.map((r) => [r.docKey, r]));
  const failed: { email: string; error: string }[] = [];
  const results = await sendBulk(messages, async (res) => {
    const claimId = claims.get(res.key);
    if (!res.ok && claimId) await markFailed(claimId);
    if (!res.ok) failed.push({ email: res.to, error: res.error });
    // Display sulla scheda ordine: e' un promemoria, non una guardia.
    const rec = byDocKey.get(res.key);
    if (res.ok && rec?.orderNumber) {
      const orderId = entry.orderIndex?.[res.key]?.orderId;
      if (orderId) await setOrderMeta(orderId, "kyron_comms", args.campaignId);
    }
  });

  const sent = results.filter((r) => r.ok).length;
  return { sent, skipped, failed, remaining: Math.max(0, plan.eligible - batch.length) };
}
