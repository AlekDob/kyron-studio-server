// Cornice Kyron di una comunicazione ai clienti. Il testo NON e' fisso: lo detta
// l'operatore in chat, l'agente lo trasforma in titolo + paragrafi. Qui c'e' solo
// la card 600px table-based (teal #0E4F4E, logo inline cid:kyron-logo — skill
// kyron-email) piu' un riquadro grigio opzionale per i dati che rendono la mail
// riconoscibile (i prodotti di un DDT, gli ordini di un cliente).

export interface Campaign {
  /** Oggetto della mail, scritto dall'agente dal brief dell'operatore. */
  subject: string;
  /** Titolo dentro la card. */
  heading: string;
  /** Paragrafi del corpo, gia' in italiano e gia' rivisti in chat. */
  paragraphs: string[];
}

export const esc = (s: string): string =>
  s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

const P_STYLE =
  "padding:16px 40px 0;font-family:Helvetica,Arial,sans-serif;font-size:15px;line-height:1.6;color:#0E4F4E;";

/** Riquadro grigio: righe gia' escapate, separate da <br>. Vuoto = niente riquadro. */
export function detailsBox(bits: string[]): string {
  const rows = bits.filter(Boolean);
  if (rows.length === 0) return "";
  return `<tr><td style="padding:20px 40px 0;">
          <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background-color:#F4F5F5;border-radius:8px;">
            <tr><td style="padding:16px 20px;font-family:Helvetica,Arial,sans-serif;font-size:14px;line-height:1.6;color:#0E4F4E;">
              ${rows.join("<br><br>")}
            </td></tr>
          </table>
        </td></tr>`;
}

export function renderCampaignEmail(campaign: Campaign, detailsHtml = ""): string {
  const body = campaign.paragraphs.map((p) => `<tr><td style="${P_STYLE}">${esc(p)}</td></tr>`).join("");
  return `<!DOCTYPE html>
<html lang="it"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1"></head>
<body style="margin:0;padding:0;background-color:#F4F5F5;">
  <div style="display:none;font-size:1px;line-height:1px;max-height:0;max-width:0;opacity:0;overflow:hidden;">
    ${esc(campaign.subject)}&nbsp;&zwnj;&nbsp;&zwnj;
  </div>
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background-color:#F4F5F5;">
    <tr><td align="center" style="padding:32px 16px;">
      <table role="presentation" width="600" cellpadding="0" cellspacing="0" border="0" style="max-width:600px;width:100%;background-color:#FFFFFF;border-radius:12px;">
        <tr><td style="padding:36px 40px 8px;">
          <img src="cid:kyron-logo" alt="Kyron" width="110" style="display:block;width:110px;max-width:110px;height:auto;border:0;outline:none;">
        </td></tr>
        <tr><td style="padding:20px 40px 0;font-family:Helvetica,Arial,sans-serif;font-size:24px;line-height:1.3;font-weight:700;color:#0E4F4E;">
          ${esc(campaign.heading)}
        </td></tr>
        ${body}
        ${detailsHtml}
        <tr><td style="${P_STYLE}">
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
          Hai ricevuto questa email in seguito a un ordine sul portale scolastico Kyron.
        </td></tr>
      </table>
    </td></tr>
  </table>
</body></html>`;
}

/** Testo semplice della comunicazione, per il log e per l'anteprima in chat. */
export function campaignPlainText(campaign: Campaign): string {
  return [campaign.heading, ...campaign.paragraphs].join("\n\n");
}
