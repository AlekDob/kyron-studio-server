import { describe, it, expect } from "vitest";
import { buildCustomers } from "@/features/customers/derive.js";
import type { EnrichedOrder } from "@/features/orders/enrich.js";
import { bucketTotals, filterCustomers } from "@/features/customers/query-fields.js";

// Fixture minima: solo i campi che la derivazione legge davvero. Il cast tiene
// fuori le 40 colonne dell'ordine Saleor che qui non servono.
function order(partial: Partial<EnrichedOrder>): EnrichedOrder {
  return {
    number: "1",
    created: "2026-08-01T10:00:00Z",
    userEmail: "mario@example.com",
    customerName: "Mario Rossi",
    customerPhone: "",
    customerAddress: "",
    companyName: "",
    fiscalCode: "",
    vatNumber: "",
    studentName: "",
    channelSlug: "massari",
    portalName: "IISS Massari",
    agent: "r.russo@kyronedu.it",
    totalGross: 100,
    currency: "EUR",
    status: "UNFULFILLED",
    workflowStatus: "nuovo",
    lines: [],
    ...partial,
  } as EnrichedOrder;
}

const NOW = new Date("2026-08-31T12:00:00Z");

describe("buildCustomers", () => {
  it("la stessa mail con maiuscole diverse e' un cliente solo", () => {
    const rows = buildCustomers(
      [
        order({ number: "1", userEmail: "Mario@Example.com" }),
        order({ number: "2", userEmail: "mario@example.com", created: "2026-08-10T10:00:00Z" }),
      ],
      { now: NOW },
    );
    expect(rows).toHaveLength(1);
    expect(rows[0].email).toBe("mario@example.com");
    expect(rows[0].orders).toBe(2);
    expect(rows[0].isReturning).toBe(true);
  });

  it("le mail interne non entrano", () => {
    const rows = buildCustomers(
      [order({ userEmail: "gmail@alekdob.com" }), order({ userEmail: "vera@example.com" })],
      { exclude: ["GMAIL@alekdob.com"], now: NOW },
    );
    expect(rows.map((r) => r.email)).toEqual(["vera@example.com"]);
  });

  it("lo speso e' la somma dei lordi, gli annullati fuori", () => {
    const rows = buildCustomers(
      [
        order({ number: "1", totalGross: 120.5 }),
        order({ number: "2", totalGross: 79.5, created: "2026-08-05T10:00:00Z" }),
        order({ number: "3", totalGross: 999, status: "CANCELED", created: "2026-08-06T10:00:00Z" }),
      ],
      { now: NOW },
    );
    expect(rows[0].totalSpent).toBe(200);
    expect(rows[0].orders).toBe(2);
    expect(rows[0].canceled).toBe(1);
  });

  it("i dati di contatto vengono dall'ordine piu' recente", () => {
    const rows = buildCustomers(
      [
        order({ created: "2026-08-01T10:00:00Z", customerPhone: "111", channelSlug: "massari" }),
        order({ created: "2026-08-20T10:00:00Z", customerPhone: "222", channelSlug: "moro", portalName: "Moro" }),
      ],
      { now: NOW },
    );
    expect(rows[0].phone).toBe("222");
    expect(rows[0].portals.map((p) => p.slug).sort()).toEqual(["massari", "moro"]);
    expect(rows[0].firstOrder).toBe("2026-08-01T10:00:00Z");
    expect(rows[0].lastOrder).toBe("2026-08-20T10:00:00Z");
  });

  it("nuovo = primo ordine entro 30 giorni", () => {
    const rows = buildCustomers(
      [
        order({ userEmail: "vecchio@x.it", created: "2026-01-10T10:00:00Z" }),
        order({ userEmail: "nuovo@x.it", created: "2026-08-25T10:00:00Z" }),
      ],
      { now: NOW },
    );
    const byEmail = new Map(rows.map((r) => [r.email, r.isNew]));
    expect(byEmail.get("nuovo@x.it")).toBe(true);
    expect(byEmail.get("vecchio@x.it")).toBe(false);
  });
});

describe("filtri clienti", () => {
  const rows = buildCustomers(
    [
      order({ userEmail: "a@x.it", channelSlug: "massari", totalGross: 1500 }),
      order({ userEmail: "b@x.it", channelSlug: "moro", portalName: "Moro", totalGross: 300 }),
      order({ userEmail: "b@x.it", channelSlug: "moro", portalName: "Moro", totalGross: 300, created: "2026-08-09T10:00:00Z", number: "9" }),
    ],
    { now: NOW },
  );

  it("il portale filtra anche se il cliente ne ha piu' di uno", () => {
    expect(filterCustomers(rows, { portal: "moro" }).map((r) => r.email)).toEqual(["b@x.it"]);
  });

  it("ricorrenti = piu' di un ordine valido", () => {
    expect(filterCustomers(rows, { group: "ricorrenti" }).map((r) => r.email)).toEqual(["b@x.it"]);
  });

  it("la spec dell'agente si somma ai filtri del pannello", () => {
    const out = filterCustomers(rows, {}, { all: [{ field: "speso", op: "gt", value: 1000 }], any: [] });
    expect(out.map((r) => r.email)).toEqual(["a@x.it"]);
  });

  it("i bucket contano nuovi e ricorrenti in modo indipendente", () => {
    const b = bucketTotals(rows);
    expect(b.all.count).toBe(2);
    expect(b.ricorrenti.count).toBe(1);
    expect(b.all.eur).toBe(2100);
  });
});
