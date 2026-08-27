import { describe, expect, it } from "vitest";
import type { OrderSummary } from "@/core/saleor/orders.js";
import type { DaneaDocument } from "@/features/commesso/danea-ddt.js";
import { matchDocuments, rangeForDocuments } from "@/features/orders/ddt-match.js";

function doc(p: Partial<DaneaDocument>): DaneaDocument {
  return {
    docKey: "/EC-1-2026-08-05",
    number: "1",
    numbering: "/EC",
    date: "2026-08-05",
    customerName: "Mario Rossi",
    customerEmail: "mario@example.it",
    portalSlug: "massari",
    paymentIntent: "",
    deliveryKind: "",
    meccanografico: "",
    studentNote: "",
    paymentName: "",
    totalGross: 409,
    lines: [],
    ...p,
  };
}

function order(p: Partial<OrderSummary>): OrderSummary {
  return {
    id: "T3JkZXI6MQ==",
    number: "326",
    channelSlug: "massari",
    userEmail: "mario@example.it",
    pspReference: "",
    ...p,
  } as OrderSummary;
}

describe("matchDocuments", () => {
  it("aggancia per PaymentIntent anche se l'email non torna", () => {
    const [m] = matchDocuments(
      [doc({ paymentIntent: "pi_1", customerEmail: "altra@example.it" })],
      [order({ pspReference: "pi_1", userEmail: "mario@example.it" })],
    );
    expect(m).toMatchObject({ matched: true, reason: "payment_intent", orderNumber: "326" });
  });

  it("ripiega su email + portale quando il candidato e' uno solo", () => {
    const [m] = matchDocuments([doc({})], [order({ number: "400" })]);
    expect(m).toMatchObject({ matched: true, reason: "email_portal", orderNumber: "400" });
  });

  // Due figli, stessa mail, stessa scuola: due ordini. Meglio nessun aggancio
  // che attaccare la comunicazione all'ordine dell'altro fratello.
  it("due candidati = ambiguo, mai un aggancio a caso", () => {
    const [m] = matchDocuments([doc({})], [order({ number: "1" }), order({ number: "2" })]);
    expect(m).toMatchObject({ matched: false, reason: "ambiguous", orderId: "" });
  });

  it("nessun candidato = not_found", () => {
    const [m] = matchDocuments([doc({ portalSlug: "moro" })], [order({})]);
    expect(m.reason).toBe("not_found");
  });

  it("il range copre una settimana prima e il giorno dopo", () => {
    expect(rangeForDocuments([doc({ date: "2026-08-05" }), doc({ date: "2026-08-26" })])).toEqual({
      from: "2026-07-29",
      to: "2026-08-27",
    });
    expect(rangeForDocuments([])).toEqual({ from: "", to: "" });
  });
});
