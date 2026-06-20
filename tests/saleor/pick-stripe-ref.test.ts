import { describe, it, expect } from "vitest";
import { pickStripeRef } from "@/core/saleor/orders.js";

// Regressione ordine #56: un checkout puo' generare piu' PaymentIntent. Il primo
// resta orfano (chargedAmount 0, "Incomplete" su Stripe), il secondo incassa.
// pickStripeRef deve sempre puntare alla transazione che ha davvero incassato.
describe("pickStripeRef", () => {
  it("sceglie la transazione incassata, non la prima orfana (caso #56)", () => {
    expect(
      pickStripeRef([
        { pspReference: "pi_orfano", chargedAmount: { amount: 0 } },
        { pspReference: "pi_pagato", chargedAmount: { amount: 435 } },
      ])
    ).toBe("pi_pagato");
  });

  it("ignora l'ordine degli array: incassata anche se viene prima", () => {
    expect(
      pickStripeRef([
        { pspReference: "pi_pagato", chargedAmount: { amount: 435 } },
        { pspReference: "pi_orfano", chargedAmount: { amount: 0 } },
      ])
    ).toBe("pi_pagato");
  });

  it("nessun incasso: fallback all'ultima transazione con pspReference", () => {
    expect(
      pickStripeRef([
        { pspReference: "pi_primo", chargedAmount: { amount: 0 } },
        { pspReference: "pi_ultimo", chargedAmount: { amount: 0 } },
      ])
    ).toBe("pi_ultimo");
  });

  it("scarta le transazioni senza pspReference", () => {
    expect(
      pickStripeRef([
        { pspReference: null, chargedAmount: { amount: 435 } },
        { pspReference: "pi_valido", chargedAmount: { amount: 0 } },
      ])
    ).toBe("pi_valido");
  });

  it("ritorna stringa vuota senza transazioni", () => {
    expect(pickStripeRef([])).toBe("");
    expect(pickStripeRef(null)).toBe("");
  });

  it("gestisce chargedAmount assente (campo opzionale)", () => {
    expect(pickStripeRef([{ pspReference: "pi_x" }])).toBe("pi_x");
  });
});
