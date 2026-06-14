// Primitive email Kyron condivise dai report di Studio (analytics, ordini).
// Invio via Resend REST sul dominio verificato kyronedu.it. Il logo viaggia come
// allegato INLINE (cid:kyron-logo): i client che bloccano i contenuti remoti
// (Apple Mail privacy, Outlook) non caricano le immagini via URL, il cid si vede
// sempre. Brain: skill kyron-email, gotcha logo.

// Logo fetchato una volta sola e tenuto in cache in memoria per il processo.
let logoCache: string | null = null;

export async function fetchLogoBase64(): Promise<string | null> {
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

// Destinatari da una env CSV con fallback condiviso (es. ANALYTICS_REPORT_TO).
export function recipientsFromEnv(envVar: string, fallback: string): string[] {
  return (process.env[envVar] ?? fallback)
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
}

// Invia una mail transazionale Kyron. L'HTML deve gia' contenere
// <img src="cid:kyron-logo">; se il logo non e' recuperabile si fa fallback
// all'URL remoto. Mittente standard transazionale (skill kyron-email/kyron-resend).
export async function sendKyronEmail(
  subject: string,
  html: string,
  to: string[],
): Promise<void> {
  const apiKey = process.env.RESEND_API_KEY;
  if (!apiKey) throw new Error("RESEND_API_KEY missing");
  const logo = await fetchLogoBase64();
  const res = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      from: "Kyron <web@kyronedu.it>",
      reply_to: "info@kyronedu.it",
      to,
      subject,
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
