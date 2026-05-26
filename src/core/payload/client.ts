import type { TenantConfig } from "@/config/tenants/index.js";

export interface PayloadClient {
  createPendingSchool: (payload: unknown) => Promise<{ id: string }>;
  checkSlugAvailability: (slug: string) => Promise<boolean>;
}

export function makePayloadClient(
  tenant: TenantConfig,
  cookie: string,
): PayloadClient {
  const base = tenant.payloadApiUrl;
  const headers = {
    "Content-Type": "application/json",
    Cookie: cookie,
  };

  return {
    async createPendingSchool(payload) {
      const res = await fetch(`${base}/pending-schools`, {
        method: "POST",
        headers,
        body: JSON.stringify(payload),
      });
      if (!res.ok) {
        throw new Error(`payload createPendingSchool ${res.status}`);
      }
      const data = (await res.json()) as { doc: { id: string } };
      return { id: data.doc.id };
    },
    async checkSlugAvailability(slug) {
      const url = `${base}/pending-schools?where[slug][equals]=${encodeURIComponent(slug)}&limit=1`;
      const res = await fetch(url, { headers });
      if (!res.ok) {
        throw new Error(`payload checkSlug ${res.status}`);
      }
      const data = (await res.json()) as { totalDocs: number };
      return data.totalDocs === 0;
    },
  };
}
