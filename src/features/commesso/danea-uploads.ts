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
