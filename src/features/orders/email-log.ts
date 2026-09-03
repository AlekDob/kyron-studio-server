// Registro durevole degli invii massivi, su Payload (collection `email-log`).
//
// studio-server non ha database e il filesystem si azzera a ogni redeploy:
// per un invio di massa non basta. Payload il Postgres ce l'ha, e il campo
// `key` e' UNIQUE, quindi la create fa da lock: chi la vince invia, chi si
// becca il duplicato salta. Nessun lock applicativo.
//
// Regola: se Payload non risponde, NON si invia. Fallire chiuso, mai aperto.
import { getPortalsGateway } from "@/features/portals/gateway.js";
import { sendKyronEmail } from "@/core/email/mailer.js";

export const EMAIL_LOG_COLLECTION = "email-log";

export const logKey = (campaign: string, docKey: string): string => `${campaign}:${docKey}`;

const DUPLICATE = /unique|duplicate|already exists|deve essere unico/i;

export interface ClaimInput {
  campaign: string;
  docKey: string;
  email: string;
  orderNumber: string;
  subject: string;
  body: string;
}

/**
 * Prenota l'invio. Torna l'id della riga = prenotato, tocca a noi mandare la
 * mail. `null` = qualcun altro l'ha gia' mandata, si salta.
 * Throw = Payload non raggiungibile: il chiamante deve fermarsi, non inviare.
 */
export async function claimSend(input: ClaimInput): Promise<string | null> {
  const key = logKey(input.campaign, input.docKey);
  try {
    const res = await getPortalsGateway().create(EMAIL_LOG_COLLECTION, {
      key,
      campaign: input.campaign,
      docKey: input.docKey,
      email: input.email,
      orderNumber: input.orderNumber,
      subject: input.subject,
      body: input.body,
      sentAt: new Date().toISOString(),
      status: "sent",
    });
    return String(res.data.id);
  } catch (err) {
    if (DUPLICATE.test(err instanceof Error ? err.message : String(err))) return null;
    throw err;
  }
}

/** L'invio e' fallito dopo il claim: si marca, cosi' un rerun lo puo' ritentare. */
export async function markFailed(id: string): Promise<void> {
  await getPortalsGateway().update(EMAIL_LOG_COLLECTION, id, { status: "failed" });
}

/** docKey gia' inviati per questa campagna. Una sola query, non una per documento. */
export async function listSent(campaign: string): Promise<Set<string>> {
  const sent = new Set<string>();
  for (let page = 1; page <= 20; page++) {
    const res = await getPortalsGateway().list(EMAIL_LOG_COLLECTION, {
      limit: 500,
      page,
      where: { campaign: { equals: campaign }, status: { equals: "sent" } },
    });
    for (const doc of res.data) sent.add(String(doc.docKey));
    if (page >= res.meta.totalPages) break;
  }
  return sent;
}

/** Comunicazioni inviate a un ordine, per il log sulla scheda ordine. */
export async function listForOrder(orderNumber: string): Promise<Record<string, unknown>[]> {
  const res = await getPortalsGateway().list(EMAIL_LOG_COLLECTION, {
    limit: 50,
    sort: "-sentAt",
    where: { orderNumber: { equals: orderNumber } },
  });
  return res.data;
}

/** Testo leggibile dall'HTML della mail: nel drawer serve il contenuto, non il markup. */
export function htmlToText(html: string): string {
  return html
    .replace(/<(head|style|script)[\s\S]*?<\/\1>/gi, "")
    .replace(/<br\s*\/?>|<\/(p|tr|div|h\d)>/gi, "\n")
    .replace(/<[^>]+>/g, "")
    .replace(/&nbsp;|&zwnj;/g, " ")
    .replace(/&egrave;/g, "e")
    .replace(/&amp;/g, "&")
    .replace(/&[a-z]+;/gi, "")
    .replace(/[ \t]+/g, " ")
    .replace(/\n\s*\n+/g, "\n")
    .trim();
}

/**
 * Manda una mail legata a un ordine e la registra nel log, cosi' la scheda
 * ordine mostra TUTTE le comunicazioni partite e non solo le campagne massive.
 *
 * Niente lock qui: l'anti-doppio-invio di queste mail sta gia' sui metadata
 * dell'ordine Saleor, quindi `docKey` porta il timestamp e ogni invio e' una
 * riga sua. Il log e' best-effort: una riga persa non fa fallire l'invio.
 */
export async function sendAndLog(input: {
  campaign: string;
  orderNumber: string;
  to: string;
  subject: string;
  html: string;
}): Promise<void> {
  await sendKyronEmail(input.subject, input.html, [input.to]);
  await recordSent({ ...input, body: htmlToText(input.html) });
}

/** Registra una mail gia' inviata (usata anche dalle mail interne dello storefront). */
export async function recordSent(input: {
  campaign: string;
  orderNumber: string;
  to: string;
  subject: string;
  body: string;
}): Promise<void> {
  const docKey = `${input.orderNumber}:${Date.now()}`;
  try {
    await getPortalsGateway().create(EMAIL_LOG_COLLECTION, {
      key: logKey(input.campaign, docKey),
      campaign: input.campaign,
      docKey,
      email: input.to,
      orderNumber: input.orderNumber,
      subject: input.subject,
      body: input.body,
      sentAt: new Date().toISOString(),
      status: "sent",
    });
  } catch (e) {
    console.warn("[email-log] record failed:", String(e));
  }
}

/** Comunicazioni inviate a un indirizzo, per la scheda cliente. */
export async function listForEmail(email: string): Promise<Record<string, unknown>[]> {
  const res = await getPortalsGateway().list(EMAIL_LOG_COLLECTION, {
    limit: 100,
    sort: "-sentAt",
    where: { email: { equals: email.trim().toLowerCase() } },
  });
  return res.data;
}
