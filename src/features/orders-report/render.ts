// Render HTML email-safe del report ordini giornaliero, RAGGRUPPATO PER PORTALE.
// Stessa palette/struttura del report analytics e del template skill kyron-email:
// canvas #F4F5F5, card 600px, logo cid 110px, tutto inline, font Helvetica.
import type { OrderSummary, OrderLine } from "@/core/saleor/orders.js";

const TEAL = "#0E4F4E";
const MUTED = "#5C8682";
const FONT = "Helvetica,Arial,sans-serif";
const fmtEur = new Intl.NumberFormat("it-IT", {
  style: "currency",
  currency: "EUR",
  minimumFractionDigits: 2,
});

export interface PortalGroup {
  slug: string;
  name: string;
  // Email agente commerciale di riferimento (PendingSchools.requestedBy), vuoto se ignoto.
  agent: string;
  orders: OrderSummary[];
}

// Raggruppa per channel (portale), ordinati per numero ordini decrescente.
// `agentBySlug` (opzionale) associa lo slug portale all'email dell'agente.
export function groupByPortal(
  orders: OrderSummary[],
  agentBySlug?: Map<string, string>,
): PortalGroup[] {
  const map = new Map<string, PortalGroup>();
  for (const o of orders) {
    const g =
      map.get(o.channelSlug) ??
      {
        slug: o.channelSlug,
        name: o.channelName || o.channelSlug,
        agent: agentBySlug?.get(o.channelSlug) ?? "",
        orders: [],
      };
    g.orders.push(o);
    map.set(o.channelSlug, g);
  }
  return Array.from(map.values()).sort((a, b) => b.orders.length - a.orders.length);
}

// Escape minimale per i valori dinamici (nomi prodotto, email) dentro l'HTML.
function esc(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

function timeRome(iso: string): string {
  return new Intl.DateTimeFormat("it-IT", {
    timeZone: "Europe/Rome",
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(iso));
}

function productRow(l: OrderLine): string {
  return `<tr><td style="padding:8px 24px 0;">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0"><tr>
      <td style="font-family:${FONT};font-size:14px;line-height:1.45;color:${TEAL};">
        ${esc(l.name)} <span style="color:${MUTED};">&times; ${l.quantity}</span><br>
        <span style="font-size:12px;color:${MUTED};">Cod. ${esc(l.sku || "—")}</span>
      </td>
      <td align="right" valign="top" style="font-family:${FONT};font-size:14px;color:${TEAL};white-space:nowrap;">${fmtEur.format(l.totalGross)}</td>
    </tr></table>
  </td></tr>`;
}

function orderCard(o: OrderSummary): string {
  return `<tr><td style="padding:14px 40px 0;">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background-color:#FFFFFF;border:1px solid #e3e9e8;border-radius:8px;">
      <tr><td style="padding:16px 24px 2px;font-family:${FONT};font-size:12px;font-weight:600;letter-spacing:1px;text-transform:uppercase;color:${MUTED};">
        Ordine #${esc(o.number)} &mdash; ${timeRome(o.created)}
      </td></tr>
      <tr><td style="padding:0 24px 4px;font-family:${FONT};font-size:13px;line-height:1.5;color:${TEAL};">
        <strong>Cliente:</strong> ${esc(o.userEmail || "—")}
      </td></tr>
      ${o.lines.map(productRow).join("")}
      <tr><td style="padding:12px 24px 16px;">
        <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="border-top:1px solid rgba(14,79,78,0.12);">
          <tr>
            <td style="padding-top:11px;font-family:${FONT};font-size:15px;font-weight:700;color:${TEAL};">Totale ordine</td>
            <td align="right" style="padding-top:11px;font-family:${FONT};font-size:15px;font-weight:700;color:${TEAL};">${fmtEur.format(o.totalGross)}</td>
          </tr>
        </table>
      </td></tr>
    </table>
  </td></tr>`;
}

function portalSection(g: PortalGroup): string {
  const sub = g.orders.reduce((s, o) => s + o.totalGross, 0);
  return `<tr><td style="padding:26px 40px 0;font-family:${FONT};">
      <div style="font-size:16px;font-weight:700;color:${TEAL};">${esc(g.name)}</div>
      <div style="font-size:13px;color:${MUTED};">${g.orders.length} ordini &middot; ${fmtEur.format(sub)}</div>
      ${g.agent ? `<div style="font-size:13px;color:${MUTED};">Agente: <span style="color:${TEAL};">${esc(g.agent)}</span></div>` : ""}
    </td></tr>${g.orders.map(orderCard).join("")}`;
}

function summaryBox(groups: PortalGroup[]): string {
  const orders = groups.reduce((s, g) => s + g.orders.length, 0);
  const total = groups.reduce(
    (s, g) => s + g.orders.reduce((t, o) => t + o.totalGross, 0),
    0,
  );
  const body =
    orders === 0
      ? `Nessun ordine ieri.`
      : `<strong>Ordini:</strong> ${orders} &nbsp;&middot;&nbsp; <strong>Portali:</strong> ${groups.length} &nbsp;&middot;&nbsp; <strong>Totale:</strong> ${fmtEur.format(total)}`;
  return `<tr><td style="padding:20px 40px 0;">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background-color:#F4F5F5;border-radius:8px;">
      <tr><td style="padding:18px 24px;font-family:${FONT};font-size:14px;line-height:1.7;color:${TEAL};">${body}</td></tr>
    </table>
  </td></tr>`;
}

export function renderOrdersHtml(groups: PortalGroup[], dateLabel: string): string {
  const orders = groups.reduce((s, g) => s + g.orders.length, 0);
  const preview =
    orders === 0
      ? `Nessun ordine ${dateLabel}`
      : `${orders} ordini ${dateLabel}, dettaglio per portale e prodotto`;
  return `<!DOCTYPE html>
<html lang="it">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Ordini Kyron &mdash; ${dateLabel}</title>
</head>
<body style="margin:0;padding:0;background-color:#F4F5F5;">
  <div style="display:none;font-size:1px;line-height:1px;max-height:0;max-width:0;opacity:0;overflow:hidden;mso-hide:all;">
    ${preview}&nbsp;&zwnj;&nbsp;&zwnj;&nbsp;&zwnj;
  </div>
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background-color:#F4F5F5;">
    <tr><td align="center" style="padding:32px 16px;">
      <table role="presentation" width="600" cellpadding="0" cellspacing="0" border="0" style="max-width:600px;width:100%;background-color:#FFFFFF;border-radius:12px;">
        <tr><td style="padding:36px 40px 8px;">
          <img src="cid:kyron-logo" alt="Kyron" width="110" style="display:block;width:110px;max-width:110px;height:auto;border:0;outline:none;">
        </td></tr>
        <tr><td style="padding:20px 40px 0;font-family:${FONT};font-size:24px;line-height:1.3;font-weight:700;color:${TEAL};">
          Ordini di ${dateLabel}
        </td></tr>
        <tr><td style="padding:8px 40px 0;font-family:${FONT};font-size:14px;line-height:1.6;color:${MUTED};">
          Ordini ricevuti il giorno prima sui portali Kyron (Saleor produzione).
        </td></tr>
        ${summaryBox(groups)}
        ${groups.map(portalSection).join("")}
        <tr><td style="padding:26px 40px 0;font-family:${FONT};font-size:13px;line-height:1.6;color:${MUTED};">
          Prezzi IVA inclusa. Gli ordini di test interni sono esclusi.
        </td></tr>
        <tr><td style="padding:24px 40px 36px;font-family:${FONT};font-size:13px;line-height:1.6;color:${MUTED};">
          &mdash; Il team Kyron<br>Report automatico di Studio, ogni giorno alle 09:30.
        </td></tr>
      </table>
    </td></tr>
  </table>
</body>
</html>`;
}
