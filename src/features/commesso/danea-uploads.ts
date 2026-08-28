// Store IN MEMORIA dell'export Danea caricato. Non teniamo l'XML: lo parsiamo
// subito e conserviamo solo i record, che sono piccoli. TTL di un'ora, il tempo
// di guardare il piano e confermare; niente disco (si azzera al redeploy) e
// niente collection nuova su Payload per un file di passaggio.
//
// Due formati, un solo uploader: il listino prodotti (EcommProdotti.xml) e i
// DDT (EasyfattDocuments). Il tipo si riconosce dal file, non lo si chiede
// all'utente.
import { groupByAggregator, parseDaneaXml, type DaneaGroup } from "./danea-parse.js";
import { parseDaneaDocuments, type DaneaDocument } from "./danea-ddt.js";

const TTL_MS = 60 * 60_000;
const MAX_BYTES = 8 * 1024 * 1024;
const MAX_ENTRIES = 10;

interface StoredBase {
  id: string;
  filename: string;
  recordCount: number;
  expiresAt: number;
}

export interface StoredProductsImport extends StoredBase {
  kind: "products";
  groups: DaneaGroup[];
  /** Nomi confermati in UI. Apply li legge da qui, non dal modello. */
  mappings?: import("./danea-apply.js").GroupMapping[];
  mappingsConfirmed?: boolean;
  createdSlugs?: string[];
}

export interface StoredDdtImport extends StoredBase {
  kind: "ddt";
  documents: DaneaDocument[];
  /**
   * Indice DDT -> ordine Saleor, riempito al primo piano di mailing e riusato
   * per il TTL. Teniamo solo id e numero: gli ordini interi × 10 slot
   * gonfierebbero il container per niente.
   */
  orderIndex?: Record<string, { orderId: string; orderNumber: string }>;
}

export type StoredImport = StoredProductsImport | StoredDdtImport;

const store = new Map<string, StoredImport>();

function purge(): void {
  const now = Date.now();
  for (const [id, entry] of store) if (entry.expiresAt <= now) store.delete(id);
}

function newId(): string {
  return `dan_${Math.random().toString(36).slice(2, 10)}${Date.now().toString(36)}`;
}

function buildEntry(filename: string, xml: string): StoredImport {
  const base = { id: newId(), filename, expiresAt: Date.now() + TTL_MS };
  if (xml.includes("<EasyfattDocuments") || xml.includes("<Documents>")) {
    const documents = parseDaneaDocuments(xml);
    if (documents.length === 0) {
      throw new Error("Nessun DDT trovato nel file: contiene documenti di tipo D?");
    }
    return { ...base, kind: "ddt", documents, recordCount: documents.length };
  }
  const records = parseDaneaXml(xml);
  if (records.length === 0) {
    throw new Error("Nessun record trovato: e' un listino EcommProdotti.xml o un export DDT?");
  }
  return {
    ...base,
    kind: "products",
    groups: groupByAggregator(records),
    recordCount: records.length,
  };
}

export function putDaneaImport(filename: string, xml: string): StoredImport {
  purge();
  if (Buffer.byteLength(xml) > MAX_BYTES) throw new Error("File troppo grande (max 8 MB).");
  if (store.size >= MAX_ENTRIES) throw new Error("Troppi import aperti, riprova tra un po'.");
  const entry = buildEntry(filename, xml);
  store.set(entry.id, entry);
  return entry;
}

export function getDaneaImport(id: string): StoredImport {
  purge();
  const entry = store.get(id);
  if (!entry) {
    throw new Error("Import scaduto o non trovato: ricarica il file Danea.");
  }
  return entry;
}

/** Come getDaneaImport, ma fallisce chiaro se il file caricato e' dell'altro tipo. */
export function getDdtImport(id: string): StoredDdtImport {
  const entry = getDaneaImport(id);
  if (entry.kind !== "ddt") {
    throw new Error(`L'import ${id} e' un listino prodotti, non un file di DDT.`);
  }
  return entry;
}

export function getProductsImport(id: string): StoredProductsImport {
  const entry = getDaneaImport(id);
  if (entry.kind !== "products") {
    throw new Error(`L'import ${id} e' un file di DDT, non un listino prodotti.`);
  }
  return entry;
}

function latestOf<K extends StoredImport["kind"]>(
  kind: K,
): Extract<StoredImport, { kind: K }> | null {
  purge();
  let best: Extract<StoredImport, { kind: K }> | null = null;
  for (const entry of store.values()) {
    if (entry.kind !== kind) continue;
    const typed = entry as Extract<StoredImport, { kind: K }>;
    if (!best || typed.expiresAt > best.expiresAt) best = typed;
  }
  return best;
}

export function importIdFromChat(text: string): string | undefined {
  const fromContext = text.match(/importId "([^"]+)"/);
  if (fromContext?.[1]) return fromContext[1];
  try {
    const parsed = JSON.parse(text) as { component?: string; data?: { id?: string } };
    if (
      parsed.component === "DaneaUploader" &&
      typeof parsed.data?.id === "string" &&
      parsed.data.id.startsWith("dan_")
    ) {
      return parsed.data.id;
    }
  } catch {
    /* non e' il JSON della card */
  }
  return undefined;
}

/** Id dal tool, altrimenti dal testo chat, altrimenti l'ultimo listino in memoria. */
export function resolveProductsImport(
  id: string | undefined,
  chatTexts: string[] = [],
): StoredProductsImport {
  purge();
  const candidates = [
    id,
    ...chatTexts.map(importIdFromChat).reverse(),
  ].filter((v): v is string => Boolean(v));
  for (const candidate of candidates) {
    const hit = store.get(candidate);
    if (hit?.kind === "products") return hit;
  }
  const latest = latestOf("products");
  if (latest) return latest;
  throw new Error("Import scaduto o non trovato: ricarica il file Danea.");
}

export function saveProductMappings(
  id: string,
  mappings: import("./danea-apply.js").GroupMapping[],
): StoredProductsImport {
  const entry = getProductsImport(id);
  entry.mappings = mappings;
  entry.mappingsConfirmed = true;
  store.set(entry.id, entry);
  return entry;
}

export function saveCreatedSlugs(id: string, slugs: string[]): void {
  const entry = getProductsImport(id);
  entry.createdSlugs = [...new Set([...(entry.createdSlugs ?? []), ...slugs])];
  store.set(entry.id, entry);
}
