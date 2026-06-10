import { describe, expect, it } from "vitest";
import { buildTenants } from "@/features/analytics/service.js";

// Row shape Query A: [app, school_slug, pageviews, visitors, added_to_cart,
// checkouts_started, orders, revenue]
function row(
  app: string,
  slug: string,
  visitors: number,
  orders = 0,
  revenue = 0,
): unknown[] {
  return [app, slug, visitors * 3, visitors, 0, 0, orders, revenue];
}

describe("buildTenants (join dinamico PostHog <-> portali)", () => {
  it("collassa le righe cms e le etichetta come sito", () => {
    const tenants = buildTenants(
      [row("cms", "", 10), row("cms", "stray-slug", 5)],
      new Map(),
    );
    expect(tenants[0]).toMatchObject({
      key: "cms",
      app: "cms",
      slug: null,
      label: "Sito kyronedu.it",
      visitors: 15,
      known: true,
    });
  });

  it("etichetta demo come Shop principale e lo pinna in testa agli shop", () => {
    const tenants = buildTenants(
      [row("storefront", "big-school", 100, 5, 5000), row("storefront", "demo", 2)],
      new Map([["big-school", "Big School"]]),
    );
    const shops = tenants.filter((t) => t.app === "storefront");
    expect(shops[0]).toMatchObject({ slug: "demo", label: "Shop principale" });
    expect(shops[1]).toMatchObject({ slug: "big-school", label: "Big School" });
  });

  it("slug PostHog senza portale onboardato: label = slug, known false", () => {
    const tenants = buildTenants(
      [row("storefront", "scuola-fantasma", 7)],
      new Map(),
    );
    const ghost = tenants.find((t) => t.slug === "scuola-fantasma");
    expect(ghost).toMatchObject({ label: "scuola-fantasma", known: false });
  });

  it("portale onboardato a traffico zero: riga zero-filled presente", () => {
    const tenants = buildTenants(
      [],
      new Map([["nuova-scuola", "Nuova Scuola"]]),
    );
    const fresh = tenants.find((t) => t.slug === "nuova-scuola");
    expect(fresh).toMatchObject({
      label: "Nuova Scuola",
      known: true,
      visitors: 0,
      orders: 0,
    });
  });

  it("calcola la conversion rate orders/visitors (0 se visitors 0)", () => {
    const tenants = buildTenants(
      [row("storefront", "orsoline", 200, 10, 4000)],
      new Map([["orsoline", "Orsoline"]]),
    );
    expect(tenants.find((t) => t.slug === "orsoline")?.conversionRate).toBe(0.05);
    expect(tenants.find((t) => t.key === "cms")?.conversionRate).toBe(0);
  });

  it("ordina gli shop per ricavi poi visitatori", () => {
    const tenants = buildTenants(
      [
        row("storefront", "a", 50, 1, 100),
        row("storefront", "b", 10, 2, 900),
        row("storefront", "c", 80, 0, 0),
      ],
      new Map(),
    );
    const slugs = tenants.filter((t) => t.app === "storefront").map((t) => t.slug);
    expect(slugs).toEqual(["b", "a", "c"]);
  });
});
