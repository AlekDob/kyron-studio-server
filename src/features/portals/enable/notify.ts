// Brain: mail transazionale "nuovo portale online" (skill kyron-email).
// Inviata a fine enable (Fase B) via Resend. Layout table-based brandizzato
// Kyron (#0E4F4E / #5C8682 / #F4F5F5, card 600px), logo Kyron come allegato
// inline CID (Apple Mail/Outlook bloccano le immagini remote) + logo scuola
// CID se presente su Payload. Best-effort: un fallimento qui non deve mai
// far fallire l'enable.
import { getPortal } from "../reader.js";
import type { EnableReport } from "./enable.js";

const FROM = "Kyron <web@kyronedu.it>";
const REPLY_TO = "info@kyronedu.it";
const KYRON_LOGO_URL = "https://kyronedu.it/kyron-logo.png";
const FONT = "Helvetica,Arial,sans-serif";

function recipients(): string[] {
  const raw = process.env.PORTAL_LIVE_NOTIFY_TO ?? "info@kyronedu.it,gmail@alekdob.com";
  return raw.split(",").map((s) => s.trim()).filter(Boolean);
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

interface InlineAttachment {
  filename: string;
  content: string; // base64
  content_id: string;
  content_type: string;
}

async function fetchInlineLogo(
  url: string,
  cid: string,
  filename: string,
): Promise<InlineAttachment | null> {
  try {
    const res = await fetch(url);
    if (!res.ok) return null;
    const buf = Buffer.from(await res.arrayBuffer());
    return {
      filename,
      content: buf.toString("base64"),
      content_id: cid,
      content_type: res.headers.get("content-type") ?? "image/png",
    };
  } catch {
    return null;
  }
}

function paragraph(text: string): string {
  return `<tr><td style="padding:16px 40px 0;font-family:${FONT};font-size:15px;line-height:1.6;color:#0E4F4E;">${text}</td></tr>`;
}

function infoRow(label: string, value: string): string {
  return `<tr><td style="padding:6px 24px 0;font-family:${FONT};font-size:14px;line-height:1.5;color:#0E4F4E;">${label} <span style="color:#5C8682;">${value}</span></td></tr>`;
}

// Card riepilogo: bundle, sconti, channel — i dati operativi del go-live.
function summaryBox(report: EnableReport, bundleLines: string[], discountLines: string[]): string {
  const rows = [
    ...bundleLines.map((l) => infoRow("Bundle:", l)),
    ...discountLines.map((l) => infoRow("Sconto:", l)),
    infoRow("Channel Saleor:", escapeHtml(report.targets[0]?.channelId ?? "-")),
    infoRow("Ambienti:", report.targets.map((t) => t.target).join(" + ")),
  ].join("");
  return `<tr><td style="padding:24px 40px 0;">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background-color:#F4F5F5;border-radius:8px;">
      <tr><td style="padding:18px 24px 4px;font-family:${FONT};font-size:12px;font-weight:600;letter-spacing:1px;text-transform:uppercase;color:#5C8682;">Riepilogo portale</td></tr>
      ${rows}
      <tr><td style="padding:0 24px 18px;"></td></tr>
    </table>
  </td></tr>`;
}

function cta(url: string, label: string): string {
  return `<tr><td style="padding:28px 40px 4px;">
    <table role="presentation" cellpadding="0" cellspacing="0" border="0">
      <tr><td style="background-color:#0E4F4E;border-radius:8px;">
        <a href="${url}" style="display:inline-block;padding:13px 24px;font-family:${FONT};font-size:15px;font-weight:600;color:#FFFFFF;text-decoration:none;">${label}</a>
      </td></tr>
    </table>
  </td></tr>`;
}

function schoolLogoBlock(hasLogo: boolean, nome: string): string {
  if (!hasLogo) return "";
  return `<tr><td style="padding:24px 40px 0;">
    <img src="cid:school-logo" alt="${escapeHtml(nome)}" width="72" style="display:block;width:72px;max-width:72px;height:auto;border:0;outline:none;">
  </td></tr>`;
}

function buildHtml(params: {
  nome: string;
  preview: string;
  portalUrl: string;
  hasSchoolLogo: boolean;
  report: EnableReport;
  bundleLines: string[];
  discountLines: string[];
  recalcWarning: boolean;
}): string {
  const blocks = [
    schoolLogoBlock(params.hasSchoolLogo, params.nome),
    `<tr><td style="padding:20px 40px 0;font-family:${FONT};font-size:24px;line-height:1.3;font-weight:700;color:#0E4F4E;">Il portale ${escapeHtml(params.nome)} &egrave; online</td></tr>`,
    paragraph(
      `Il portale &egrave; stato abilitato su Saleor ed &egrave; raggiungibile su <a href="${params.portalUrl}" style="color:#0E4F4E;font-weight:600;text-decoration:underline;">${params.portalUrl.replace("https://", "")}</a>.`,
    ),
    summaryBox(params.report, params.bundleLines, params.discountLines),
    params.recalcWarning
      ? paragraph(
          `<strong>Nota:</strong> gli sconti non risultano ancora applicati (recalc Saleor in coda). Se tra qualche minuto i prezzi scontati non compaiono, serve il recalc manuale.`,
        )
      : "",
    cta(params.portalUrl, "Apri il portale"),
    `<tr><td style="padding:28px 40px 0;font-family:${FONT};font-size:15px;line-height:1.6;color:#0E4F4E;">&mdash; Il team Kyron</td></tr>`,
  ].join("\n");

  return `<!DOCTYPE html>
<html lang="it">
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>Nuovo portale online</title></head>
<body style="margin:0;padding:0;background-color:#F4F5F5;">
  <div style="display:none;font-size:1px;line-height:1px;max-height:0;max-width:0;opacity:0;overflow:hidden;mso-hide:all;">${escapeHtml(params.preview)}&nbsp;&zwnj;&nbsp;&zwnj;&nbsp;&zwnj;</div>
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background-color:#F4F5F5;">
    <tr><td align="center" style="padding:32px 16px;">
      <table role="presentation" width="600" cellpadding="0" cellspacing="0" border="0" style="max-width:600px;width:100%;background-color:#FFFFFF;border-radius:12px;">
        <tr><td style="padding:36px 40px 8px;">
          <img src="cid:kyron-logo" alt="Kyron" width="110" style="display:block;width:110px;max-width:110px;height:auto;border:0;outline:none;">
        </td></tr>
        ${blocks}
        <tr><td style="padding:0 40px 36px;"></td></tr>
      </table>
      <table role="presentation" width="600" cellpadding="0" cellspacing="0" border="0" style="max-width:600px;width:100%;">
        <tr><td align="center" style="padding:24px 40px 8px;font-family:${FONT};font-size:12px;line-height:1.6;color:#5C8682;">
          Kyron &mdash; soluzioni digitali per la scuola<br>
          <a href="https://kyronedu.it" style="color:#5C8682;text-decoration:underline;">kyronedu.it</a> &nbsp;&middot;&nbsp;
          <a href="mailto:info@kyronedu.it" style="color:#5C8682;text-decoration:underline;">info@kyronedu.it</a><br>
          Hai ricevuto questa email perch&eacute; un nuovo portale scuola &egrave; stato pubblicato da Studio.
        </td></tr>
      </table>
    </td></tr>
  </table>
</body>
</html>`;
}

function buildText(nome: string, portalUrl: string, lines: string[]): string {
  return [
    `Il portale ${nome} è online`,
    "",
    `URL: ${portalUrl}`,
    ...lines,
    "",
    "— Il team Kyron",
  ].join("\n");
}

// Invia la mail "portale live". Ritorna true se inviata, false se saltata o
// fallita (mai throw: l'enable non deve fallire per la mail).
export async function notifyPortalLive(
  slug: string,
  report: EnableReport,
): Promise<boolean> {
  try {
    const portal = await getPortal(slug);
    if (!portal) return false;
    return await sendPortalLiveEmail(portal, report);
  } catch {
    return false;
  }
}

// Variante con portale gia' caricato: usata dal notify e dallo script di test
// (che costruisce il PortalDetail senza passare da Payload).
export async function sendPortalLiveEmail(
  portal: Pick<
    import("../reader.js").PortalDetail,
    "slug" | "nome" | "bundles" | "catalog" | "branding"
  >,
  report: EnableReport,
): Promise<boolean> {
  const apiKey = process.env.RESEND_API_KEY;
  if (!apiKey) return false;
  try {
    const slug = portal.slug;
    const portalUrl = `https://kyronedu.it/shop/${slug}`;
    const bundleLines = portal.bundles.map(
      (b) => `${escapeHtml(b.name)} &mdash; ${b.finalPriceEur} EUR`,
    );
    const discountLines = portal.catalog.productDiscounts.map((d) =>
      d.kind === "eur"
        ? `${escapeHtml(d.slug)}${d.capacity ? ` ${d.capacity}` : ""} &mdash; ${d.value} EUR finale`
        : `${escapeHtml(d.slug)}${d.capacity ? ` ${d.capacity}` : ""} &mdash; -${d.value}%`,
    );
    const attachments: InlineAttachment[] = [];
    const kyronLogo = await fetchInlineLogo(KYRON_LOGO_URL, "kyron-logo", "kyron-logo.png");
    if (kyronLogo) attachments.push(kyronLogo);
    const schoolLogo = portal.branding.logoUrl
      ? await fetchInlineLogo(portal.branding.logoUrl, "school-logo", `${slug}-logo.png`)
      : null;
    if (schoolLogo) attachments.push(schoolLogo);

    const recalcWarning = report.targets.some((t) => t.promotionsOnSale === false);
    const html = buildHtml({
      nome: portal.nome,
      preview: `Live su kyronedu.it/shop/${slug} con ${portal.bundles.length} bundle.`,
      portalUrl,
      hasSchoolLogo: Boolean(schoolLogo),
      report,
      bundleLines,
      discountLines,
      recalcWarning,
    });
    const res = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        from: FROM,
        to: recipients(),
        reply_to: REPLY_TO,
        subject: `Nuovo portale online: ${portal.nome}`,
        html,
        text: buildText(portal.nome, portalUrl, [
          ...portal.bundles.map((b) => `Bundle: ${b.name} — ${b.finalPriceEur} EUR`),
          `Channel: ${report.targets[0]?.channelId ?? "-"}`,
        ]),
        attachments,
      }),
    });
    return res.ok;
  } catch {
    return false;
  }
}
