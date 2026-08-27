// Invio massivo. Una mail per destinatario, mai un `to` con dentro tutti:
// altrimenti i clienti si vedono gli indirizzi a vicenda. Riusa sendKyronEmail,
// cosi' il logo inline cid: continua a funzionare (l'endpoint /emails/batch di
// Resend non supporta gli allegati).
//
// Il ritmo e' 2 invii al secondo, il limite del piano Resend. Su 429 un solo
// retry, poi il destinatario va in `failed` e si prosegue: un indirizzo morto
// non deve fermare il lotto.
import { sendKyronEmail } from "./mailer.js";

const GAP_MS = 500;
const RETRY_MS = 2_000;

const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

export interface BulkMessage {
  /** Identificatore stabile del messaggio (per noi: il docKey del DDT). */
  key: string;
  to: string;
  subject: string;
  html: string;
}

export interface BulkResult {
  key: string;
  to: string;
  ok: boolean;
  error: string;
}

/** Allowlist CSV: se valorizzata invia SOLO a quegli indirizzi (modo test). */
export function allowlistFromEnv(envVar: string): string[] {
  return (process.env[envVar] ?? "")
    .split(",")
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean);
}

export function passesAllowlist(email: string, allow: string[]): boolean {
  return allow.length === 0 || allow.includes(email.trim().toLowerCase());
}

async function sendOne(msg: BulkMessage): Promise<BulkResult> {
  try {
    await sendKyronEmail(msg.subject, msg.html, [msg.to]);
    return { key: msg.key, to: msg.to, ok: true, error: "" };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    if (!message.includes("429")) return { key: msg.key, to: msg.to, ok: false, error: message };
    await sleep(RETRY_MS);
    try {
      await sendKyronEmail(msg.subject, msg.html, [msg.to]);
      return { key: msg.key, to: msg.to, ok: true, error: "" };
    } catch (err2) {
      const m2 = err2 instanceof Error ? err2.message : String(err2);
      return { key: msg.key, to: msg.to, ok: false, error: m2 };
    }
  }
}

/**
 * Invia in sequenza. `onSent` scatta dopo ogni messaggio, cosi' il chiamante
 * puo' aggiornare il registro senza aspettare la fine del lotto.
 */
export async function sendBulk(
  messages: BulkMessage[],
  onSent?: (result: BulkResult) => Promise<void>,
): Promise<BulkResult[]> {
  const results: BulkResult[] = [];
  for (const [i, msg] of messages.entries()) {
    if (i > 0) await sleep(GAP_MS);
    const result = await sendOne(msg);
    results.push(result);
    if (onSent) await onSent(result);
  }
  return results;
}
