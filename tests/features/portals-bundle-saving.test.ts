import { describe, expect, it, vi } from "vitest";

// Il voucher del kit e' un money-path: si calcola sulla somma dei prezzi
// SCONTATI del channel scuola. Con default-channel (bug 2026-08-27) il cliente
// paga piu' del prezzo mostrato. Mock della sola chiamata Saleor.
const PRICES: Record<string, Record<string, number>> = {
  "default-channel": { ipada16: 549, cover: 29, pencil: 49, charger: 25 },
  colombo: { ipada16: 509, cover: 29, pencil: 49, charger: 25 }, // 612 sul portale
};

vi.mock("@/features/portals/enable/saleor-admin.js", () => ({
  saleorUrlFor: () => "http://localhost/graphql/",
  adminRequest: vi.fn(async (_t: string, _q: string, vars: Record<string, string>) => {
    const price = PRICES[vars.channel]?.[vars.slug];
    if (price === undefined) return { product: null };
    return {
      product: {
        id: `P-${vars.slug}`,
        slug: vars.slug,
        variants: [
          {
            id: `V-${vars.slug}`,
            sku: vars.slug.toUpperCase(),
            attributes: [],
            pricing: { price: { gross: { amount: price } }, priceUndiscounted: null },
          },
        ],
      },
    };
  }),
}));

import { resolveBundleSaving, type ProductRef } from "@/features/portals/enable/seed-steps.js";

const bundle = {
  slug: "kit-ipad-a16-128gb",
  name: "Kit iPad",
  finalPriceEur: 549,
  components: ["ipada16", "cover", "pencil", "charger"].map((s) => ({
    productSlug: s,
    selection: { kind: "by-sku" as const, variantSku: s.toUpperCase() },
  })),
};

describe("resolveBundleSaving", () => {
  it("sconta sui prezzi del channel scuola (612 - 549 = 63)", async () => {
    const saving = await resolveBundleSaving(
      "prod",
      bundle as never,
      new Map<string, ProductRef>(),
      "colombo",
    );
    expect(saving).toBe(63);
  });

  it("cache separata per channel: default-channel non inquina il channel scuola", async () => {
    const cache = new Map<string, ProductRef>();
    await resolveBundleSaving("prod", bundle as never, cache, "default-channel"); // 652 - 549
    const saving = await resolveBundleSaving("prod", bundle as never, cache, "colombo");
    expect(saving).toBe(63);
  });

  it("fallisce se un componente non ha prezzo sul channel", async () => {
    await expect(
      resolveBundleSaving("prod", bundle as never, new Map<string, ProductRef>(), "bettolo"),
    ).rejects.toThrow(/non trovato su bettolo/);
  });
});
