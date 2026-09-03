// Avviso via mail quando un collega apre una richiesta (feature 022). Stesso
// mittente e stessa impaginazione dei report Kyron: logo cid, canvas grigio,
// card 600px, tutto inline.
//
// E' un avviso, non un report: nessuno scheduler, parte all'apertura del ticket.
import { sendKyronEmail, recipientsFromEnv } from "@/core/email/mailer.js";
import { URGENCY, type Urgency } from "@/core/linear/client.js";
import type { LinearLabel, LinearState } from "@/core/linear/client.js";

const DEFAULT_TO = "gmail@alekdob.com";

const TEAL = "#0E4F4E";
const MUTED = "#5C8682";
const ALERT = "#B42318";
const LINE = "#e3e9e8";
const FONT = "Helvetica,Arial,sans-serif";

const STATE_LABEL: Record<LinearState, string> = {
  todo: "Da fare",
  backlog: "Quando si puo'",
};

function esc(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

export interface NewRequestMail {
  identifier: string;
  title: string;
  url: string;
  description: string;
  label: LinearLabel;
  state: LinearState;
  urgency: Urgency;
  requestedBy: string;
}

/** Pastiglia di riepilogo. Le urgenti sono rosse: si vedono senza leggere. */
function chip(text: string, urgent = false): string {
  const color = urgent ? ALERT : TEAL;
  const bg = urgent ? "#FEF3F2" : "#F4F5F5";
  return `<span style="display:inline-block;margin:0 6px 6px 0;padding:3px 10px;border-radius:12px;background-color:${bg};color:${color};font-family:${FONT};font-size:12px;font-weight:700;">${esc(text)}</span>`;
}

export function renderNewRequestHtml(r: NewRequestMail): string {
  const urgent = r.urgency === "bloccante";
  const preview = `${r.identifier} · ${r.title}`;
  return `<!DOCTYPE html>
<html lang="it">
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>${esc(r.identifier)}</title></head>
<body style="margin:0;padding:0;background-color:#F4F5F5;">
  <div style="display:none;font-size:1px;line-height:1px;max-height:0;max-width:0;opacity:0;overflow:hidden;mso-hide:all;">${esc(preview)}&nbsp;&zwnj;&nbsp;&zwnj;</div>
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background-color:#F4F5F5;">
    <tr><td align="center" style="padding:32px 16px;">
      <table role="presentation" width="600" cellpadding="0" cellspacing="0" border="0" style="max-width:600px;width:100%;background-color:#FFFFFF;border-radius:12px;">
        <tr><td style="padding:36px 40px 8px;">
          <img src="cid:kyron-logo" alt="Kyron" width="110" style="display:block;width:110px;max-width:110px;height:auto;border:0;outline:none;">
        </td></tr>
        <tr><td style="padding:20px 40px 0;font-family:${FONT};font-size:13px;color:${MUTED};">
          Nuova richiesta &middot; <strong style="color:${TEAL};">${esc(r.identifier)}</strong>
        </td></tr>
        <tr><td style="padding:4px 40px 0;font-family:${FONT};font-size:24px;line-height:1.3;font-weight:700;color:${TEAL};">
          ${esc(r.title)}
        </td></tr>
        <tr><td style="padding:14px 40px 0;">
          ${chip(URGENCY[r.urgency].label, urgent)}${chip(r.label)}${chip(STATE_LABEL[r.state])}
        </td></tr>
        <tr><td style="padding:10px 40px 0;">
          <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background-color:#F4F5F5;border-radius:8px;">
            <tr><td style="padding:16px 20px;font-family:${FONT};font-size:14px;line-height:1.7;color:${TEAL};white-space:pre-wrap;">${esc(r.description)}</td></tr>
          </table>
        </td></tr>
        <tr><td style="padding:18px 40px 0;font-family:${FONT};font-size:13px;color:${MUTED};">
          Chiesta da <strong style="color:${TEAL};">${esc(r.requestedBy)}</strong>
        </td></tr>
        <tr><td style="padding:22px 40px 0;">
          <a href="${esc(r.url)}" style="display:inline-block;padding:11px 22px;border-radius:8px;background-color:${TEAL};color:#FFFFFF;font-family:${FONT};font-size:14px;font-weight:700;text-decoration:none;">Apri su Linear</a>
        </td></tr>
        <tr><td style="padding:26px 40px 36px;font-family:${FONT};font-size:13px;line-height:1.6;color:${MUTED};border-top:1px solid ${LINE};margin-top:20px;">
          &mdash; Ivo, il modulo Richieste di Studio. Questa mail parte a ogni richiesta aperta dal team.
        </td></tr>
      </table>
    </td></tr>
  </table>
</body>
</html>`;
}

export async function notifyNewRequest(r: NewRequestMail): Promise<void> {
  const subject = `${r.identifier} · ${r.title}`;
  await sendKyronEmail(subject, renderNewRequestHtml(r), recipientsFromEnv("REQUESTS_NOTIFY_TO", DEFAULT_TO));
}
