import { describe, expect, it } from "vitest";
import {
  groupByAggregator,
  parseDaneaXml,
  parseVariantAttrs,
  variantName,
} from "@/features/commesso/danea-parse.js";
import { buildDaneaPlan } from "@/features/commesso/danea-plan.js";

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
});
