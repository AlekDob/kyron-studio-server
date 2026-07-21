// Brain: decision-019 — "Carta del Docente acquisita": il team conferma di aver
// acquisito il buono sul portale del Ministero. Registra il timestamp nei
// metadata ordine (teacherCardAcquiredAt) e invia al cliente la mail di conferma.
// Se il buono copre l'intero importo, marca anche l'ordine PAGATO in Saleor
// (come il bonifico), cosi' badge Studio / export Danea / report restano coerenti.
import {
  setOrderMeta,
  fetchOrderHeader,
  fetchOrderCoverage,
  markOrderAsPaid,
} from "@/core/saleor/orders.js";
import { sendKyronEmail } from "@/core/email/mailer.js";

export async function markTeacherCardAcquired(
  orderId: string,
): Promise<{ acquiredAt: string; emailed: boolean; markedPaid: boolean }> {
  const acquiredAt = new Date().toISOString();
  await setOrderMeta(orderId, "teacherCardAcquiredAt", acquiredAt);

  // L'ordine e' saldato all'acquisizione del buono quando NON resta un residuo
  // bonifico da incassare a mano: il buono copre tutto, oppure il residuo e' su
  // carta (gia' incassato da Stripe al checkout). Se invece il residuo e' via
  // bonifico, l'ordine resta "acconto" e attende la tranche 2 (residual-paid).
  // Best-effort: l'acquisizione (metadata) e' gia' registrata; un fallimento del
  // mark-paid viene loggato senza far fallire l'azione (tolleranza 0,5 cent).
  let markedPaid = false;
  try {
    const { total, teacherCardAmount, residualMethod } = await fetchOrderCoverage(orderId);
    const coversAll = teacherCardAmount !== null && teacherCardAmount + 0.005 >= total;
    const residualOnCard = residualMethod === "card";
    if ((coversAll || residualOnCard) && residualMethod !== "bank-transfer") {
      await markOrderAsPaid(orderId);
      markedPaid = true;
    }
  } catch (e) {
    console.warn("[teacher-card] mark-paid skipped:", String(e));
  }

  // Email best-effort: l'acquisizione (metadata) e' gia' registrata; se l'invio
  // fallisce (es. RESEND non configurato) non facciamo fallire l'azione.
  let emailed = false;
  try {
    const { number, userEmail, channelName } = await fetchOrderHeader(orderId);
    const to = userEmail.trim();
    if (to) {
      await sendKyronEmail(
        `Buono Carta del Docente acquisito — Ordine #${number}`,
        renderAcquiredEmail(number, channelName),
        [to],
      );
      emailed = true;
    }
  } catch (e) {
    console.warn("[teacher-card] acquired email failed:", String(e));
  }
  return { acquiredAt, emailed, markedPaid };
}

// Email "buono acquisito / ordine confermato" nel design system Kyron.
function renderAcquiredEmail(orderNumber: string, portalName: string): string {
  const portal = portalName ? ` sul portale <strong>${portalName}</strong>` : "";
  const motivo = portalName ? `un ordine sul portale ${portalName}` : "un tuo ordine";
  return `<!DOCTYPE html>
<html lang="it"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1"></head>
<body style="margin:0;padding:0;background-color:#F4F5F5;">
  <div style="display:none;font-size:1px;line-height:1px;max-height:0;max-width:0;opacity:0;overflow:hidden;">
    Abbiamo acquisito il tuo buono Carta del Docente: l'ordine #${orderNumber} &egrave; confermato.&nbsp;&zwnj;&nbsp;&zwnj;
  </div>
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background-color:#F4F5F5;">
    <tr><td align="center" style="padding:32px 16px;">
      <table role="presentation" width="600" cellpadding="0" cellspacing="0" border="0" style="max-width:600px;width:100%;background-color:#FFFFFF;border-radius:12px;">
        <tr><td style="padding:36px 40px 8px;">
          <img src="cid:kyron-logo" alt="Kyron" width="110" style="display:block;width:110px;max-width:110px;height:auto;border:0;outline:none;">
        </td></tr>
        <tr><td style="padding:20px 40px 0;font-family:Helvetica,Arial,sans-serif;font-size:24px;line-height:1.3;font-weight:700;color:#0E4F4E;">
          Buono Carta del Docente acquisito
        </td></tr>
        <tr><td style="padding:16px 40px 0;font-family:Helvetica,Arial,sans-serif;font-size:15px;line-height:1.6;color:#0E4F4E;">
          Ciao, abbiamo acquisito il tuo buono Carta del Docente sul portale del Ministero. Il tuo ordine <strong>#${orderNumber}</strong>${portal} &egrave; ora <strong>confermato</strong> e procediamo con la preparazione.
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
