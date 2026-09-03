import { describe, expect, it } from "vitest";
import { slugify } from "@/features/customers/store.js";

// Lo slug e' l'identita' del segmento: due nomi diversi non devono collassare
// sullo stesso, e gli accenti non devono finire nella chiave.
describe("slugify", () => {
  it("normalizza nome, accenti e spazi", () => {
    expect(slugify("Ricorrenti Massari")).toBe("ricorrenti-massari");
    expect(slugify("Città  & Provincia!")).toBe("citta-provincia");
    expect(slugify("  --Nuovi--  ")).toBe("nuovi");
  });

  it("torna vuoto se non resta niente di utile", () => {
    expect(slugify("???")).toBe("");
  });
});
