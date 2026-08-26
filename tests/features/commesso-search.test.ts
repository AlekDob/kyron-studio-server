import { describe, expect, it } from "vitest";
import { matchesSearch } from "@/features/commesso/reads.js";
import type { ProductRow } from "@/features/commesso/reads.js";

// Il caso vero che si e' rotto in produzione: la ricerca di Saleor tornava zero
// su "iPad" con l'iPad in catalogo, perche' il suo indice testuale e' vuoto.
const ipad = {
  id: "P1",
  slug: "ipada16",
  name: "Apple iPad A16",
  category: "Tablet",
  productType: "Tablet",
  description: "",
  imageUrl: null,
  channels: ["default-channel"],
  variants: [{ id: "V1", sku: "IPADA16-128-BLU", name: "128GB Blu", stock: 3, attributes: [], channels: [] }],
} satisfies ProductRow;

describe("matchesSearch", () => {
  it("trova per nome, senza badare a maiuscole", () => {
    expect(matchesSearch(ipad, "ipad")).toBe(true);
    expect(matchesSearch(ipad, "iPad")).toBe(true);
  });

  it("trova per slug, categoria e SKU della variante", () => {
    expect(matchesSearch(ipad, "ipada16")).toBe(true);
    expect(matchesSearch(ipad, "tablet")).toBe(true);
    expect(matchesSearch(ipad, "IPADA16-128-BLU")).toBe(true);
  });

  it("vuole tutte le parole, non una qualsiasi", () => {
    expect(matchesSearch(ipad, "apple ipad")).toBe(true);
    expect(matchesSearch(ipad, "apple pencil")).toBe(false);
  });

  it("ricerca vuota = passa tutto", () => {
    expect(matchesSearch(ipad, "  ")).toBe(true);
  });
});
