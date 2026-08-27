// Aggancio DDT Danea -> ordine Saleor. Serve SOLO a mostrare il log della
// comunicazione sulla scheda ordine: la mail parte comunque, perche' il DDT
// contiene gia' nome, email, scuola, studente e righe.
//
// Cascata: prima il PaymentIntent (CustomField2, esatto e non ambiguo), poi
// email + portale ma solo se c'e' UN candidato. Due candidati = due figli della
// stessa famiglia nella stessa scuola: meglio "ambiguo" che un aggancio
// sbagliato sull'ordine di un altro.
import type { OrderSummary } from "@/core/saleor/orders.js";
import type { DaneaDocument } from "@/features/commesso/danea-ddt.js";

export type MatchReason = "payment_intent" | "email_portal" | "ambiguous" | "not_found";

export interface DdtMatch {
  docKey: string;
  matched: boolean;
  reason: MatchReason;
  orderId: string;
  orderNumber: string;
}

const emailKey = (email: string, channelSlug: string): string =>
  `${email.trim().toLowerCase()}|${channelSlug.trim().toLowerCase()}`;

export function buildOrderIndex(orders: OrderSummary[]): {
  byPi: Map<string, OrderSummary>;
  byEmail: Map<string, OrderSummary[]>;
} {
  const byPi = new Map<string, OrderSummary>();
  const byEmail = new Map<string, OrderSummary[]>();
  for (const o of orders) {
    if (o.pspReference) byPi.set(o.pspReference, o);
    const k = emailKey(o.userEmail, o.channelSlug);
    const list = byEmail.get(k);
    if (list) list.push(o);
    else byEmail.set(k, [o]);
  }
  return { byPi, byEmail };
}

const hit = (doc: DaneaDocument, o: OrderSummary, reason: MatchReason): DdtMatch => ({
  docKey: doc.docKey,
  matched: true,
  reason,
  orderId: o.id,
  orderNumber: o.number,
});

const miss = (doc: DaneaDocument, reason: MatchReason): DdtMatch => ({
  docKey: doc.docKey,
  matched: false,
  reason,
  orderId: "",
  orderNumber: "",
});

export function matchDocument(
  doc: DaneaDocument,
  index: ReturnType<typeof buildOrderIndex>,
): DdtMatch {
  const byPi = doc.paymentIntent ? index.byPi.get(doc.paymentIntent) : undefined;
  if (byPi) return hit(doc, byPi, "payment_intent");
  const candidates = index.byEmail.get(emailKey(doc.customerEmail, doc.portalSlug)) ?? [];
  if (candidates.length === 1) return hit(doc, candidates[0], "email_portal");
  return miss(doc, candidates.length > 1 ? "ambiguous" : "not_found");
}

export function matchDocuments(docs: DaneaDocument[], orders: OrderSummary[]): DdtMatch[] {
  const index = buildOrderIndex(orders);
  return docs.map((d) => matchDocument(d, index));
}

/** Range Saleor da coprire: una settimana prima del primo DDT, il giorno dopo l'ultimo. */
export function rangeForDocuments(docs: DaneaDocument[]): { from: string; to: string } {
  const dates = docs.map((d) => d.date).filter(Boolean).sort();
  const shift = (day: string, days: number): string =>
    new Date(new Date(`${day}T00:00:00Z`).getTime() + days * 86_400_000).toISOString().slice(0, 10);
  if (dates.length === 0) return { from: "", to: "" };
  return { from: shift(dates[0], -7), to: shift(dates[dates.length - 1], 1) };
}
