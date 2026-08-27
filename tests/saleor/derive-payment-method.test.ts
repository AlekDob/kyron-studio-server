import { describe, it, expect } from "vitest";
import { derivePaymentMethod, type OrderNode } from "@/core/saleor/orders.js";

// Regressione ordine #495: i metadata di pagamento si sono persi in scrittura
// (race updateMetadata/deleteMetadata sul checkout) e Studio, che gatava la
// sezione su `paymentMethod`, non mostrava piu' il bottone per riscattare il
// buono Carta del Docente. Il metodo va dedotto quando il metadata manca.
function order(p: Partial<OrderNode>): OrderNode {
  return {
    metadata: [],
    paymentStatus: "FULLY_CHARGED",
    transactions: [],
    channel: { slug: "einaudi", name: "Einaudi" },
    ...p,
  } as OrderNode;
}

describe("derivePaymentMethod", () => {
  it("usa il metadata quando c'e'", () => {
    expect(
      derivePaymentMethod(order({ metadata: [{ key: "paymentMethod", value: "bank-transfer" }] }))
    ).toBe("bank-transfer");
  });

  it("caso #495: canale carta-docente senza metadata -> teacher-card", () => {
    expect(
      derivePaymentMethod(
        order({
          channel: { slug: "carta-docente", name: "Carta del Docente" },
          paymentStatus: "PARTIALLY_CHARGED",
          transactions: [{ pspReference: "pi_123", chargedAmount: { amount: 540.55 } }],
        })
      )
    ).toBe("teacher-card");
  });

  it("chiavi teacherCard* senza paymentMethod -> teacher-card", () => {
    expect(
      derivePaymentMethod(order({ metadata: [{ key: "teacherCardAmount", value: "317" }] }))
    ).toBe("teacher-card");
  });

  it("ordine mai addebitato e senza Stripe -> bonifico", () => {
    expect(derivePaymentMethod(order({ paymentStatus: "NOT_CHARGED" }))).toBe("bank-transfer");
  });

  it("ordine pagato con carta resta senza metodo offline", () => {
    expect(derivePaymentMethod(order({}))).toBe("");
  });
});
