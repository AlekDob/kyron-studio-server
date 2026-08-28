import { describe, it, expect } from "vitest";
import { shouldNotify, amountKey } from "@/features/orders/vat-relief-notify.js";

// Money-path: /orders/payment-total serve anche le modifiche importo generiche,
// quindi la mail deve partire SOLO su agevolazione approvata e SOLO una volta
// per importo (Nico ha cliccato due volte: una mail sola).
describe("shouldNotify (mail nuovo importo IVA 4%)", () => {
  it("invia su agevolazione approvata e importo nuovo", () => {
    expect(shouldNotify("approved", "", 629.97)).toBe(true);
    expect(shouldNotify("approved", "739.00", 629.97)).toBe(true);
  });

  it("non invia se l'agevolazione non e' approvata", () => {
    expect(shouldNotify("requested", "", 629.97)).toBe(false);
    expect(shouldNotify("rejected", "", 629.97)).toBe(false);
    expect(shouldNotify("", "", 629.97)).toBe(false);
  });

  it("non invia due volte lo stesso importo (doppio click)", () => {
    expect(shouldNotify("approved", "629.97", 629.97)).toBe(false);
    expect(shouldNotify("approved", "629.97", 629.9700001)).toBe(false);
  });

  it("non invia sulla rimozione dell'annotazione (amount 0)", () => {
    expect(shouldNotify("approved", "", 0)).toBe(false);
  });

  it("chiave a 2 decimali", () => {
    expect(amountKey(629.9)).toBe("629.90");
  });
});
