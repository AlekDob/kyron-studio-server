import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { normalizePendingSchool } from "@/features/onboard-school/normalize.js";
import type { PendingSchool } from "@/features/onboard-school/schema.js";

// Catalogo Saleor finto: replica i prodotti reali coinvolti nel caso Siotto
// (2026-06-12), incluse le SKU col case reale e il protection plan AppleCare.
const CATALOG_RESPONSE = {
  data: {
    products: {
      edges: [
        {
          node: {
            slug: "ipada16",
            name: "Apple iPad A16",
            metadata: [],
            pricing: { priceRange: { start: { gross: { amount: 389 } } } },
            variants: [
              {
                sku: "MD4A4TY/A",
                attributes: [
                  { attribute: { slug: "capacita" }, values: [{ slug: "128gb" }] },
                ],
              },
              {
                sku: "MD4H4TY/A",
                attributes: [
                  { attribute: { slug: "capacita" }, values: [{ slug: "256gb" }] },
                ],
              },
            ],
          },
        },
        {
          node: {
            slug: "applecare-plus-ipad-a16",
            name: "AppleCare+ per iPad (A16)",
            metadata: [{ key: "isProtectionPlan", value: "true" }],
            pricing: { priceRange: { start: { gross: { amount: 79 } } } },
            variants: [{ sku: "SUYD2ZM/A", attributes: [] }],
          },
        },
        {
          node: {
            slug: "coverone",
            name: "Wacebo coverONE",
            metadata: [],
            pricing: { priceRange: { start: { gross: { amount: 29 } } } },
            variants: [{ sku: "CoverONE", attributes: [] }],
          },
        },
        {
          node: {
            slug: "ps-25wo1cb",
            name: "Wacebo DABLIU 25W",
            metadata: [],
            pricing: { priceRange: { start: { gross: { amount: 25 } } } },
            variants: [{ sku: "PS-25WO1CB", attributes: [] }],
          },
        },
      ],
    },
  },
};

// Descriptor come usciva DAVVERO dall'onboarding Studio per il Siotto Pintor,
// prima delle correzioni manuali: SKU minuscoli, AppleCare visibile,
// visibleVariants iPad nonostante heroOutsideBundle:false.
function brokenSiottoDoc(): PendingSchool {
  return {
    slug: "liceo-classico-giovanni-siotto-pintor",
    nome: "Liceo Classico Giovanni Siotto Pintor",
    sitoUfficiale: "https://www.liceosiotto.edu.it",
    codiceMeccanografico: "CAPC050004",
    schoolAddress: {
      firstName: "Liceo",
      lastName: "",
      companyName: "Liceo",
      streetAddress1: "Viale Trento, 97",
      postalCode: "09123",
      city: "Cagliari",
      countryArea: "CA",
      country: "IT",
      phone: null,
    },
    branding: { nome: "Siotto Pintor", logo: null },
    shipToSchool: true,
    shippingMethodLabel: "Consegna a scuola",
    shippingPriceEur: 0,
    catalog: {
      visibleSlugs: ["ps-25wo1cb", "coverone", "applecare-plus-ipad-a16"],
      visibleVariants: [
        { productSlug: "ipada16", attribute: "capacita", value: "128gb" },
        { productSlug: "ipada16", attribute: "capacita", value: "256gb" },
      ],
      hiddenSlugs: [],
      productDiscounts: [
        { slug: "applecare-plus-ipad-a16", capacity: null, kind: "eur", value: 75 },
      ],
      heroOutsideBundle: false,
      accessoriesOutsideBundle: true,
    },
    bundles: [
      {
        slug: "bundle-ipad-128gb",
        name: "BUNDLE iPad 128GB",
        finalPriceEur: 435,
        components: [
          { productSlug: "coverone", selection: { kind: "fixed", variantSku: "coverone" } },
          {
            productSlug: "ipada16",
            selection: {
              kind: "by-attribute",
              attribute: "colore",
              valueFilter: { capacita: "128gb" },
            },
          },
          {
            productSlug: "ps-25wo1cb",
            selection: { kind: "fixed", variantSku: "ps-25wo1cb" },
          },
        ],
      },
    ],
  };
}

describe("normalizePendingSchool", () => {
  beforeEach(() => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({
        ok: true,
        json: async () => CATALOG_RESPONSE,
      })),
    );
  });
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("corregge il caso Siotto: SKU case, AppleCare hidden, iPad bundle-only", async () => {
    const { doc, fixes, errors, skippedValidation } = await normalizePendingSchool(
      brokenSiottoDoc(),
    );
    expect(skippedValidation).toBe(false);
    expect(errors).toEqual([]);

    // 1. SKU normalizzati al case reale Saleor
    const skus = doc.bundles[0].components
      .map((c) => (c.selection.kind === "fixed" ? c.selection.variantSku : null))
      .filter(Boolean);
    expect(skus).toEqual(["CoverONE", "PS-25WO1CB"]);

    // 2. AppleCare fuori dal catalogo visibile, hidden-but-purchasable
    expect(doc.catalog.visibleSlugs).not.toContain("applecare-plus-ipad-a16");
    expect(doc.catalog.hiddenSlugs).toContain("applecare-plus-ipad-a16");

    // 3. heroOutsideBundle:false -> niente visibleVariants per il device del bundle
    expect(doc.catalog.visibleVariants).toEqual([]);
    expect(doc.catalog.hiddenSlugs).toContain("ipada16");

    expect(fixes.length).toBeGreaterThanOrEqual(4);
  });

  it("blocca eur che sembra uno sconto invece del prezzo finale", async () => {
    const doc = brokenSiottoDoc();
    doc.catalog.productDiscounts = [
      { slug: "applecare-plus-ipad-a16", capacity: null, kind: "eur", value: 4 },
    ];
    const { errors } = await normalizePendingSchool(doc);
    expect(errors.some((e) => e.includes("PREZZO FINALE"))).toBe(true);
  });

  it("blocca slug prodotto inesistente", async () => {
    const doc = brokenSiottoDoc();
    doc.catalog.visibleSlugs.push("dablu-pencil");
    const { errors } = await normalizePendingSchool(doc);
    expect(errors.some((e) => e.includes('"dablu-pencil"'))).toBe(true);
  });

  it("fail-open se Saleor e' giu'", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        throw new Error("network");
      }),
    );
    const { skippedValidation, errors } = await normalizePendingSchool(brokenSiottoDoc());
    expect(skippedValidation).toBe(true);
    expect(errors).toEqual([]);
  });

  it("heroOutsideBundle:true lascia i visibleVariants intatti", async () => {
    const doc = brokenSiottoDoc();
    doc.catalog.heroOutsideBundle = true;
    const { doc: out } = await normalizePendingSchool(doc);
    expect(out.catalog.visibleVariants).toHaveLength(2);
  });
});
