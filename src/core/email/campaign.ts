// Motore delle comunicazioni di massa ai clienti, condiviso tra Nico (mail dai
// DDT Danea) e Bea (mail a una lista di clienti).
//
// Due passaggi, come per i prezzi: prima il piano (sola lettura), poi l'invio
// con conferma esplicita. Il piano NON viaggia tra i turni: chi invia ricalcola
// i destinatari, cosi' due conferme di fila non raddoppiano niente.
//
// Il lotto e' il cursore: 50 destinatari per chiamata, sempre i primi non
// ancora inviati in ordine di chiave. Niente job in background.
//
// Qui NON si sa da dove arrivano i destinatari: li risolve il chiamante e li
// passa gia' pronti, con il loro riquadro dettagli.
import { allowlistFromEnv, passesAllowlist, sendBulk, type BulkMessage } from "./bulk.js";
import { campaignPlainText, renderCampaignEmail, type Campaign } from "./campaign-template.js";
import { claimSend, listSent, markFailed } from "@/features/orders/email-log.js";
import { excludedEmails } from "@/features/commesso/sales.js";
import { sendKyronEmail } from "./mailer.js";

export const BATCH_SIZE = 50;
/** Un solo interruttore per tutte le mail di massa ai clienti veri. */
const ALLOW_ENV = "DDT_MAIL_ALLOW";
const ENABLED_ENV = "DDT_MAIL_ENABLED";

export interface Recipient {
  /** Chiave stabile del destinatario dentro la campagna: e' il lock anti-doppio-invio. */
  key: string;
  email: string;
  name: string;
  /** Ordine di riferimento, se ce n'e' uno. Finisce nel registro email-log. */
  orderNumber?: string;
  /** Etichetta di raggruppamento mostrata nella card (portale, segmento...). */
  group?: string;
  /** Il destinatario e' agganciato a un ordine reale. */
  matched?: boolean;
  /** Riquadro grigio con i suoi dati, gia' HTML (vedi `detailsBox`). */
  detailsHtml?: string;
}

export interface CampaignPlan {
  /** Da dove arrivano i destinatari: nome del file DDT, o descrizione del filtro clienti. */
  source: string;
  campaignId: string;
  campaign: Campaign;
  total: number;
  eligible: number;
  alreadySent: number;
  matched: number;
  excluded: number;
  blockedByAllowlist: number;
  allowlistActive: boolean;
  recipients: Recipient[];
  previews: { email: string; subject: string; html: string }[];
}

const renderFor = (r: Recipient, campaign: Campaign): string =>
  renderCampaignEmail(campaign, r.detailsHtml ?? "");

/** Chi riceve davvero: ha una mail, non e' un nostro indirizzo di test, passa l'allowlist. */
function selectRecipients(all: Recipient[], allow: string[]) {
  const skip = excludedEmails().map((e) => e.toLowerCase());
  let excluded = 0;
  let blocked = 0;
  const recipients: Recipient[] = [];
  for (const r of [...all].sort((a, b) => a.key.localeCompare(b.key))) {
    const email = r.email?.trim().toLowerCase() ?? "";
    if (!email || skip.includes(email)) excluded++;
    else if (!passesAllowlist(email, allow)) blocked++;
    else recipients.push({ ...r, email });
  }
  return { recipients, excluded, blocked };
}

export async function planCampaign(args: {
  source: string;
  campaignId: string;
  campaign: Campaign;
  recipients: Recipient[];
}): Promise<CampaignPlan> {
  const allow = allowlistFromEnv(ALLOW_ENV);
  const { recipients, excluded, blocked } = selectRecipients(args.recipients, allow);
  const sent = await listSent(args.campaignId);
  const pending = recipients.filter((r) => !sent.has(r.key));
  return {
    source: args.source,
    campaignId: args.campaignId,
    campaign: args.campaign,
    total: args.recipients.length,
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
      html: renderFor(r, args.campaign),
    })),
  };
}

export interface CampaignSendResult {
  sent: number;
  skipped: number;
  failed: { email: string; error: string }[];
  remaining: number;
}

export function assertMailEnabled(): void {
  if (process.env[ENABLED_ENV] !== "true") {
    throw new Error(`Invio comunicazioni disattivato: manca ${ENABLED_ENV}=true.`);
  }
}

/**
 * Manda il primo lotto del piano. `onSent` e' il gancio per chi vuole segnare
 * qualcosa dopo un invio riuscito (es. il promemoria sull'ordine Saleor): cosi'
 * `core/email` non deve conoscere Saleor.
 */
export async function sendCampaign(args: {
  plan: CampaignPlan;
  onSent?: (r: Recipient) => Promise<void>;
}): Promise<CampaignSendResult> {
  assertMailEnabled();
  const { plan } = args;
  const batch = plan.recipients.slice(0, BATCH_SIZE);
  const text = campaignPlainText(plan.campaign);

  // Claim PRIMA di inviare: se Payload non risponde ci fermiamo, non mandiamo.
  const claims = new Map<string, string>();
  const messages: BulkMessage[] = [];
  let skipped = 0;
  for (const r of batch) {
    const id = await claimSend({
      campaign: plan.campaignId,
      docKey: r.key,
      email: r.email,
      orderNumber: r.orderNumber ?? "",
      subject: plan.campaign.subject,
      body: text,
    });
    if (!id) {
      skipped++;
      continue;
    }
    claims.set(r.key, id);
    messages.push({ key: r.key, to: r.email, subject: plan.campaign.subject, html: renderFor(r, plan.campaign) });
  }

  const byKey = new Map(batch.map((r) => [r.key, r]));
  const failed: { email: string; error: string }[] = [];
  const results = await sendBulk(messages, async (res) => {
    const claimId = claims.get(res.key);
    if (!res.ok && claimId) await markFailed(claimId);
    if (!res.ok) failed.push({ email: res.to, error: res.error });
    const rec = byKey.get(res.key);
    if (res.ok && rec && args.onSent) await args.onSent(rec);
  });

  const sent = results.filter((r) => r.ok).length;
  return { sent, skipped, failed, remaining: Math.max(0, plan.eligible - batch.length) };
}

// Invio di PROVA: una mail sola, all'indirizzo che l'operatore scrive nella card.
// Serve proprio quando l'invio di massa e' ancora spento, quindi NON passa da
// DDT_MAIL_ENABLED ne' dall'allowlist. Non tocca email_log e non scrive niente
// sull'ordine: la prova non deve consumare il claim anti-doppio-invio.
const ONE_EMAIL = /^[^\s@,]+@[^\s@,]+\.[^\s@,]+$/;

/** Da chiamare PRIMA di risolvere i destinatari: se l'indirizzo non regge, non serve il piano. */
export function assertOneEmail(to: string): string {
  const clean = to.trim();
  if (!ONE_EMAIL.test(clean)) {
    throw new Error("Indirizzo di prova non valido: serve un solo indirizzo email.");
  }
  return clean;
}

export async function sendCampaignTestMail(args: {
  plan: CampaignPlan;
  previewIndex: number;
  to: string;
}): Promise<{ to: string; key: string }> {
  const to = assertOneEmail(args.to);
  const { plan } = args;
  const i = Math.min(Math.max(args.previewIndex, 0), plan.previews.length - 1);
  const preview = plan.previews[i];
  if (!preview) throw new Error("Nessun destinatario da usare per l'anteprima.");
  await sendKyronEmail(`[PROVA] ${plan.campaign.subject}`, preview.html, [to]);
  return { to, key: plan.recipients[i]?.key ?? "" };
}
