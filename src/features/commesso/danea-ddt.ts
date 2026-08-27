// Parser dell'export Danea `EasyfattDocuments` (DDT). Funzioni PURE su stringa,
// stesso stile di danea-parse.ts: due soli livelli di annidamento e nessun
// attributo da leggere, quindi niente libreria XML.
//
// I DDT Kyron sono consegne a scuola: TrackingNumber e' vuoto su tutti, quindi
// non lo modelliamo. I campi che contano sono i CustomField, che Danea usa come
// ponte verso i nostri dati: 1 = slug portale, 2 = PaymentIntent Stripe,
// 4 = codice meccanografico della scuola.
import { getTag } from "./danea-parse.js";

/** Una riga di un DDT. */
export interface DaneaDocumentLine {
  code: string;
  description: string;
  qty: number;
  priceEur: number;
  serial: string;
}

/** Un DDT = una consegna a un cliente. */
export interface DaneaDocument {
  /** Identita' stabile del documento, chiave anti-doppio-invio: "/EC-1-2026-08-05". */
  docKey: string;
  number: string;
  numbering: string;
  date: string;
  customerName: string;
  customerEmail: string;
  portalSlug: string;
  paymentIntent: string;
  deliveryKind: string;
  meccanografico: string;
  studentNote: string;
  paymentName: string;
  totalGross: number;
  lines: DaneaDocumentLine[];
}

function parseLines(block: string): DaneaDocumentLine[] {
  // Prima isoliamo <Rows>...</Rows>: senza questo, Description/Price di riga
  // verrebbero letti come se fossero della testata.
  const rows = block.match(/<Rows>[\s\S]*?<\/Rows>/)?.[0] ?? "";
  return (rows.match(/<Row>[\s\S]*?<\/Row>/g) ?? []).map((r) => ({
    code: getTag(r, "Code"),
    description: getTag(r, "Description"),
    qty: parseFloat(getTag(r, "Qty") || "0"),
    priceEur: parseFloat(getTag(r, "Price") || "0"),
    serial: getTag(r, "Serial"),
  }));
}

function parseDocument(block: string): DaneaDocument {
  const number = getTag(block, "Number");
  const numbering = getTag(block, "Numbering");
  const date = getTag(block, "Date");
  const pi = getTag(block, "CustomField2");
  return {
    docKey: `${numbering}-${number}-${date}`,
    number,
    numbering,
    date,
    customerName: getTag(block, "CustomerName"),
    customerEmail: getTag(block, "CustomerEmail").toLowerCase(),
    portalSlug: getTag(block, "CustomField1"),
    // CustomField2 e' libero in Danea: teniamo solo cio' che e' davvero un pi_.
    paymentIntent: /^pi_/.test(pi) ? pi : "",
    deliveryKind: getTag(block, "CustomField3"),
    meccanografico: getTag(block, "CustomField4"),
    studentNote: getTag(block, "FootNotes"),
    paymentName: getTag(block, "PaymentName"),
    totalGross: parseFloat(getTag(block, "Total") || "0"),
    lines: parseLines(block),
  };
}

/** Solo i DDT (`DocumentType = D`): fatture e ordini nello stesso export si scartano. */
export function parseDaneaDocuments(xml: string): DaneaDocument[] {
  return (xml.match(/<Document>[\s\S]*?<\/Document>/g) ?? [])
    .filter((b) => getTag(b, "DocumentType") === "D")
    .map(parseDocument);
}

/** Riassunto per la chat: quante consegne, dove, come pagate, quante senza email. */
export function summarizeDocuments(docs: DaneaDocument[]): {
  total: number;
  withoutEmail: number;
  byPortal: { portale: string; ddt: number }[];
  byPayment: { pagamento: string; ddt: number }[];
  dateFrom: string;
  dateTo: string;
} {
  const count = (pick: (d: DaneaDocument) => string): Map<string, number> => {
    const m = new Map<string, number>();
    for (const d of docs) {
      const k = pick(d) || "(vuoto)";
      m.set(k, (m.get(k) ?? 0) + 1);
    }
    return m;
  };
  const dates = docs.map((d) => d.date).filter(Boolean).sort();
  const sorted = (m: Map<string, number>) => [...m].sort((a, b) => b[1] - a[1]);
  return {
    total: docs.length,
    withoutEmail: docs.filter((d) => !d.customerEmail).length,
    byPortal: sorted(count((d) => d.portalSlug)).map(([portale, ddt]) => ({ portale, ddt })),
    byPayment: sorted(count((d) => d.paymentName)).map(([pagamento, ddt]) => ({ pagamento, ddt })),
    dateFrom: dates[0] ?? "",
    dateTo: dates[dates.length - 1] ?? "",
  };
}
