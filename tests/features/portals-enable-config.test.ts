import { describe, expect, it } from "vitest";
import { toEnableConfig } from "@/features/portals/enable/config.js";
import { voucherCodeFor } from "@/features/portals/enable/seed-steps.js";
import { buildPubPlans } from "@/features/portals/enable/enable.js";
import type { PortalDetail } from "@/features/portals/reader.js";

// PortalDetail minimale come arriva dal reader (jsonb Payload gia' normalizzato),
// componenti bundle nelle DUE forme che convivono nei doc: "variant" (writer
// agente) e "by-attribute" (descriptor/seed).
function portalFixture(): PortalDetail {
  return {
    id: "1",
    slug: "liceo-classico-giovanni-siotto-pintor",
    nome: "Liceo Classico Giovanni Siotto Pintor",
    city: "Cagliari",
    countryArea: "CA",
    status: "approved",
    collectedBy: "agent",
    requestedBy: "e.silvestri@kyronedu.it",
    collectedAt: "2026-06-12",
    bundleCount: 1,
    productCount: 3,
    sitoUfficiale: "https://www.liceosiotto.edu.it",
    codiceMeccanografico: "CAPC050004",
    schoolAddress: {},
    branding: { nome: "Siotto Pintor", logoUrl: null },
    shipToSchool: true,
    shippingMethodLabel: "Consegna a scuola",
    shippingPriceEur: 0,
    catalog: {
      visibleSlugs: ["coverone"],
      visibleVariants: [],
      hiddenSlugs: ["ipada16"],
      productDiscounts: [],
      heroOutsideBundle: false,
      accessoriesOutsideBundle: true,
    },
    bundles: [
      {
        slug: "bundle-ipad-128gb",
        name: "BUNDLE iPad 128GB",
        finalPriceEur: 435,
        components: [
          {
            productSlug: "coverone",
            selection: { kind: "variant", variantSku: "CoverONE" },
          },
          {
            productSlug: "ipada16",
            selection: {
              kind: "by-attribute",
              attribute: "colore",
              valueFilter: { capacita: "128gb" },
            },
          },
        ],
      },
    ],
  };
}

describe("toEnableConfig", () => {
  it("normalizza variant->fixed e preserva by-attribute con valueFilter", () => {
    const config = toEnableConfig(portalFixture());
    const [cover, ipad] = config.bundles[0].components;
    expect(cover.selection).toEqual({ kind: "fixed", variantSku: "CoverONE" });
    expect(ipad.selection).toEqual({
      kind: "by-attribute",
      attribute: "colore",
      valueFilter: { capacita: "128gb" },
    });
  });

  it("rifiuta componenti senza selection.kind", () => {
    const broken = portalFixture();
    broken.bundles[0].components.push({ productSlug: "x" });
    expect(() => toEnableConfig(broken)).toThrow(/selection.kind/);
  });

  it("rifiuta selection fixed senza variantSku", () => {
    const broken = portalFixture();
    broken.bundles[0].components[0] = {
      productSlug: "coverone",
      selection: { kind: "fixed" },
    };
    expect(() => toEnableConfig(broken)).toThrow(/variantSku/);
  });
});

describe("buildPubPlans — componenti kit mai a scaffale", () => {
  // bug colombo 2026-07-29: un componente del kit non elencato in hiddenSlugs
  // (o rimasto in visibleSlugs dal picker) veniva pubblicato visible e si
  // vendeva singolo accanto al kit. Con heroOutsideBundle=false vince il flag.
  it("forza hidden-purchasable sui componenti quando heroOutsideBundle=false", () => {
    // coverone e' in visibleSlugs ED e' componente del bundle.
    const plans = buildPubPlans(toEnableConfig(portalFixture()));
    expect(plans.get("coverone")?.mode).toBe("hidden-purchasable");
    expect(plans.get("ipada16")?.mode).toBe("hidden-purchasable");
  });

  it("rispetta heroOutsideBundle=true (accessori venduti anche sfusi)", () => {
    const p = portalFixture();
    p.catalog.heroOutsideBundle = true;
    const plans = buildPubPlans(toEnableConfig(p));
    expect(plans.get("coverone")?.mode).toBe("visible");
  });

  it("lascia visibili i prodotti che non sono componenti di nessun kit", () => {
    const p = portalFixture();
    p.catalog.visibleSlugs = ["coverone", "ps-25wo1cb"];
    const plans = buildPubPlans(toEnableConfig(p));
    expect(plans.get("ps-25wo1cb")?.mode).toBe("visible");
  });
});

describe("voucherCodeFor", () => {
  it("matcha la convenzione del seed CLI e dello storefront", () => {
    // Codici REALI gia' creati su Saleor: la convenzione non puo' divergere.
    expect(
      voucherCodeFor("liceo-classico-giovanni-siotto-pintor", "bundle-ipad-128gb"),
    ).toBe("KIT-LICEOCLASSIC-BUNDLEIPAD128GB-AUTO");
    expect(voucherCodeFor("orsoline-san-carlo", "kit-3")).toBe(
      "KIT-ORSOLINESANC-KIT3-AUTO",
    );
  });
});
