import { describe, expect, it, vi, beforeEach } from "vitest";

// Mock delle letture Saleor: testiamo la matematica di riconciliazione del kit
// (il pezzo critico sui soldi) senza rete. resolveVariant torna il prezzo
// SCONTATO per componente; readVoucherDiscount il valore del voucher.
const state: { prices: Record<string, number>; voucher: number | null } = {
  prices: {},
  voucher: null,
};

vi.mock("@/features/price-guard/reads.js", () => ({
  fetchProduct: vi.fn(async () => ({ id: "p", slug: "s", variants: [] })),
  // null = variante non risolta (SKU errato o prodotto assente sul channel).
  resolveVariant: (_p: unknown, comp: { productSlug: string }) =>
    comp.productSlug in state.prices
      ? { priceAmount: state.prices[comp.productSlug] }
      : null,
  readVoucherDiscount: vi.fn(async () => state.voucher),
  readChannelSettings: vi.fn(async () => ({ isActive: true, allowUnpaid: true })),
}));

import { RULES, type Rule } from "@/features/price-guard/rules.js";
import type { PortalContext } from "@/features/price-guard/check.js";

const kitRule = RULES.find((r: Rule) => r.id === "kit-reconciliation")!;

// Contesto minimo: un kit con 2 componenti, prezzo mostrato 100.
function ctx(finalPriceEur: number): PortalContext {
  return {
    target: "prod",
    channel: "demo",
    portal: {
      slug: "demo",
      nome: "Scuola Demo",
      catalog: { productDiscounts: [], visibleVariants: [] },
    } as unknown as PortalContext["portal"],
    config: {
      slug: "demo",
      bundles: [
        {
          slug: "kit-uno",
          name: "Kit Uno",
          finalPriceEur,
          components: [
            { productSlug: "ipad", selection: { kind: "fixed", variantSku: "A" } },
            { productSlug: "cover", selection: { kind: "fixed", variantSku: "B" } },
          ],
        },
      ],
    } as unknown as PortalContext["config"],
    cache: new Map(),
  };
}

describe("kit-reconciliation", () => {
  beforeEach(() => {
    state.prices = { ipad: 90, cover: 30 }; // somma scontata = 120
  });

  it("segnala doppio sconto quando (scontati - voucher) < prezzo mostrato", async () => {
    state.voucher = 30; // 120 - 30 = 90 reale, mostrato 100 -> cliente paga meno
    const out = await kitRule.run(ctx(100));
    expect(out).toHaveLength(1);
    expect(out[0].type).toBe("kit-double-discount");
    expect(out[0].expected).toBe(90);
    expect(out[0].delta).toBe(-10);
  });

  it("segnala overcharge quando (scontati - voucher) > prezzo mostrato", async () => {
    state.voucher = 10; // 120 - 10 = 110 reale, mostrato 100 -> paga di piu'
    const out = await kitRule.run(ctx(100));
    expect(out).toHaveLength(1);
    expect(out[0].type).toBe("kit-overcharge");
    expect(out[0].delta).toBe(10);
  });

  it("nessuna anomalia quando i conti tornano (entro tolleranza)", async () => {
    state.voucher = 20; // 120 - 20 = 100 = mostrato
    const out = await kitRule.run(ctx(100));
    expect(out).toHaveLength(0);
  });

  it("segnala voucher mancante", async () => {
    state.voucher = null;
    const out = await kitRule.run(ctx(100));
    expect(out).toHaveLength(1);
    expect(out[0].type).toBe("voucher-missing");
  });

  // Regressione (giro a secco prod 2026-07-27): con un componente non risolto la
  // somma e' incompleta e riconciliare produceva scarti inventati ("scontati 0€").
  it("con componente non risolto segnala solo component-missing, senza riconciliare", async () => {
    state.prices = { ipad: 90 }; // 'cover' non risolve -> priceAmount 0
    state.voucher = 30;
    const out = await kitRule.run(ctx(100));
    expect(out).toHaveLength(1);
    expect(out[0].type).toBe("component-missing");
    expect(out.some((a) => a.type.startsWith("kit-"))).toBe(false);
  });
});
