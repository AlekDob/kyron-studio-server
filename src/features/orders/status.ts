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

function renderShipEmail(orderNumber: string, portalName: string): string {
  const portal = portalName ? ` su <strong>${portalName}</strong>` : "";
  return `
  <div style="font-family:-apple-system,Segoe UI,Roboto,sans-serif;max-width:480px;margin:0 auto;padding:24px;color:#1a1a1a">
    <img src="cid:kyron-logo" alt="Kyron" height="32" style="margin-bottom:24px"/>
    <h1 style="font-size:20px;margin:0 0 12px">Il tuo ordine è in viaggio</h1>
    <p style="font-size:15px;line-height:1.5;color:#444">
      Ciao, il tuo ordine <strong>#${orderNumber}</strong>${portal} è stato
      <strong>spedito</strong>. Riceverai i tuoi prodotti a breve.
    </p>
    <p style="font-size:13px;color:#999;margin-top:24px">
      Per qualsiasi domanda rispondi a questa email o scrivi a info@kyronedu.it.
    </p>
  </div>`;
}
