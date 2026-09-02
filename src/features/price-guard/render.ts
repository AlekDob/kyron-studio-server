// Render HTML email-safe del report Price Guard, RAGGRUPPATO PER TIPO di anomalia.
// Stessa palette/struttura dei report ordini/analytics (canvas #F4F5F5, card 600px,
// logo cid, tutto inline, font Helvetica). Solo lettura: mostra le anomalie trovate.
import type { Anomaly } from "./check.js";

const TEAL = "#0E4F4E";
const MUTED = "#5C8682";
const ALERT = "#B42318";
const LINE = "#e3e9e8";
const FONT = "Helvetica,Arial,sans-serif";
const fmtEur = new Intl.NumberFormat("it-IT", { style: "currency", currency: "EUR" });

// Etichette + spiegazione in una riga di cosa comporta il problema.
const LABELS: Record<string, { title: string; hint: string }> = {
  "kit-double-discount": {
    title: "Doppio sconto",
    hint: "Il cliente paga meno del prezzo mostrato sul portale.",
  },
  "kit-overcharge": {
    title: "Cliente paga di più",
    hint: "Al checkout il totale supera il prezzo mostrato sul portale.",
  },
  "voucher-missing": {
    title: "Voucher mancante",
    hint: "Il kit non ha lo sconto: il cliente pagherebbe la somma dei pezzi.",
  },
  "component-missing": {
    title: "Kit con codici prodotto sbagliati",
    hint: "Il codice scritto nel kit non corrisponde a nessun prodotto a catalogo: il prezzo del kit non è stato controllato.",
  },
  "discount-vanished": {
    title: "Sconto sparito su Saleor",
    hint: "Lo sconto configurato non risulta applicato: prezzo pieno a catalogo.",
  },
  "channel-orphan": {
    title: "Channel a rischio",
    hint: "Gli ordini Bonifico/Carta Docente potrebbero non essere creati.",
  },
  "stale-variant-buyable": {
    title: "Taglio nascosto acquistabile",
    hint: "Una variante fuori catalogo è ancora comprabile.",
  },
  "rule-error": {
    title: "Controllo non riuscito",
    hint: "Il controllo è fallito: verifica manualmente.",
  },
};

function esc(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

function dayRome(iso: string): string {
  return new Intl.DateTimeFormat("it-IT", {
    timeZone: "Europe/Rome",
    day: "2-digit",
    month: "2-digit",
  }).format(new Date(iso));
}

// Riga prezzi: mostrato -> reale, con lo scarto evidenziato. Niente ripetizioni
// del testo: i numeri stanno QUI, il detail resta discorsivo.
function priceLine(a: Anomaly): string {
  if (a.expected === undefined || a.shown === undefined) return "";
  const sign = (a.delta ?? 0) < 0 ? "−" : "+";
  const amount = fmtEur.format(Math.abs(a.delta ?? 0));
  return `<div style="margin-top:6px;font-family:${FONT};font-size:13px;color:${TEAL};">
      <span style="color:${MUTED};">mostrato</span> ${fmtEur.format(a.shown)}
      <span style="color:${MUTED};">&rarr; reale</span> <strong>${fmtEur.format(a.expected)}</strong>
      <span style="display:inline-block;margin-left:6px;padding:1px 7px;border-radius:10px;background-color:#FEF3F2;color:${ALERT};font-size:12px;font-weight:700;">${sign}${amount}</span>
    </div>`;
}

// Ordini realmente colpiti: numero + data + totale pagato.
function ordersLine(a: Anomaly): string {
  if (!a.orders) return "";
  if (a.orders.length === 0) {
    return `<div style="margin-top:5px;font-family:${FONT};font-size:12px;color:${MUTED};">
        Nessun ordine finora con questa configurazione.
      </div>`;
  }
  const items = a.orders
    .slice(0, 8)
    .map(
      (o) =>
        `<span style="display:inline-block;margin:2px 4px 0 0;padding:2px 8px;border:1px solid ${LINE};border-radius:10px;font-size:12px;color:${TEAL};">#${esc(o.number)} <span style="color:${MUTED};">${dayRome(o.created)} · ${fmtEur.format(o.totalGross)}</span></span>`,
    )
    .join("");
  const more =
    a.orders.length > 8
      ? `<span style="font-size:12px;color:${MUTED};"> +${a.orders.length - 8} altri</span>`
      : "";
  return `<div style="margin-top:6px;font-family:${FONT};">
      <div style="font-size:12px;color:${ALERT};font-weight:700;">${a.orders.length} ordini coinvolti</div>
      <div style="margin-top:2px;">${items}${more}</div>
    </div>`;
}

function anomalyCard(a: Anomaly): string {
  return `<tr><td style="padding:10px 40px 0;">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background-color:#FFFFFF;border:1px solid ${LINE};border-radius:8px;">
      <tr><td style="padding:14px 18px;">
        <div style="font-family:${FONT};font-size:15px;font-weight:700;color:${TEAL};">
          ${esc(a.portalName || a.portal)}${a.kit ? `<span style="font-weight:400;color:${MUTED};"> &middot; ${esc(a.kit)}</span>` : ""}
        </div>
        <div style="margin-top:3px;font-family:${FONT};font-size:13px;line-height:1.5;color:${MUTED};">${esc(a.detail)}</div>
        ${priceLine(a)}
        ${ordersLine(a)}
      </td></tr>
    </table>
  </td></tr>`;
}

function typeSection(type: string, items: Anomaly[]): string {
  const meta = LABELS[type] ?? { title: type, hint: "" };
  return `<tr><td style="padding:26px 40px 0;font-family:${FONT};">
      <div style="font-size:11px;font-weight:700;letter-spacing:1px;text-transform:uppercase;color:${ALERT};">
        ${esc(meta.title)} &middot; ${items.length}
      </div>
      ${meta.hint ? `<div style="margin-top:2px;font-size:13px;color:${MUTED};">${esc(meta.hint)}</div>` : ""}
    </td></tr>${items.map(anomalyCard).join("")}`;
}

// Riquadro riepilogo in testa: portali toccati, ordini coinvolti, esposizione €.
function summaryBox(anomalies: Anomaly[]): string {
  const portals = new Set(anomalies.map((a) => a.portal)).size;
  const orders = anomalies.reduce((s, a) => s + (a.orders?.length ?? 0), 0);
  const exposure = anomalies.reduce(
    (s, a) => s + Math.abs(a.delta ?? 0) * (a.orders?.length ?? 0),
    0,
  );
  const parts = [
    `<strong>Anomalie:</strong> ${anomalies.length}`,
    `<strong>Portali:</strong> ${portals}`,
    `<strong>Ordini coinvolti:</strong> ${orders}`,
  ];
  if (exposure > 0) parts.push(`<strong>Scarto totale:</strong> ${fmtEur.format(exposure)}`);
  return `<tr><td style="padding:20px 40px 0;">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background-color:#F4F5F5;border-radius:8px;">
      <tr><td style="padding:16px 20px;font-family:${FONT};font-size:14px;line-height:1.8;color:${TEAL};">
        ${parts.join(" &nbsp;&middot;&nbsp; ")}
      </td></tr>
    </table>
  </td></tr>`;
}

export function renderPriceGuardHtml(anomalies: Anomaly[], dateLabel: string): string {
  const byType = new Map<string, Anomaly[]>();
  for (const a of anomalies) byType.set(a.type, [...(byType.get(a.type) ?? []), a]);
  const sections = Array.from(byType.entries())
    .map(([t, items]) => typeSection(t, items))
    .join("");
  const preview = `${anomalies.length} anomalie su prezzi e sconti dei portali`;
  return `<!DOCTYPE html>
<html lang="it">
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>Controllo prezzi &mdash; ${dateLabel}</title></head>
<body style="margin:0;padding:0;background-color:#F4F5F5;">
  <div style="display:none;font-size:1px;line-height:1px;max-height:0;max-width:0;opacity:0;overflow:hidden;mso-hide:all;">${preview}&nbsp;&zwnj;&nbsp;&zwnj;</div>
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background-color:#F4F5F5;">
    <tr><td align="center" style="padding:32px 16px;">
      <table role="presentation" width="600" cellpadding="0" cellspacing="0" border="0" style="max-width:600px;width:100%;background-color:#FFFFFF;border-radius:12px;">
        <tr><td style="padding:36px 40px 8px;">
          <img src="cid:kyron-logo" alt="Kyron" width="110" style="display:block;width:110px;max-width:110px;height:auto;border:0;outline:none;">
        </td></tr>
        <tr><td style="padding:20px 40px 0;font-family:${FONT};font-size:24px;line-height:1.3;font-weight:700;color:${TEAL};">
          Controllo prezzi
        </td></tr>
        <tr><td style="padding:6px 40px 0;font-family:${FONT};font-size:14px;line-height:1.6;color:${MUTED};">
          ${esc(dateLabel)} &middot; portali su Saleor produzione. Controllo automatico in sola lettura.
        </td></tr>
        ${summaryBox(anomalies)}
        ${sections}
        <tr><td style="padding:28px 40px 0;font-family:${FONT};font-size:13px;line-height:1.6;color:${MUTED};">
          Le anomalie riguardano la configurazione <strong>attuale</strong> dei portali; gli ordini elencati sono quelli <strong>del giorno prima</strong> che l'hanno gia' incontrata. Le correzioni non sono automatiche: vanno applicate a mano.
        </td></tr>
        <tr><td style="padding:16px 40px 36px;font-family:${FONT};font-size:13px;line-height:1.6;color:${MUTED};">
          &mdash; Il team Kyron<br>Price Guard di Studio. Ricevi questa mail solo quando ci sono anomalie.
        </td></tr>
      </table>
    </td></tr>
  </table>
</body>
</html>`;
}
