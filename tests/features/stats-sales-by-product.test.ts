import { describe, expect, it } from "vitest";
import { aggregateByProduct } from "@/features/stats-agent/sales.js";
import type { OrderSummary } from "@/core/saleor/orders.js";

const order = (o: Partial<OrderSummary>): OrderSummary =>
  ({ status: "UNFULFILLED", userEmail: "cliente@scuola.it", channelSlug: "massari", lines: [], ...o }) as OrderSummary;

const line = (name: string, quantity: number, totalGross: number) => ({ sku: name, name, quantity, totalGross });

describe("aggregateByProduct", () => {
  it("somma quantita' e fatturato, conta gli ordini una volta per prodotto", () => {
    const { orderCount, rows } = aggregateByProduct(
      [
        order({ lines: [line("iPad A16", 1, 400), line("iPad A16", 1, 400), line("Pencil", 1, 90)] }),
        order({ lines: [line("Pencil", 2, 180)] }),
      ],
      [],
    );
    expect(orderCount).toBe(2);
    // Pencil primo: 3 pezzi contro 2, e l'ordine 1 lo conta una volta sola.
    expect(rows).toEqual([
      { prodotto: "Pencil", sku: "Pencil", quantita: 3, fatturato: 270, ordini: 2 },
      { prodotto: "iPad A16", sku: "iPad A16", quantita: 2, fatturato: 800, ordini: 1 },
    ]);
  });

  it("scarta annullati, email di test e altri canali", () => {
    const orders = [
      order({ status: "CANCELED", lines: [line("iPad", 5, 100)] }),
      order({ userEmail: "gmail@alekdob.com", lines: [line("iPad", 5, 100)] }),
      order({ channelSlug: "einaudi", lines: [line("iPad", 5, 100)] }),
      order({ lines: [line("iPad", 1, 100)] }),
    ];
    const { orderCount, rows } = aggregateByProduct(orders, ["gmail@alekdob.com"], "massari");
    expect(orderCount).toBe(1);
    expect(rows[0].quantita).toBe(1);
  });
});
