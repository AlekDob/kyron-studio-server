import type { TenantConfig } from "@/config/tenants/index.js";

export interface PayloadClient {
  createPendingSchool: (payload: unknown) => Promise<{ id: string }>;
  checkSlugAvailability: (slug: string) => Promise<boolean>;
}

// Onboarding e' service-to-service: usa la Payload API Key del tenant
// (stesso pattern del BFF gateway in core/payload/gateway.ts). Il cookie
// del browser non e' utile qui perche' l'utente di Studio non e'
// necessariamente loggato in Payload — sono auth separate.
export function makePayloadClient(
  tenant: TenantConfig,
  _cookie: string,
): PayloadClient {
  const base = tenant.payloadApiUrl;
  if (!tenant.payloadApiKey) {
    throw new Error(
      "TENANT_KYRON_PAYLOAD_API_KEY missing — required for onboarding agent",
    );
  }
  const headers = {
    "Content-Type": "application/json",
    Authorization: `users API-Key ${tenant.payloadApiKey}`,
  };

  return {
    async createPendingSchool(payload) {
      const res = await fetch(`${base}/pending-schools`, {
        method: "POST",
        headers,
        body: JSON.stringify(payload),
      });
      if (!res.ok) {
        const body = await safeReadBody(res);
        console.error(
          `[payload] createPendingSchool ${res.status} ${base}/pending-schools`,
          body,
        );
        throw new Error(
          `payload createPendingSchool ${res.status}: ${truncate(body)}`,
        );
      }
      const data = (await res.json()) as { doc: { id: string } };
      return { id: data.doc.id };
    },
    async checkSlugAvailability(slug) {
      const url = `${base}/pending-schools?where[slug][equals]=${encodeURIComponent(slug)}&limit=1`;
      const res = await fetch(url, { headers });
      if (!res.ok) {
        const body = await safeReadBody(res);
        console.error(`[payload] checkSlug ${res.status} ${url}`, body);
        throw new Error(
          `payload checkSlug ${res.status}: ${truncate(body)}`,
        );
      }
      const data = (await res.json()) as { totalDocs: number };
      return data.totalDocs === 0;
    },
  };
}

async function safeReadBody(res: Response): Promise<string> {
  try {
    return await res.text();
  } catch {
    return "<no body>";
  }
}

function truncate(s: string, max = 200): string {
  return s.length > max ? `${s.slice(0, max)}…` : s;
}
