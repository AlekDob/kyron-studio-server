// Storico mail da Resend. Il nostro `email-log` sa solo che una mail e' PARTITA;
// Resend sa se e' stata consegnata, aperta o rimbalzata — l'unica risposta utile
// quando un cliente dice "non mi e' arrivato niente".
//
// Resend tiene ~30 giorni di archivio: tutto l'account sono 5 pagine da 100.
// Quindi si scarica intero e si tiene in memoria 5 minuti, invece di interrogare
// l'API a ogni apertura di ordine (l'API non filtra per destinatario: `?to=` viene
// ignorato, il filtro lo facciamo noi).

import { htmlToText } from "./email-log.js";

const TTL_MS = 5 * 60_000;
const MAX_PAGES = 15;

export interface ResendEmail {
  id: string;
  to: string[];
  subject: string;
  sentAt: string;
  /** delivered | opened | clicked | bounced | complained | sent | queued */
  lastEvent: string;
}

interface ApiRow {
  id: string;
  to: string[] | null;
  subject: string | null;
  created_at: string;
  last_event: string | null;
}

let cache: { at: number; rows: ResendEmail[] } | null = null;
let inflight: Promise<ResendEmail[]> | null = null;

async function fetchPage(after: string | null): Promise<{ rows: ApiRow[]; more: boolean }> {
  const url = `https://api.resend.com/emails?limit=100${after ? `&after=${after}` : ""}`;
  const res = await fetch(url, {
    headers: { Authorization: `Bearer ${process.env.RESEND_API_KEY}` },
  });
  if (!res.ok) throw new Error(`Resend ${res.status}: ${await res.text()}`);
  const json = (await res.json()) as { data: ApiRow[]; has_more?: boolean };
  return { rows: json.data ?? [], more: Boolean(json.has_more) };
}

async function fetchAll(): Promise<ResendEmail[]> {
  const rows: ResendEmail[] = [];
  let after: string | null = null;
  for (let page = 0; page < MAX_PAGES; page++) {
    const { rows: batch, more } = await fetchPage(after);
    for (const r of batch) {
      rows.push({
        id: r.id,
        to: r.to ?? [],
        subject: r.subject ?? "",
        // "2026-08-31 07:30:13.816000+00" non e' ISO: senza la T lo parsano male.
        sentAt: r.created_at.replace(" ", "T").replace("+00", "Z"),
        lastEvent: r.last_event ?? "sent",
      });
    }
    if (!more || batch.length === 0) break;
    after = batch[batch.length - 1].id;
  }
  return rows;
}

/** Tutte le mail dell'account, dalla cache. Una sola fetch anche con 10 chiamate insieme. */
export async function listResendEmails(): Promise<ResendEmail[]> {
  if (!process.env.RESEND_API_KEY) return [];
  if (cache && Date.now() - cache.at < TTL_MS) return cache.rows;
  if (inflight) return inflight;
  inflight = fetchAll()
    .then((rows) => {
      cache = { at: Date.now(), rows };
      return rows;
    })
    .finally(() => {
      inflight = null;
    });
  return inflight;
}

/**
 * Una mail appartiene a un ordine se ne cita il numero nell'oggetto (`#504`,
 * confine a destra per non far passare #5041) o se e' andata al suo cliente.
 * Il secondo criterio prende anche le mail senza numero (es. il buono caricato
 * al checkout prima che l'ordine esista).
 */
export function matchesOrder(mail: ResendEmail, number: string, email?: string): boolean {
  if (new RegExp(`#${number}(?!\\d)`).test(mail.subject)) return true;
  const to = email?.trim().toLowerCase();
  return Boolean(to) && mail.to.some((r) => r.toLowerCase().includes(to!));
}

/** Testo di una singola mail gia' inviata. Serve a rileggere cosa ha ricevuto il cliente. */
export async function fetchResendBody(id: string): Promise<string> {
  if (!process.env.RESEND_API_KEY) return "";
  const res = await fetch(`https://api.resend.com/emails/${encodeURIComponent(id)}`, {
    headers: { Authorization: `Bearer ${process.env.RESEND_API_KEY}` },
  });
  if (!res.ok) throw new Error(`Resend ${res.status}`);
  const mail = (await res.json()) as { text?: string; html?: string };
  // I template Kyron non mandano quasi mai la versione testo: si ripiega
  // sull'HTML ridotto a testo (stesso strip del registro Payload).
  return mail.text?.trim() || htmlToText(mail.html ?? "");
}

/**
 * Mail al cliente o mail interna al team? Il criterio e' il destinatario: se c'e'
 * l'email dell'ordine e' roba che il cliente ha ricevuto, altrimenti e' una
 * notifica nostra (ordini@kyronedu.it, l'agente in copia...). Senza email
 * dell'ordine si ripiega sul dominio: @kyronedu.it = interna.
 */
export function audienceOf(to: string[], customerEmail?: string): "cliente" | "interna" {
  const client = customerEmail?.trim().toLowerCase();
  if (client) return to.some((r) => r.toLowerCase().includes(client)) ? "cliente" : "interna";
  return to.every((r) => r.toLowerCase().includes("@kyronedu.it")) ? "interna" : "cliente";
}
