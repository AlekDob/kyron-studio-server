import { describe, expect, it } from "vitest";
import {
  buildPricePlan,
  detectDrift,
  type BuildPlanInput,
} from "@/features/commesso/price-plan.js";

const variant = (sku: string, slug: string, price: number | null) => ({
  sku,
  variantId: `V_${sku}`,
  productSlug: slug,
  priceEur: price,
});

function plan(over: Partial<BuildPlanInput> = {}) {
  return buildPricePlan({
    channelSlug: "default-channel",
    requests: [{ sku: "MX1", newPriceEur: 810 }],
    current: [variant("MX1", "ipada16", 799)],
    bundleUses: [],
    ...over,
  });
}

describe("buildPricePlan", () => {
  it("calcola delta assoluto e percentuale", () => {
    const p = plan();
    expect(p.errors).toEqual([]);
    expect(p.lines[0].deltaEur).toBe(11);
    expect(p.lines[0].deltaPct).toBe(1.38);
  });

  it("avvisa oltre il 30% ma non blocca", () => {
    const p = plan({ requests: [{ sku: "MX1", newPriceEur: 7990 }] });
    expect(p.errors).toEqual([]);
    expect(p.warnings.join()).toMatch(/zero di troppo/);
  });

  it("rifiuta uno SKU sconosciuto", () => {
    const p = plan({ requests: [{ sku: "BOH", newPriceEur: 100 }] });
    expect(p.lines).toHaveLength(0);
    expect(p.errors.join()).toMatch(/non trovato/);
  });

  it("rifiuta un prezzo non valido", () => {
    expect(plan({ requests: [{ sku: "MX1", newPriceEur: 0 }] }).errors).toHaveLength(1);
    expect(plan({ requests: [{ sku: "MX1", newPriceEur: 79.999 }] }).errors).toHaveLength(1);
  });

  it("scarta il no-op senza errore", () => {
    const p = plan({ requests: [{ sku: "MX1", newPriceEur: 799 }] });
    expect(p.lines).toHaveLength(0);
    expect(p.errors).toEqual([]);
    expect(p.warnings.join()).toMatch(/gia' a 799/);
  });

  // R1: il caso che e' costato ~734 EUR su 25 ordini.
  it("blocca il componente di un kit se il piano non ricalcola il voucher", () => {
    const bundleUses = [
      {
        productSlug: "ipada16",
        portalSlug: "massari",
        bundleSlug: "kit2",
        voucherCode: "KITMASSARI-K2",
        currentVoucherEur: 60,
      },
    ];
    const blocked = plan({ bundleUses });
    expect(blocked.errors.join()).toMatch(/componente del kit/);

    const ok = plan({
      bundleUses,
      voucherUpdates: [{ voucherCode: "KITMASSARI-K2", newDiscountEur: 71 }],
    });
    expect(ok.errors).toEqual([]);
    expect(ok.voucherLines[0]).toMatchObject({ fromEur: 60, newDiscountEur: 71 });
  });
});

describe("detectDrift", () => {
  it("nessuna scrittura se il prezzo si e' mosso sotto il piano", () => {
    const p = plan();
    expect(detectDrift(p, [{ sku: "MX1", priceEur: 799 }])).toEqual([]);
    expect(detectDrift(p, [{ sku: "MX1", priceEur: 759 }])).toHaveLength(1);
    expect(detectDrift(p, [])).toHaveLength(1);
  });
});
