import { kyronTenant } from "@/config/tenants/kyron.js";
import { getPortalsGateway, PORTALS_COLLECTION } from "./gateway.js";
import { findPortalDoc } from "./reader.js";

// Brain: decision-016 — logo upload via Payload Media collection invece di
// filesystem /data/portals/logos. Carichiamo il file su /api/media (multipart),
// otteniamo l'ID Media, poi se il PendingSchool esiste gia' patchiamo
// branding.logo = mediaId. Se non esiste ancora (caso onboarding pre-save)
// il Media e' orfano fino al save_pending_school successivo — caller
// (LogoUploader) puo' tenere mediaId in stato e passarlo al save.

interface SaveLogoResult {
  ok: boolean;
  filename: string;
  mediaId: string;
  linkedToPortal: boolean;
}

export async function savePortalLogo(
  slug: string,
  data: Buffer,
  ext: string,
): Promise<SaveLogoResult> {
  const filename = `logo-${slug}.${ext}`;
  const mimeType =
    ext === "png" ? "image/png" : ext === "webp" ? "image/webp" : "image/jpeg";

  const form = new FormData();
  // Brain: Payload upload via REST accetta multipart con `file` blob +
  // JSON-encoded `_payload` per i campi extra (es. alt). Vedi
  // https://payloadcms.com/docs/rest-api/overview#uploads
  form.append("file", new Blob([data], { type: mimeType }), filename);
  form.append(
    "_payload",
    JSON.stringify({ alt: `Logo ${slug}` }),
  );

  const apiKey = kyronTenant.payloadApiKey;
  if (!apiKey) throw new Error("payloadApiKey missing");

  const res = await fetch(`${kyronTenant.payloadApiUrl}/media`, {
    method: "POST",
    headers: { Authorization: `users API-Key ${apiKey}` },
    body: form,
  });
  if (!res.ok) {
    const err = await res.text();
    throw new Error(`media upload failed: ${res.status} ${err}`);
  }
  const body = (await res.json()) as { doc: { id: string | number } };
  const mediaId = String(body.doc.id);

  // Se il PendingSchool esiste, linka il media. Altrimenti il logo resta
  // standalone in Media e verra' linkato quando l'agente salvera' il portale.
  let linkedToPortal = false;
  const portalDoc = await findPortalDoc(slug);
  if (portalDoc) {
    const gw = getPortalsGateway();
    const currentBranding =
      (portalDoc.branding as Record<string, unknown>) ?? {};
    await gw.update(PORTALS_COLLECTION, String(portalDoc.id), {
      branding: { ...currentBranding, logo: mediaId },
    });
    linkedToPortal = true;
  }

  return { ok: true, filename, mediaId, linkedToPortal };
}
