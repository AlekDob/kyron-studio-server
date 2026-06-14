// Report email giornaliero analytics: l'overview di IERI come HTML email-safe
// (palette Kyron, stili inline) inviata via Resend alle 09:00 Europe/Rome.
// Invio + logo cid + scheduler sono condivisi (core/email, core/scheduler).

import { getOverview } from "./service.js";
import type { AnalyticsOverview, KpiTotals } from "./types.js";
import { sendKyronEmail, recipientsFromEnv } from "@/core/email/mailer.js";
import { armDailyJob, romeYesterday } from "@/core/scheduler.js";

const TEAL = "#0E4F4E";
const MUTED = "#5C8682";
const ANALYTICS_REPORT_TO = "team@kyronedu.it,gmail@alekdob.com";

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

export async function sendDailyReport(): Promise<void> {
  const overview = await getOverview("yesterday");
  const label = romeYesterday().label;
  await sendKyronEmail(
    `Report Kyron — ${label}`,
    renderReportHtml(overview, label),
    recipientsFromEnv("ANALYTICS_REPORT_TO", ANALYTICS_REPORT_TO),
  );
}

// Opt-in via ANALYTICS_REPORT_ENABLED. Armato in index.ts.
export function armDailyReport(): void {
  armDailyJob({
    enabled: process.env.ANALYTICS_REPORT_ENABLED === "true",
    hour: 9,
    minute: 0,
    label: "analytics daily report",
    run: sendDailyReport,
  });
}
