import { kyronTenant } from "@/config/tenants/kyron.js";
import { uploadMedia } from "@/core/payload/media.js";
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

  const uploaded = await uploadMedia(
    kyronTenant,
    data,
    filename,
    mimeType,
    `Logo ${slug}`,
  );
  const mediaId = uploaded.id;

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
