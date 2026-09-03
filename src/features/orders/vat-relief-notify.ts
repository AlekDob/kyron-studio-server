// Feature 002 — mail al cliente col nuovo importo dopo l'approvazione dell'IVA
// agevolata 4%. Prima non partiva nulla: il cliente restava con la conferma di
// checkout al 22% e un totale diverso in Studio (segnalazione ordine 460).
//
// Chiamata da PATCH /orders/payment-total, best-effort: se la mail non parte
// l'importo resta comunque allineato.
//
// Due paletti, perche' quell'endpoint serve anche le modifiche importo generiche:
//   1. si invia SOLO se la richiesta IVA agevolata e' "approved"
//   2. si invia SOLO se l'importo e' diverso dall'ultimo gia' comunicato
//      (metadata kyron_vat_amount_emailed_for) -> doppio click = una mail sola,
//      correzione dell'importo = nuova mail.
import { fetchOrderHeader, fetchOrderMeta, setOrderMeta } from "@/core/saleor/orders.js";
import { sendAndLog } from "./email-log.js";

const VAT_STATUS_META = "kyron_vat_agevolata_status";
const EMAILED_FOR_META = "kyron_vat_amount_emailed_for";

const eur = (n: number): string =>
  new Intl.NumberFormat("it-IT", { style: "currency", currency: "EUR" }).format(n);

/** Chiave di idempotenza: l'importo comunicato, a 2 decimali. */
export const amountKey = (amount: number): string => amount.toFixed(2);

/** I due paletti, isolati per poterli testare senza toccare Saleor. */
export function shouldNotify(
  vatStatus: string,
  emailedFor: string,
  amount: number,
): boolean {
  if (amount <= 0) return false;
  if (vatStatus !== "approved") return false;
  return emailedFor !== amountKey(amount);
}

export async function notifyVatReliefAmount(
  orderId: string,
  amount: number,
): Promise<boolean> {
  if (amount <= 0) return false;
  const status = await fetchOrderMeta(orderId, VAT_STATUS_META);
  const emailedFor = await fetchOrderMeta(orderId, EMAILED_FOR_META);
  if (!shouldNotify(status, emailedFor, amount)) return false;
  const key = amountKey(amount);

  const { number, userEmail, channelName } = await fetchOrderHeader(orderId);
  const to = userEmail.trim();
  if (!to) return false;

  await sendAndLog({
    campaign: "iva-4-importo-aggiornato",
    orderNumber: number,
    to,
    subject: `Importo aggiornato con IVA 4% — Ordine #${number}`,
    html: renderVatReliefEmail(number, channelName, amount),
  });
  // Scritto solo dopo l'invio riuscito: se Resend fallisce si riprova.
  await setOrderMeta(orderId, EMAILED_FOR_META, key);
  return true;
}

// Mail "importo aggiornato a IVA 4%" nel design system Kyron (logo inline cid).
function renderVatReliefEmail(
  orderNumber: string,
  portalName: string,
  amount: number,
): string {
  const portal = portalName ? ` sul portale <strong>${portalName}</strong>` : "";
  const motivo = portalName ? `un ordine sul portale ${portalName}` : "un tuo ordine";
  const totale = eur(amount);
  return `<!DOCTYPE html>
<html lang="it"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1"></head>
<body style="margin:0;padding:0;background-color:#F4F5F5;">
  <div style="display:none;font-size:1px;line-height:1px;max-height:0;max-width:0;opacity:0;overflow:hidden;">
    Agevolazione IVA 4% approvata: il nuovo importo dell'ordine #${orderNumber} &egrave; ${totale}.&nbsp;&zwnj;&nbsp;&zwnj;
  </div>
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background-color:#F4F5F5;">
    <tr><td align="center" style="padding:32px 16px;">
      <table role="presentation" width="600" cellpadding="0" cellspacing="0" border="0" style="max-width:600px;width:100%;background-color:#FFFFFF;border-radius:12px;">
        <tr><td style="padding:36px 40px 8px;">
          <img src="cid:kyron-logo" alt="Kyron" width="110" style="display:block;width:110px;max-width:110px;height:auto;border:0;outline:none;">
        </td></tr>
        <tr><td style="padding:20px 40px 0;font-family:Helvetica,Arial,sans-serif;font-size:24px;line-height:1.3;font-weight:700;color:#0E4F4E;">
          Agevolazione IVA 4% approvata
        </td></tr>
        <tr><td style="padding:16px 40px 0;font-family:Helvetica,Arial,sans-serif;font-size:15px;line-height:1.6;color:#0E4F4E;">
          Ciao, abbiamo verificato i documenti che hai allegato al checkout: l&apos;IVA agevolata al 4% &egrave; stata approvata per il tuo ordine <strong>#${orderNumber}</strong>${portal}.
        </td></tr>
        <tr><td style="padding:20px 40px 0;">
          <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background-color:#F4F5F5;border-radius:8px;">
            <tr><td style="padding:16px 20px;font-family:Helvetica,Arial,sans-serif;font-size:14px;line-height:1.5;color:#5C8682;">
              Nuovo importo dell&apos;ordine<br>
              <span style="font-size:26px;font-weight:700;color:#0E4F4E;">${totale}</span>
            </td></tr>
          </table>
        </td></tr>
        <tr><td style="padding:20px 40px 0;font-family:Helvetica,Arial,sans-serif;font-size:15px;line-height:1.6;color:#0E4F4E;">
          Se non hai ancora fatto il bonifico, usa <strong>questo</strong> importo: le coordinate sono nella mail di conferma dell&apos;ordine. Se hai gi&agrave; pagato la cifra precedente, ti restituiamo la differenza &mdash; rispondi a questa email e ci pensiamo noi.
        </td></tr>
        <tr><td style="padding:16px 40px 0;font-family:Helvetica,Arial,sans-serif;font-size:15px;line-height:1.6;color:#0E4F4E;">
          Per qualsiasi domanda rispondi a questa email o scrivi a <a href="mailto:info@kyronedu.it" style="color:#0E4F4E;font-weight:600;text-decoration:underline;">info@kyronedu.it</a>.
        </td></tr>
        <tr><td style="padding:28px 40px 0;font-family:Helvetica,Arial,sans-serif;font-size:15px;line-height:1.6;color:#0E4F4E;">
          &mdash; Il team Kyron
        </td></tr>
        <tr><td style="padding:0 40px 36px;"></td></tr>
      </table>
      <table role="presentation" width="600" cellpadding="0" cellspacing="0" border="0" style="max-width:600px;width:100%;">
        <tr><td align="center" style="padding:24px 40px 8px;font-family:Helvetica,Arial,sans-serif;font-size:12px;line-height:1.6;color:#5C8682;">
          Kyron &mdash; soluzioni digitali per la scuola<br>
          <a href="https://kyronedu.it" style="color:#5C8682;text-decoration:underline;">kyronedu.it</a> &nbsp;&middot;&nbsp;
          <a href="mailto:info@kyronedu.it" style="color:#5C8682;text-decoration:underline;">info@kyronedu.it</a><br>
          Hai ricevuto questa email in seguito a ${motivo}.
        </td></tr>
      </table>
    </td></tr>
  </table>
</body></html>`;
}
