// Parser dell'export Danea `EcommProdotti.xml`. Funzioni PURE su stringa: qui
// non si legge dal disco e non si scrive su Saleor.
//
// Estratto da ecommerce/seed/import-danea.ts (che resta lo strumento per il
// re-import completo con le immagini). Qui NON portiamo lo scraping apple.com,
// la normalizzazione immagini e la tabella dei titoli editoriali: i titoli li
// scrive l'agente insieme all'utente.

/** Un record Danea = una riga di magazzino = una variante Saleor. */
export interface DaneaRecord {
  code: string;
  name: string;
  category: string;
  subcategory: string;
  aggregator: string;
  grossPriceEur: number;
}

/** Un gruppo = un prodotto Saleor con N varianti. */
export interface DaneaGroup {
  aggregator: string;
  category: string;
  subcategory: string;
  records: DaneaRecord[];
  /** Problemi del file, non del nostro codice: si mostrano, non si aggirano. */
  warnings: string[];
}

// Colori Danea (misti IT/EN) sui nomi che usiamo su Saleor.
const COLOR_NORMALIZE: Record<string, string> = {
  blue: "Blu",
  blu: "Blu",
  pink: "Rosa",
  rosa: "Rosa",
  silver: "Argento",
  argento: "Argento",
  yellow: "Giallo",
  giallo: "Giallo",
};

/**
 * Contenuto di un tag XML. Il prefisso e' ancorato: `<Total>` NON deve
 * agganciare `<TotalWithoutTax>` (succede nei DDT, dove TotalWithoutTax viene
 * prima di Total, e la cattura arriverebbe fino al vero </Total> restituendo
 * spazzatura). Stessa trappola su Number/Numbering.
 */
export function getTag(block: string, tag: string): string {
  const m = block.match(new RegExp(`<${tag}(?:\\s[^>]*)?>([\\s\\S]*?)</${tag}>`));
  if (!m) return "";
  return m[1]
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/\s+/g, " ")
    .trim();
}

export function parseDaneaXml(xml: string): DaneaRecord[] {
  const blocks = xml.match(/<Product>[\s\S]*?<\/Product>/g) ?? [];
  return blocks
    .map((b) => ({
      code: getTag(b, "Code"),
      name: getTag(b, "Description"),
      category: getTag(b, "Category"),
      subcategory: getTag(b, "Subcategory"),
      aggregator: getTag(b, "CustomField1"),
      grossPriceEur: parseFloat(getTag(b, "GrossPrice1") || "0"),
    }))
    .filter((r) => r.code.length > 0);
}

/**
 * Raggruppa per `CustomField1`: e' il campo con cui in Danea si dice "queste
 * righe sono la stessa cosa in taglie diverse". Sporco o duplicato tra famiglie
 * genera prodotti fantasma con 20 varianti, quindi il grouping segnala le
 * subcategory miste invece di ingoiarle.
 */
export function groupByAggregator(records: DaneaRecord[]): DaneaGroup[] {
  const groups = new Map<string, DaneaRecord[]>();
  for (const r of records) {
    const key = r.aggregator || r.code;
    const list = groups.get(key);
    if (list) list.push(r);
    else groups.set(key, [r]);
  }
  return [...groups].map(([aggregator, items]) => {
    const subs = [...new Set(items.map((i) => i.subcategory))];
    return {
      aggregator,
      category: items[0].category,
      subcategory: items[0].subcategory,
      records: items,
      warnings:
        subs.length > 1
          ? [
              `L'aggregatore "${aggregator}" mescola sottocategorie diverse (${subs.join(", ")}): probabile CustomField1 sbagliato in Danea.`,
            ]
          : [],
    };
  });
}

/** Capacita' e colore ricavati dalla descrizione Danea. */
export function parseVariantAttrs(description: string): {
  capacita: string | null;
  colore: string | null;
} {
  const cap = description.match(/(\d{2,4})\s*GB/i);
  // Il colore e' l'ultimo segmento dopo " - " (es. "... - Blue").
  const parts = description.split(/\s+-\s+/);
  const last = parts[parts.length - 1].trim().toLowerCase();
  return {
    capacita: cap ? `${cap[1]}GB` : null,
    colore: COLOR_NORMALIZE[last] ?? null,
  };
}

export function slugify(input: string): string {
  return input
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

/** Nome variante leggibile: "256GB Blu", oppure il codice se non c'e' altro. */
export function variantName(record: DaneaRecord): string {
  const { capacita, colore } = parseVariantAttrs(record.name);
  const parts = [capacita, colore].filter(Boolean);
  return parts.length ? parts.join(" ") : record.code;
}
