// Stato lavorazione interno Kyron di un ordine (workflow commerciali) + notifica
// "spedito" al cliente. Lo stato vive in order.metadata `kyron_status` su Saleor:
// NON usa la fulfillment nativa (che manderebbe email Saleor) — qui controlliamo noi.
import { setOrderMeta, fetchOrderHeader } from "@/core/saleor/orders.js";
import { sendKyronEmail } from "@/core/email/mailer.js";

export const WORKFLOW_STATUSES = [
  "nuovo",
  "in_preparazione",
  "spedito",
  "consegnato",
  "annullato",
] as const;

export type WorkflowStatus = (typeof WORKFLOW_STATUSES)[number];

export function isWorkflowStatus(v: string): v is WorkflowStatus {
  return (WORKFLOW_STATUSES as readonly string[]).includes(v);
}

// Cambia lo stato lavorazione. Se diventa "spedito", prova a notificare il
// cliente (gato da allowlist — vedi sendShipNotification). Ritorna se ha inviato.
export async function setWorkflowStatus(
  orderId: string,
  status: WorkflowStatus,
): Promise<{ status: WorkflowStatus; emailed: boolean }> {
  await setOrderMeta(orderId, "kyron_status", status);
  let emailed = false;
  if (status === "spedito") emailed = await sendShipNotification(orderId);
  return { status, emailed };
}

// Allowlist destinatari notifica spedizione. Se valorizzata (CSV), invia SOLO a
// quegli indirizzi (modalita' test). Se vuota/non settata, invia a tutti (go-live).
function notifyAllowlist(): string[] {
  return (process.env.ORDERS_SHIP_NOTIFY_ALLOW ?? "")
    .split(",")
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean);
}

// Invia la mail "ordine spedito" al cliente. Ritorna false (skip) se il
// destinatario non passa l'allowlist o non c'e' email.
export async function sendShipNotification(orderId: string): Promise<boolean> {
  const { number, userEmail, channelName } = await fetchOrderHeader(orderId);
  const to = userEmail.trim().toLowerCase();
  if (!to) return false;
  const allow = notifyAllowlist();
  if (allow.length > 0 && !allow.includes(to)) {
    console.log(`[orders] ship notify skipped (not in allowlist): ${to}`);
    return false;
  }
  await sendKyronEmail(
    `Il tuo ordine #${number} è stato spedito`,
    renderShipEmail(number, channelName),
    [userEmail],
  );
  return true;
}

// Email "ordine spedito" nel design system Kyron (skill kyron-email): card 600px
// table-based, testo teal #0E4F4E, logo come allegato inline cid:kyron-logo
// (width attributo + inline style: Apple Mail ignora il solo attributo).
function renderShipEmail(orderNumber: string, portalName: string): string {
  const portal = portalName ? ` sul portale <strong>${portalName}</strong>` : "";
  const motivo = portalName ? `un ordine sul portale ${portalName}` : "un tuo ordine";
  return `<!DOCTYPE html>
<html lang="it"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1"></head>
<body style="margin:0;padding:0;background-color:#F4F5F5;">
  <div style="display:none;font-size:1px;line-height:1px;max-height:0;max-width:0;opacity:0;overflow:hidden;">
    Il tuo ordine #${orderNumber} &egrave; stato spedito e arriver&agrave; a breve.&nbsp;&zwnj;&nbsp;&zwnj;
  </div>
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background-color:#F4F5F5;">
    <tr><td align="center" style="padding:32px 16px;">
      <table role="presentation" width="600" cellpadding="0" cellspacing="0" border="0" style="max-width:600px;width:100%;background-color:#FFFFFF;border-radius:12px;">
        <tr><td style="padding:36px 40px 8px;">
          <img src="cid:kyron-logo" alt="Kyron" width="110" style="display:block;width:110px;max-width:110px;height:auto;border:0;outline:none;">
        </td></tr>
        <tr><td style="padding:20px 40px 0;font-family:Helvetica,Arial,sans-serif;font-size:24px;line-height:1.3;font-weight:700;color:#0E4F4E;">
          Il tuo ordine &egrave; in viaggio
        </td></tr>
        <tr><td style="padding:16px 40px 0;font-family:Helvetica,Arial,sans-serif;font-size:15px;line-height:1.6;color:#0E4F4E;">
          Ciao, il tuo ordine <strong>#${orderNumber}</strong>${portal} &egrave; stato <strong>spedito</strong>. Riceverai i tuoi prodotti a breve.
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
