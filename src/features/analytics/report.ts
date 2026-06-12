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

function kpiCell(label: string, value: string, delta: string): string {
  return `<td style="padding:10px 12px;border:1px solid #e3e9e8;border-radius:8px">
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
        <td style="padding:6px 0;font-size:14px;color:#1f2a29;border-bottom:1px solid #eef2f1">${label}</td>
        <td align="right" style="padding:6px 0;font-size:14px;font-weight:600;color:${TEAL};border-bottom:1px solid #eef2f1">${fmtInt.format(value)}</td>
      </tr>`,
    )
    .join("");
  return `<h3 style="margin:24px 0 6px;font-size:15px;color:${TEAL}">${title}</h3>
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

  return `<!doctype html><html lang="it"><body style="margin:0;background:#f4f5f5;font-family:-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif">
  <table role="presentation" width="100%" cellspacing="0" cellpadding="0"><tr><td align="center" style="padding:24px 12px">
    <table role="presentation" width="600" cellspacing="0" cellpadding="0" style="max-width:600px;width:100%;background:#ffffff;border-radius:12px;padding:8px">
      <tr><td style="padding:24px 28px 8px">
        <div style="font-size:12px;letter-spacing:.12em;text-transform:uppercase;color:${MUTED}">kyron &middot; report giornaliero</div>
        <h1 style="margin:6px 0 0;font-size:22px;color:${TEAL}">Analytics di ${dateLabel}</h1>
        <p style="margin:6px 0 0;font-size:13px;color:${MUTED}">Confronto con il giorno precedente. Sito kyronedu.it + shop e portali scuola.</p>
      </td></tr>
      <tr><td style="padding:16px 28px 4px">${kpiTable(o)}</td></tr>
      <tr><td style="padding:0 28px 8px">
        ${listSection("Pagine piu' visitate", pages)}
        ${listSection("Fonti delle visite", sources)}
        ${listSection("Citta'", cities)}
        ${listSection("Origini", tenants)}
      </td></tr>
      <tr><td style="padding:16px 28px 24px">
        <a href="https://studio.kyronedu.it/analytics?range=yesterday&app=all" style="display:inline-block;background:${TEAL};color:#ffffff;text-decoration:none;font-size:14px;font-weight:600;padding:10px 20px;border-radius:999px">Apri in Studio</a>
        <p style="margin:16px 0 0;font-size:12px;color:${MUTED}">— Studio Kyron, report automatico delle 09:00</p>
      </td></tr>
    </table>
  </td></tr></table></body></html>`;
}

// Invio via Resend REST (dominio kyronedu.it verificato; pattern kyron-resend).
async function sendEmail(subject: string, html: string): Promise<void> {
  const apiKey = process.env.RESEND_API_KEY;
  if (!apiKey) throw new Error("RESEND_API_KEY missing");
  const res = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      from: "Studio Kyron <studio@kyronedu.it>",
      to: reportRecipients(),
      subject,
      html,
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
