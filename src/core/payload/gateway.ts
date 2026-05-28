import type { TenantConfig } from "@/config/tenants/index.js";

export interface PayloadListResponse {
  data: Record<string, unknown>[];
  meta: {
    total: number;
    page: number;
    limit: number;
    totalPages: number;
  };
}

export interface PayloadDocResponse {
  data: Record<string, unknown>;
}

interface ListParams {
  page?: number;
  limit?: number;
  sort?: string;
  locale?: string;
  depth?: number;
  q?: string;
  where?: Record<string, unknown>;
}

function buildAuthHeaders(apiKey: string): Record<string, string> {
  return {
    "Content-Type": "application/json",
    Authorization: `users API-Key ${apiKey}`,
  };
}

const SEARCH_FIELDS: Record<string, string[]> = {
  bandi: ["titolo", "slug"],
  eventi: ["titolo", "slug"],
  products: ["name", "slug"],
  brands: ["name", "slug"],
  "product-categories": ["name", "slug"],
  media: ["filename", "alt"],
  "contact-submissions": ["email", "name"],
  "product-request-submissions": ["email", "name"],
};

function buildListUrl(base: string, slug: string, p: ListParams): string {
  const url = new URL(`${base}/${slug}`);
  if (p.page) url.searchParams.set("page", String(p.page));
  url.searchParams.set("limit", String(p.limit ?? 50));
  if (p.sort) url.searchParams.set("sort", p.sort);
  url.searchParams.set("locale", p.locale ?? "it");
  url.searchParams.set("depth", String(p.depth ?? 1));
  if (p.q) {
    const fields = SEARCH_FIELDS[slug] ?? ["slug"];
    fields.forEach((field, i) => {
      url.searchParams.set(`where[or][${i}][${field}][contains]`, p.q!);
    });
  }
  if (p.where) {
    for (const [field, ops] of Object.entries(p.where)) {
      if (!ops || typeof ops !== "object") continue;
      for (const [op, value] of Object.entries(ops as Record<string, unknown>)) {
        url.searchParams.set(`where[${field}][${op}]`, String(value));
      }
    }
  }
  return url.toString();
}

export function makePayloadGateway(tenant: TenantConfig) {
  const base = tenant.payloadApiUrl;
  const apiKey = tenant.payloadApiKey;
  if (!apiKey) throw new Error("payloadApiKey missing for tenant");
  const headers = buildAuthHeaders(apiKey);

  return {
    async list(
      slug: string,
      params: ListParams = {},
    ): Promise<PayloadListResponse> {
      const url = buildListUrl(base, slug, params);
      const res = await fetch(url, { headers });
      if (!res.ok) throw new Error(`payload list ${slug}: ${res.status}`);
      const body = (await res.json()) as {
        docs: Record<string, unknown>[];
        totalDocs: number;
        page: number;
        totalPages: number;
      };
      return {
        data: body.docs,
        meta: {
          total: body.totalDocs,
          page: body.page,
          limit: params.limit ?? 50,
          totalPages: body.totalPages,
        },
      };
    },

    async get(
      slug: string,
      id: string,
      locale?: string,
    ): Promise<PayloadDocResponse> {
      const url = `${base}/${slug}/${id}?depth=1&locale=${locale ?? "all"}`;
      const res = await fetch(url, { headers });
      if (!res.ok) throw new Error(`payload get ${slug}/${id}: ${res.status}`);
      const doc = (await res.json()) as Record<string, unknown>;
      return { data: doc };
    },

    async create(
      slug: string,
      data: Record<string, unknown>,
    ): Promise<PayloadDocResponse> {
      const res = await fetch(`${base}/${slug}`, {
        method: "POST",
        headers,
        body: JSON.stringify(data),
      });
      if (!res.ok) {
        const err = await res.text();
        throw new Error(`payload create ${slug}: ${res.status} ${err}`);
      }
      const body = (await res.json()) as { doc: Record<string, unknown> };
      return { data: body.doc };
    },

    async update(
      slug: string,
      id: string,
      data: Record<string, unknown>,
    ): Promise<PayloadDocResponse> {
      const res = await fetch(`${base}/${slug}/${id}`, {
        method: "PATCH",
        headers,
        body: JSON.stringify(data),
      });
      if (!res.ok) {
        const err = await res.text();
        throw new Error(`payload update ${slug}/${id}: ${res.status} ${err}`);
      }
      const body = (await res.json()) as { doc: Record<string, unknown> };
      return { data: body.doc };
    },

    async remove(slug: string, id: string): Promise<{ id: string }> {
      const res = await fetch(`${base}/${slug}/${id}`, {
        method: "DELETE",
        headers,
      });
      if (!res.ok) throw new Error(`payload delete ${slug}/${id}: ${res.status}`);
      return { id };
    },

    async count(slug: string): Promise<number> {
      const url = `${base}/${slug}?limit=0`;
      const res = await fetch(url, { headers });
      if (!res.ok) return 0;
      const body = (await res.json()) as { totalDocs: number };
      return body.totalDocs;
    },
  };
}

export type PayloadGateway = ReturnType<typeof makePayloadGateway>;
