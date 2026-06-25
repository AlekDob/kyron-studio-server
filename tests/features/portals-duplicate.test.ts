import { describe, it, expect } from "vitest";
import { buildClonedDoc } from "@/features/portals/writer.js";
import type { PortalDetail } from "@/features/portals/reader.js";

// Regression: la collection Payload pending-schools ha 5 campi schoolAddress
// `required` (streetAddress1, postalCode, city, countryArea, country) e nessun
// draft versioning. buildClonedDoc deve fornire un placeholder per ognuno,
// altrimenti la create fallisce con ValidationError -> 400 (duplicazione KO).
const REQUIRED_ADDRESS_FIELDS = [
  "streetAddress1",
  "postalCode",
  "city",
  "countryArea",
  "country",
] as const;

function makeSource(): PortalDetail {
  return {
    id: "1",
    slug: "majorana",
    nome: "IISS E. Majorana",
    city: "Brindisi",
    countryArea: "BR",
    status: "approved",
    collectedBy: "agent",
    requestedBy: "r.russo@kyronedu.it",
    codiceMeccanografico: "BRTF010001",
    collectedAt: "2026-01-01",
    bundleCount: 1,
    productCount: 5,
    logoUrl: null,
    sitoUfficiale: "https://majorana.example",
    schoolAddress: { city: "Brindisi", streetAddress1: "Via Roma 1" },
    branding: { nome: "IISS E. Majorana", logoUrl: null },
    shipToSchool: true,
    shippingMethodLabel: "Consegna a scuola",
    shippingPriceEur: 0,
    catalog: {
      visibleSlugs: ["ipad-air"],
      visibleVariants: [],
      hiddenSlugs: [],
      productDiscounts: [],
      heroOutsideBundle: false,
      accessoriesOutsideBundle: false,
    },
    bundles: [
      { slug: "kit-base", name: "Kit Base", finalPriceEur: 799, components: [] },
    ],
  };
}

describe("buildClonedDoc", () => {
  const cloned = buildClonedDoc(makeSource(), {
    newSlug: "panettipitagora",
    newNome: "ITT Panetti - Pitagora",
    requestedBy: "a.ravelli@kyronedu.it",
  });

  it("provides a non-empty value for every required Payload address field", () => {
    const addr = cloned.schoolAddress as Record<string, unknown>;
    for (const field of REQUIRED_ADDRESS_FIELDS) {
      expect(addr[field], `schoolAddress.${field} must be set`).toBeTruthy();
    }
  });

  it("resets identity and forces a draft, cloning the structure verbatim", () => {
    expect(cloned.slug).toBe("panettipitagora");
    expect(cloned.nome).toBe("ITT Panetti - Pitagora");
    expect(cloned.status).toBe("draft");
    expect(cloned.collectedBy).toBe("manual");
    expect(cloned.codiceMeccanografico).toBe("TBD");
    // L'indirizzo della sorgente NON viene copiato (placeholder, non Via Roma).
    expect((cloned.schoolAddress as Record<string, unknown>).streetAddress1).not.toBe(
      "Via Roma 1",
    );
    // Catalogo e bundle clonati.
    expect(cloned.catalog).toEqual(makeSource().catalog);
    expect((cloned.bundles as unknown[]).length).toBe(1);
  });
});
