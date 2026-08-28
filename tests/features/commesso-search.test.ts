import { describe, expect, it } from "vitest";
import { matchesSearch, nextSaleorPageSize, productOnChannel, narrowProductToChannel } from "@/features/commesso/reads.js";
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

  it("trova il taglio 128 anche se lo SKU e' un codice Apple senza 128", () => {
    const appleSku = {
      ...ipad,
      variants: [
        {
          id: "V1",
          sku: "MD3Y4TY/A",
          name: "128GB Blu",
          stock: 3,
          attributes: [{ name: "Capacita", value: "128GB" }],
          channels: [],
        },
      ],
    } satisfies ProductRow;
    expect(matchesSearch(appleSku, "ipad 128")).toBe(true);
    expect(matchesSearch(ipad, "ipad 128")).toBe(true);
  });
});

describe("nextSaleorPageSize", () => {
  it("non chiede mai piu' di 100, anche se ne servono 200", () => {
    expect(nextSaleorPageSize(0, 200)).toBe(100);
    expect(nextSaleorPageSize(100, 200)).toBe(100);
    expect(nextSaleorPageSize(200, 200)).toBe(0);
  });
});

const ipadOrsoline = {
  ...ipad,
  channels: ["default-channel", "orsoline-san-carlo"],
  variants: [
    {
      id: "V1",
      sku: "IPADA16-128-BLU",
      name: "128GB Blu",
      stock: 3,
      attributes: [],
      channels: [
        { channelSlug: "default-channel", priceEur: 612, published: true },
        { channelSlug: "orsoline-san-carlo", priceEur: 509, published: true },
      ],
    },
  ],
} satisfies ProductRow;

const coverOnlyMain = {
  ...ipad,
  id: "P2",
  slug: "coverone",
  name: "Wacebo coverONE",
  channels: ["default-channel"],
  variants: [
    {
      id: "V2",
      sku: "COVERONE",
      name: "Nero",
      stock: 1,
      attributes: [],
      channels: [{ channelSlug: "default-channel", priceEur: 29, published: true }],
    },
  ],
} satisfies ProductRow;

describe("productOnChannel", () => {
  it("tiene i prodotti pubblicati sul canale", () => {
    expect(productOnChannel(ipadOrsoline, "orsoline-san-carlo")).toBe(true);
    expect(productOnChannel(coverOnlyMain, "orsoline-san-carlo")).toBe(false);
  });

  it("tiene anche chi ha solo il prezzo, senza listing pubblicato", () => {
    const unpublished = {
      ...coverOnlyMain,
      channels: [],
      variants: [
        {
          ...coverOnlyMain.variants[0],
          channels: [{ channelSlug: "orsoline-san-carlo", priceEur: 23, published: true }],
        },
      ],
    } satisfies ProductRow;
    expect(productOnChannel(unpublished, "orsoline-san-carlo")).toBe(true);
  });
});

describe("narrowProductToChannel", () => {
  it("lascia al modello solo i prezzi di quel canale", () => {
    const slim = narrowProductToChannel(ipadOrsoline, "orsoline-san-carlo");
    expect(slim.channels).toEqual(["orsoline-san-carlo"]);
    expect(slim.variants[0].channels).toEqual([
      { channelSlug: "orsoline-san-carlo", priceEur: 509, published: true },
    ]);
  });
});
