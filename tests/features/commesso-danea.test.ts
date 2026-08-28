import { describe, expect, it } from "vitest";
import {
  getTag,
  groupByAggregator,
  parseDaneaXml,
  parseVariantAttrs,
  variantName,
} from "@/features/commesso/danea-parse.js";
import { buildDaneaPlan } from "@/features/commesso/danea-plan.js";
import { aggregatorsSkippedWithoutMapping } from "@/features/commesso/danea-apply.js";
import type { DaneaPlanGroup } from "@/features/commesso/danea-plan.js";
import { importIdFromChat, putDaneaImport, resolveProductsImport } from "@/features/commesso/danea-uploads.js";
import { isAppleSku, matchSkuFromFilename } from "@/features/commesso/danea-sku.js";

const XML = `<?xml version="1.0"?>
<EasyfattProducts>
  <Product>
    <Code>MXYZ2ZM/A</Code>
    <Description>iPad A16 128GB Wi-Fi - Blue</Description>
    <Category>Tablet</Category>
    <Subcategory>iPad A16</Subcategory>
    <CustomField1>IPAD-A16</CustomField1>
    <GrossPrice1>409</GrossPrice1>
  </Product>
  <Product>
    <Code>MXYZ3ZM/A</Code>
    <Description>iPad A16 256GB Wi-Fi - Silver</Description>
    <Category>Tablet</Category>
    <Subcategory>iPad A16</Subcategory>
    <CustomField1>IPAD-A16</CustomField1>
    <GrossPrice1>529.50</GrossPrice1>
  </Product>
  <Product>
    <Code>SUYD2ZM/A</Code>
    <Description>Apple Pencil Pro</Description>
    <Category>Accessori</Category>
    <Subcategory>Apple Pencil</Subcategory>
    <CustomField1>PENCIL-PRO</CustomField1>
    <GrossPrice1>149</GrossPrice1>
  </Product>
</EasyfattProducts>`;

describe("parser Danea", () => {
  it("legge i record e i prezzi", () => {
    const records = parseDaneaXml(XML);
    expect(records).toHaveLength(3);
    expect(records[1].code).toBe("MXYZ3ZM/A");
    expect(records[1].grossPriceEur).toBe(529.5);
  });

  it("raggruppa per CustomField1", () => {
    const groups = groupByAggregator(parseDaneaXml(XML));
    expect(groups).toHaveLength(2);
    expect(groups[0].records).toHaveLength(2);
    expect(groups[0].warnings).toEqual([]);
  });

  it("avvisa se un aggregatore mescola sottocategorie", () => {
    const dirty = XML.replace("<CustomField1>PENCIL-PRO</CustomField1>", "<CustomField1>IPAD-A16</CustomField1>");
    const groups = groupByAggregator(parseDaneaXml(dirty));
    expect(groups).toHaveLength(1);
    expect(groups[0].warnings[0]).toContain("sottocategorie diverse");
  });

  it("ricava capacita e colore dalla descrizione", () => {
    expect(parseVariantAttrs("iPad A16 128GB Wi-Fi - Blue")).toEqual({
      capacita: "128GB",
      colore: "Blu",
    });
    expect(variantName(parseDaneaXml(XML)[0])).toBe("128GB Blu");
    // Senza capacita' ne' colore riconoscibile il nome cade sul codice.
    expect(variantName(parseDaneaXml(XML)[2])).toBe("SUYD2ZM/A");
  });
});

describe("piano import Danea", () => {
  const groups = groupByAggregator(parseDaneaXml(XML));

  it("tutto nuovo se il catalogo e' vuoto", () => {
    const plan = buildDaneaPlan({ channelSlug: "default-channel", groups, existing: [] });
    expect(plan.totals).toMatchObject({
      newProducts: 2,
      newVariants: 3,
      priceChanges: 0,
      unchanged: 0,
    });
  });

  it("separa invariati, prezzi cambiati e varianti nuove", () => {
    const plan = buildDaneaPlan({
      channelSlug: "default-channel",
      groups,
      existing: [
        { sku: "MXYZ2ZM/A", productSlug: "ipad-a16", priceEur: 409 },
        { sku: "MXYZ3ZM/A", productSlug: "ipad-a16", priceEur: 499 },
      ],
    });
    const ipad = plan.groups.find((g) => g.aggregator === "IPAD-A16");
    expect(ipad?.isNew).toBe(false);
    expect(ipad?.slug).toBe("ipad-a16");
    expect(ipad?.unchanged).toEqual(["MXYZ2ZM/A"]);
    expect(ipad?.priceChanges).toEqual([
      { sku: "MXYZ3ZM/A", fromEur: 499, toEur: 529.5 },
    ]);
    // La pencil non esiste: prodotto nuovo, variante nuova col suo prezzo.
    expect(plan.totals).toMatchObject({ newProducts: 1, newVariants: 1, priceChanges: 1 });
  });

  it("salta le righe senza prezzo invece di scrivere zero", () => {
    const noPrice = groupByAggregator(parseDaneaXml(XML.replace("<GrossPrice1>149</GrossPrice1>", "<GrossPrice1>0</GrossPrice1>")));
    const plan = buildDaneaPlan({ channelSlug: "default-channel", groups: noPrice, existing: [] });
    const pencil = plan.groups.find((g) => g.aggregator === "PENCIL-PRO");
    expect(pencil?.newVariants).toEqual([]);
    expect(pencil?.warnings[0]).toContain("prezzo assente");
  });

  // Il prefisso del tag e' ancorato: <Total> non deve agganciare <TotalWithoutTax>,
  // che nei DDT viene prima e farebbe leggere spazzatura.
  it("getTag non aggancia un tag col prefisso piu' lungo", () => {
    const block = "<TotalWithoutTax>335.25</TotalWithoutTax><Total>409</Total>";
    expect(getTag(block, "Total")).toBe("409");
    expect(getTag(block, "Number")).toBe("");
  });
});

describe("match foto per Codice Danea", () => {
  const skus = ["MD3Y4TY/A", "CoverONE"];

  it("accetta underscore al posto dello slash Apple", () => {
    expect(matchSkuFromFilename("MD3Y4TY_A.jpg", skus)).toBe("MD3Y4TY/A");
    expect(matchSkuFromFilename("MD3Y4TY/A/01.jpg", skus)).toBe("MD3Y4TY/A");
    expect(matchSkuFromFilename("CoverONE-2.png", skus)).toBe("CoverONE");
  });

  it("non indovina i file orfani", () => {
    expect(matchSkuFromFilename("random.jpg", skus)).toBeNull();
  });

  it("riconosce i part number Apple", () => {
    expect(isAppleSku("MD3Y4TY/A")).toBe(true);
    expect(isAppleSku("CoverONE")).toBe(false);
  });
});

describe("apply senza mapping", () => {
  it("salta il gruppo se manca il mapping", () => {
    const groups = [
      {
        aggregator: "IPAD-A16",
        newVariants: [{ sku: "MXYZ2ZM/A" }],
      },
    ] as DaneaPlanGroup[];
    expect(aggregatorsSkippedWithoutMapping(groups, [])).toEqual(["IPAD-A16"]);
    expect(
      aggregatorsSkippedWithoutMapping(groups, [
        {
          aggregator: "IPAD-A16",
          productName: "iPad",
          slug: "ipad",
          productTypeId: "t",
          categorySlug: "tablet",
        },
      ]),
    ).toEqual([]);
  });
});

describe("resolve import Danea", () => {
  it("estrae dan_ dal contesto UI, non dal nome file", () => {
    expect(
      importIdFromChat(
        'su shop principale\n\n[Contesto UI: file Danea attivo — importId "dan_abc123xyz"; tipo products; file "EcommProdotti (7).xml"]',
      ),
    ).toBe("dan_abc123xyz");
    expect(importIdFromChat("Ho caricato EcommProdotti (7).xml: 53 righe, 35 gruppi")).toBeUndefined();
  });

  it("se l'id del tool e' sbagliato usa l'ultimo listino in memoria", () => {
    const stored = putDaneaImport("EcommProdotti.xml", XML);
    const resolved = resolveProductsImport("EcommProdotti (7).xml", []);
    expect(resolved.id).toBe(stored.id);
  });
});
