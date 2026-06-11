import { describe, expect, it } from "vitest";
import { buildLeads, buildTenants } from "@/features/analytics/service.js";

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

// Row shape Query C: [event, form, count]
describe("buildLeads", () => {
  it("aggrega form/newsletter/registrazioni con breakdown per form", () => {
    const leads = buildLeads([
      ["form_submitted", "contatti", 5],
      ["form_submitted", "lavora-con-noi", 2],
      ["form_submitted", "", 1],
      ["newsletter_subscribed", "", 3],
      ["account_registered", "", 4],
    ]);
    expect(leads.formSubmits).toBe(8);
    expect(leads.newsletterSubs).toBe(3);
    expect(leads.registrations).toBe(4);
    // ordinati per volume, form vuoto -> "altro"
    expect(leads.forms).toEqual([
      { form: "contatti", count: 5 },
      { form: "lavora-con-noi", count: 2 },
      { form: "altro", count: 1 },
    ]);
  });

  it("ritorna zeri su nessun evento", () => {
    expect(buildLeads([])).toEqual({
      formSubmits: 0,
      newsletterSubs: 0,
      registrations: 0,
      forms: [],
    });
  });
});
