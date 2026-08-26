// Store IN MEMORIA dell'export Danea caricato. Non teniamo l'XML: lo parsiamo
// subito e conserviamo solo i record, che sono piccoli. TTL di un'ora, il tempo
// di guardare il piano e confermare; niente disco (si azzera al redeploy) e
// niente collection nuova su Payload per un file di passaggio.
import { groupByAggregator, parseDaneaXml, type DaneaGroup } from "./danea-parse.js";

const TTL_MS = 60 * 60_000;
const MAX_BYTES = 8 * 1024 * 1024;
const MAX_ENTRIES = 10;

export interface StoredImport {
  id: string;
  filename: string;
  groups: DaneaGroup[];
  recordCount: number;
  expiresAt: number;
}

const store = new Map<string, StoredImport>();

function purge(): void {
  const now = Date.now();
  for (const [id, entry] of store) if (entry.expiresAt <= now) store.delete(id);
}

export function putDaneaImport(filename: string, xml: string): StoredImport {
  purge();
  if (Buffer.byteLength(xml) > MAX_BYTES) throw new Error("File troppo grande (max 8 MB).");
  if (store.size >= MAX_ENTRIES) throw new Error("Troppi import aperti, riprova tra un po'.");
  const records = parseDaneaXml(xml);
  if (records.length === 0) {
    throw new Error("Nessun prodotto trovato nel file: e' davvero un EcommProdotti.xml?");
  }
  const entry: StoredImport = {
    id: `dan_${Math.random().toString(36).slice(2, 10)}${Date.now().toString(36)}`,
    filename,
    groups: groupByAggregator(records),
    recordCount: records.length,
    expiresAt: Date.now() + TTL_MS,
  };
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
