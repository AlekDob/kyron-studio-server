// Diff tra un export Danea e il catalogo Saleor. PURO: nessuna rete.
//
// Regola che decide tutto: un prezzo NUOVO si puo' scrivere subito (una variante
// che nasce ora non e' dentro nessun kit), un prezzo che CAMBIA no — quello
// passa dal piano prezzi, che sa dei voucher dei kit (R1).
import type { DaneaGroup, DaneaRecord } from "./danea-parse.js";
import { productTitleFromDescriptions, slugify, variantName } from "./danea-parse.js";

export interface NewVariant {
  sku: string;
  name: string;
  priceEur: number;
}

export interface DaneaPlanGroup {
  /** Slug proposto per il prodotto (nome definitivo lo decide l'utente). */
  slug: string;
  aggregator: string;
  /** Titolo da <Description> Danea (o prefisso comune del gruppo). */
  suggestedName: string;
  subcategory: string;
  /** true = il prodotto non esiste ancora su Saleor. */
  isNew: boolean;
  newVariants: NewVariant[];
  /** Prezzi che cambierebbero: NON si applicano qui. */
  priceChanges: Array<{ sku: string; fromEur: number | null; toEur: number }>;
  unchanged: string[];
  warnings: string[];
}

export interface DaneaPlan {
  channelSlug: string;
  groups: DaneaPlanGroup[];
  /** Totali per la card: l'utente deve capire la portata in un'occhiata. */
  totals: { newProducts: number; newVariants: number; priceChanges: number; unchanged: number };
  warnings: string[];
}

/** Cosa sappiamo del catalogo attuale, ridotto al minimo che serve al diff. */
export interface ExistingVariant {
  sku: string;
  productSlug: string;
  priceEur: number | null;
}

const round2 = (n: number): number => Math.round(n * 100) / 100;

function planGroup(
  group: DaneaGroup,
  bySku: Map<string, ExistingVariant>,
): DaneaPlanGroup {
  const newVariants: NewVariant[] = [];
  const priceChanges: DaneaPlanGroup["priceChanges"] = [];
  const unchanged: string[] = [];
  const warnings = [...group.warnings];
  const existingSlugs = new Set<string>();

  for (const record of group.records) {
    const existing = bySku.get(record.code);
    const price = round2(record.grossPriceEur);
    if (price <= 0) {
      warnings.push(`${record.code}: prezzo assente o zero nel file, lo salto.`);
      continue;
    }
    if (!existing) {
      newVariants.push({ sku: record.code, name: variantName(record), priceEur: price });
      continue;
    }
    existingSlugs.add(existing.productSlug);
    if (existing.priceEur === price) unchanged.push(record.code);
    else priceChanges.push({ sku: record.code, fromEur: existing.priceEur, toEur: price });
  }

  if (existingSlugs.size > 1) {
    warnings.push(
      `Le righe di "${group.aggregator}" sono sparse su piu' prodotti Saleor (${[...existingSlugs].join(", ")}): l'import non le unisce, va sistemato a mano.`,
    );
  }

  const suggestedName = productTitleFromDescriptions(group.records.map((r) => r.name));
  return {
    slug: [...existingSlugs][0] ?? slugify(suggestedName || group.aggregator),
    aggregator: group.aggregator,
    suggestedName: suggestedName || group.aggregator,
    subcategory: group.subcategory,
    isNew: existingSlugs.size === 0,
    newVariants,
    priceChanges,
    unchanged,
    warnings,
  };
}

export function buildDaneaPlan(input: {
  channelSlug: string;
  groups: DaneaGroup[];
  existing: ExistingVariant[];
}): DaneaPlan {
  const bySku = new Map(input.existing.map((v) => [v.sku, v]));
  const groups = input.groups.map((g) => planGroup(g, bySku));
  const sum = (pick: (g: DaneaPlanGroup) => number): number =>
    groups.reduce((total, g) => total + pick(g), 0);

  return {
    channelSlug: input.channelSlug,
    groups,
    totals: {
      newProducts: groups.filter((g) => g.isNew).length,
      newVariants: sum((g) => g.newVariants.length),
      priceChanges: sum((g) => g.priceChanges.length),
      unchanged: sum((g) => g.unchanged.length),
    },
    warnings: [
      // Da verificare UNA volta contro la config fiscale del canale: se
      // GrossPrice1 fosse netto saremmo del 22% fuori su tutto il catalogo.
      "I prezzi arrivano da GrossPrice1 di Danea e si scrivono come sono.",
      "I prezzi che cambiano su prodotti esistenti NON vengono toccati qui: passano dal piano prezzi, che sa dei kit.",
    ],
  };
}

/** Le sole righe applicabili da apply: prodotti e varianti nuove. */
export function applicableGroups(plan: DaneaPlan): DaneaPlanGroup[] {
  return plan.groups.filter((g) => g.newVariants.length > 0);
}

export type { DaneaRecord };
