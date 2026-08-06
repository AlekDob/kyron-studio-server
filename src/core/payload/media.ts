import type { TenantConfig } from "@/config/tenants/index.js";

// Brain: decision-016 — upload su Payload via REST multipart: il blob va in
// `file`, i campi extra (alt) in `_payload` JSON-encoded. NIENTE Content-Type
// a mano: lo imposta fetch col boundary del FormData.
// https://payloadcms.com/docs/rest-api/overview#uploads

export interface UploadedMedia {
  id: string;
  filename: string;
  url: string;
}

export async function uploadMedia(
  tenant: TenantConfig,
  data: Buffer,
  filename: string,
  mimeType: string,
  alt: string,
): Promise<UploadedMedia> {
  const apiKey = tenant.payloadApiKey;
  if (!apiKey) throw new Error("payloadApiKey missing");

  const form = new FormData();
  form.append("file", new Blob([data], { type: mimeType }), filename);
  form.append("_payload", JSON.stringify({ alt }));

  const res = await fetch(`${tenant.payloadApiUrl}/media`, {
    method: "POST",
    headers: { Authorization: `users API-Key ${apiKey}` },
    body: form,
  });
  if (!res.ok) {
    const err = await res.text();
    throw new Error(`media upload failed: ${res.status} ${err}`);
  }

  const body = (await res.json()) as {
    doc: { id: string | number; filename?: string; url?: string };
  };
  return {
    id: String(body.doc.id),
    // Payload puo' rinominare il file (incrementa il numero finale se il nome
    // esiste gia'): tornare il filename REALE evita sorprese lato UI.
    filename: body.doc.filename ?? filename,
    url: body.doc.url ?? "",
  };
}
