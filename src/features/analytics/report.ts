// Report email giornaliero: l'overview di IERI renderizzata come HTML
// email-safe (tabelle, stili inline, palette Kyron) e inviata via Resend.
// Scheduler in-process: tick ogni 30s, invia al primo tick dopo le 09:00
// Europe/Rome (catch-up incluso se il container riparte entro le 09:59).

import { getOverview } from "./service.js";
import type { AnalyticsOverview, KpiTotals } from "./types.js";

const TEAL = "#0E4F4E";
const MUTED = "#5C8682";

function reportRecipients(): string[] {
  const raw =
    process.env.ANALYTICS_REPORT_TO ?? "info@kyronedu.it,gmail@alekdob.com";
  return raw.split(",").map((s) => s.trim()).filter(Boolean);
}

const fmtInt = new Intl.NumberFormat("it-IT");
const fmtEur = new Intl.NumberFormat("it-IT", {
  style: "currency",
  currency: "EUR",
  maximumFractionDigits: 0,
});

function deltaLabel(cur: number, prev: number): string {
  if (prev === 0) return cur === 0 ? "—" : "nuovo";
  const pct = Math.round(((cur - prev) / prev) * 100);
  const color = pct > 0 ? "#1a7f37" : pct < 0 ? "#b3261e" : MUTED;
  return `<span style="color:${color}">${pct > 0 ? "+" : ""}${pct}%</span>`;
}

const FONT = "Helvetica,Arial,sans-serif";

function kpiCell(label: string, value: string, delta: string): string {
  return `<td style="padding:10px 12px;border:1px solid #e3e9e8;border-radius:8px;font-family:${FONT}">
    <div style="font-size:11px;letter-spacing:.08em;text-transform:uppercase;color:${MUTED}">${label}</div>
    <div style="font-size:22px;font-weight:600;color:${TEAL}">${value} <span style="font-size:12px;font-weight:500">${delta}</span></div>
  </td>`;
}

function kpiTable(o: AnalyticsOverview): string {
  const k: KpiTotals = o.totals;
  const p = o.prev.totals;
  const cells = [
    kpiCell("Visitatori", fmtInt.format(k.visitors), deltaLabel(k.visitors, p.visitors)),
    kpiCell("Pageview", fmtInt.format(k.pageviews), deltaLabel(k.pageviews, p.pageviews)),
    kpiCell("Carrelli", fmtInt.format(k.addedToCart), deltaLabel(k.addedToCart, p.addedToCart)),
    kpiCell("Checkout", fmtInt.format(k.checkoutsStarted), deltaLabel(k.checkoutsStarted, p.checkoutsStarted)),
    kpiCell("Ordini", fmtInt.format(k.orders), deltaLabel(k.orders, p.orders)),
    kpiCell("Ricavi", fmtEur.format(k.revenueEur), deltaLabel(k.revenueEur, p.revenueEur)),
    kpiCell("Form compilati", fmtInt.format(o.leads.formSubmits), deltaLabel(o.leads.formSubmits, o.prev.leads.formSubmits)),
    kpiCell("Iscrizioni newsletter", fmtInt.format(o.leads.newsletterSubs), deltaLabel(o.leads.newsletterSubs, o.prev.leads.newsletterSubs)),
    kpiCell("Registrazioni shop", fmtInt.format(o.leads.registrations), deltaLabel(o.leads.registrations, o.prev.leads.registrations)),
  ];
  const rows: string[] = [];
  for (let i = 0; i < cells.length; i += 3) {
    rows.push(`<tr>${cells.slice(i, i + 3).join("")}</tr>`);
  }
  return `<table role="presentation" width="100%" cellspacing="6" cellpadding="0" style="border-collapse:separate">${rows.join("")}</table>`;
}

function listSection(title: string, rows: Array<[string, number]>): string {
  if (rows.length === 0) return "";
  const items = rows
    .map(
      ([label, value]) => `<tr>
        <td style="padding:6px 0;font-family:${FONT};font-size:14px;color:${TEAL};border-bottom:1px solid #eef2f1">${label}</td>
        <td align="right" style="padding:6px 0;font-family:${FONT};font-size:14px;font-weight:600;color:${TEAL};border-bottom:1px solid #eef2f1">${fmtInt.format(value)}</td>
      </tr>`,
    )
    .join("");
  return `<h3 style="margin:24px 0 6px;font-family:${FONT};font-size:15px;color:${TEAL}">${title}</h3>
    <table role="presentation" width="100%" cellspacing="0" cellpadding="0">${items}</table>`;
}

export function renderReportHtml(o: AnalyticsOverview, dateLabel: string): string {
  const pages = o.pages.slice(0, 5).map((p): [string, number] => [p.path, p.visitors]);
  const sources = o.sources.slice(0, 5).map((s): [string, number] => [
    s.source === "$direct" ? "Diretto" : s.source,
    s.visitors,
  ]);
  const cities = o.geo.slice(0, 5).map((g): [string, number] => [
    g.city ?? "Posizione non rilevata",
    g.visitors,
  ]);
  const tenants = o.tenants
    .filter((t) => t.visitors > 0)
    .slice(0, 6)
    .map((t): [string, number] => [t.label, t.visitors]);

  // Layout dal template ufficiale della skill kyron-email: canvas #F4F5F5,
  // card bianca 600px, logo header 110px, font Helvetica, stile tutto inline.
  const preview = `${fmtInt.format(o.totals.visitors)} visitatori, ${fmtInt.format(o.totals.pageviews)} pageview, ${fmtInt.format(o.totals.orders)} ordini`;
  return `<!DOCTYPE html>
<html lang="it">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Report Kyron &mdash; ${dateLabel}</title>
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
        <tr><td style="padding:20px 40px 0;font-family:Helvetica,Arial,sans-serif;font-size:24px;line-height:1.3;font-weight:700;color:${TEAL};">
          Report di ${dateLabel}
        </td></tr>
        <tr><td style="padding:8px 40px 0;font-family:Helvetica,Arial,sans-serif;font-size:14px;line-height:1.6;color:${MUTED};">
          Confronto col giorno precedente. Sito kyronedu.it + shop e portali scuola.
        </td></tr>
        <tr><td style="padding:20px 40px 4px;">${kpiTable(o)}</td></tr>
        <tr><td style="padding:0 40px 8px;font-family:Helvetica,Arial,sans-serif;">
          ${listSection("Pagine pi&ugrave; visitate", pages)}
          ${listSection("Fonti delle visite", sources)}
          ${listSection("Citt&agrave;", cities)}
          ${listSection("Origini", tenants)}
        </td></tr>
        <tr><td style="padding:28px 40px 4px;">
          <table role="presentation" cellpadding="0" cellspacing="0" border="0">
            <tr><td style="background-color:${TEAL};border-radius:8px;">
              <a href="https://studio.kyronedu.it/analytics?range=yesterday&app=all" style="display:inline-block;padding:13px 24px;font-family:Helvetica,Arial,sans-serif;font-size:15px;font-weight:600;color:#FFFFFF;text-decoration:none;">Apri in Studio</a>
            </td></tr>
          </table>
        </td></tr>
        <tr><td style="padding:24px 40px 36px;font-family:Helvetica,Arial,sans-serif;font-size:13px;line-height:1.6;color:${MUTED};">
          &mdash; Il team Kyron<br>Report automatico di Studio, ogni giorno alle 09:00.
        </td></tr>
      </table>
    </td></tr>
  </table>
</body>
</html>`;
}

// Logo come allegato INLINE (cid): i client che bloccano i contenuti remoti
// (Apple Mail privacy, Outlook) non caricano le immagini via URL — il cid
// viaggia dentro la mail e si vede sempre. Cache in memoria, fetch una volta.
let logoCache: string | null = null;

async function fetchLogoBase64(): Promise<string | null> {
  if (logoCache) return logoCache;
  try {
    const res = await fetch("https://kyronedu.it/kyron-logo.png");
    if (!res.ok) return null;
    logoCache = Buffer.from(await res.arrayBuffer()).toString("base64");
    return logoCache;
  } catch {
    return null;
  }
}

// Invio via Resend REST (dominio kyronedu.it verificato; pattern kyron-resend).
async function sendEmail(subject: string, html: string): Promise<void> {
  const apiKey = process.env.RESEND_API_KEY;
  if (!apiKey) throw new Error("RESEND_API_KEY missing");
  const logo = await fetchLogoBase64();
  const res = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    // Mittente standard transazionale Kyron (skill kyron-email/kyron-resend).
    body: JSON.stringify({
      from: "Kyron <web@kyronedu.it>",
      reply_to: "info@kyronedu.it",
      to: reportRecipients(),
      subject,
      // Se il logo non e' recuperabile, fallback all'URL remoto.
      html: logo
        ? html
        : html.replace("cid:kyron-logo", "https://kyronedu.it/kyron-logo.png"),
      attachments: logo
        ? [
            {
              filename: "kyron-logo.png",
              content: logo,
              content_id: "kyron-logo",
              content_type: "image/png",
            },
          ]
        : undefined,
    }),
  });
  if (!res.ok) {
    throw new Error(`resend send failed: ${res.status} ${await res.text()}`);
  }
}

function yesterdayLabelRome(): string {
  return new Intl.DateTimeFormat("it-IT", {
    timeZone: "Europe/Rome",
    weekday: "long",
    day: "numeric",
    month: "long",
  }).format(new Date(Date.now() - 86_400_000));
}

export async function sendDailyReport(): Promise<void> {
  const overview = await getOverview("yesterday");
  const label = yesterdayLabelRome();
  await sendEmail(`Report Kyron — ${label}`, renderReportHtml(overview, label));
}

// Data corrente (YYYY-MM-DD) e ora in Europe/Rome, DST-proof via Intl.
function romeNow(): { date: string; hour: number } {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Europe/Rome",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    hour12: false,
  }).formatToParts(new Date());
  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? "";
  return { date: `${get("year")}-${get("month")}-${get("day")}`, hour: Number(get("hour")) };
}

// Arma lo scheduler. Invia una volta al giorno al primo tick con ora 9
// (quindi anche in catch-up se il processo parte tra le 09:00 e le 09:59).
export function armDailyReport(): void {
  if (process.env.ANALYTICS_REPORT_ENABLED !== "true") return;
  let lastSentDate = "";
  setInterval(() => {
    const { date, hour } = romeNow();
    if (hour !== 9 || lastSentDate === date) return;
    lastSentDate = date;
    sendDailyReport().catch((err) => {
      console.error("daily report failed:", err);
      lastSentDate = ""; // ritenta al tick successivo (entro le 09:59)
    });
  }, 30_000);
  console.log("analytics daily report armed (09:00 Europe/Rome)");
}
