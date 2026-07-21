// Brain: decision-019 — "Bonifico pagato": il team conferma di aver incassato il
// bonifico. Marca l'ordine come PAGATO in Saleor (orderMarkAsPaid → paymentStatus
// FULLY_CHARGED, coerente con badge/Danea/report), registra il timestamp nei
// metadata (bankTransferPaidAt, audit best-effort) e invia al cliente la mail di
// conferma "bonifico ricevuto".
import {
  setOrderMeta,
  fetchOrderHeader,
  markOrderAsPaid,
} from "@/core/saleor/orders.js";
import { sendKyronEmail } from "@/core/email/mailer.js";

export async function markBankTransferPaid(
  orderId: string,
): Promise<{ paidAt: string; emailed: boolean }> {
  const paidAt = new Date().toISOString();
  // Primario: lo stato pagamento Saleor. Se fallisce, l'azione fallisce (non
  // dichiariamo "pagato" senza che Saleor lo registri).
  await markOrderAsPaid(orderId);

  // Audit best-effort: il badge "Pagato" deriva gia' da paymentStatus, quindi un
  // fallimento qui non deve far fallire l'azione.
  try {
    await setOrderMeta(orderId, "bankTransferPaidAt", paidAt);
  } catch (e) {
    console.warn("[bank-transfer] paidAt meta failed:", String(e));
  }

  // Email best-effort al cliente.
  let emailed = false;
  try {
    const { number, userEmail, channelName } = await fetchOrderHeader(orderId);
    const to = userEmail.trim();
    if (to) {
      await sendKyronEmail(
        `Bonifico ricevuto — Ordine #${number}`,
        renderPaidEmail(number, channelName),
        [to],
      );
      emailed = true;
    }
  } catch (e) {
    console.warn("[bank-transfer] paid email failed:", String(e));
  }
  return { paidAt, emailed };
}

// Brain: decision-019 — pagamento misto: tranche 2. Il team ha incassato il
// residuo bonifico DOPO aver acquisito il buono Carta del Docente. Ora buono +
// residuo coprono il totale -> marca l'ordine pagato (FULLY_CHARGED), registra il
// timestamp dedicato (teacherCardResidualPaidAt, distinto dal bonifico puro per
// chiarezza audit) e conferma al cliente con la stessa mail "bonifico ricevuto".
export async function markResidualBankTransferPaid(
  orderId: string,
): Promise<{ paidAt: string; emailed: boolean }> {
  const paidAt = new Date().toISOString();
  await markOrderAsPaid(orderId);

  try {
    await setOrderMeta(orderId, "teacherCardResidualPaidAt", paidAt);
  } catch (e) {
    console.warn("[bank-transfer] residual paidAt meta failed:", String(e));
  }

  let emailed = false;
  try {
    const { number, userEmail, channelName } = await fetchOrderHeader(orderId);
    const to = userEmail.trim();
    if (to) {
      await sendKyronEmail(
        `Bonifico ricevuto — Ordine #${number}`,
        renderPaidEmail(number, channelName),
        [to],
      );
      emailed = true;
    }
  } catch (e) {
    console.warn("[bank-transfer] residual paid email failed:", String(e));
  }
  return { paidAt, emailed };
}

// Email "bonifico ricevuto / ordine confermato" nel design system Kyron.
function renderPaidEmail(orderNumber: string, portalName: string): string {
  const portal = portalName ? ` sul portale <strong>${portalName}</strong>` : "";
  const motivo = portalName ? `un ordine sul portale ${portalName}` : "un tuo ordine";
  return `<!DOCTYPE html>
<html lang="it"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1"></head>
<body style="margin:0;padding:0;background-color:#F4F5F5;">
  <div style="display:none;font-size:1px;line-height:1px;max-height:0;max-width:0;opacity:0;overflow:hidden;">
    Abbiamo ricevuto il tuo bonifico: l'ordine #${orderNumber} &egrave; confermato.&nbsp;&zwnj;&nbsp;&zwnj;
  </div>
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background-color:#F4F5F5;">
    <tr><td align="center" style="padding:32px 16px;">
      <table role="presentation" width="600" cellpadding="0" cellspacing="0" border="0" style="max-width:600px;width:100%;background-color:#FFFFFF;border-radius:12px;">
        <tr><td style="padding:36px 40px 8px;">
          <img src="cid:kyron-logo" alt="Kyron" width="110" style="display:block;width:110px;max-width:110px;height:auto;border:0;outline:none;">
        </td></tr>
        <tr><td style="padding:20px 40px 0;font-family:Helvetica,Arial,sans-serif;font-size:24px;line-height:1.3;font-weight:700;color:#0E4F4E;">
          Bonifico ricevuto
        </td></tr>
        <tr><td style="padding:16px 40px 0;font-family:Helvetica,Arial,sans-serif;font-size:15px;line-height:1.6;color:#0E4F4E;">
          Ciao, abbiamo ricevuto il tuo bonifico. Il tuo ordine <strong>#${orderNumber}</strong>${portal} &egrave; ora <strong>confermato</strong> e procediamo con la preparazione.
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
