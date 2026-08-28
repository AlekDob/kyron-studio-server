import { describe, it, expect } from "vitest";
import { applySpec, matchesSpec, type FieldMap } from "@/core/query/spec.js";

interface Row {
  nome: string;
  totale: number;
  prodotti: string;
  note: string;
}

const FIELDS: FieldMap<Row> = {
  nome: (r) => r.nome,
  totale: (r) => r.totale,
  prodotti: (r) => r.prodotti,
  note: (r) => r.note,
};

const rows: Row[] = [
  { nome: "Rossi", totale: 599, prodotti: "MX2D3 iPad Air", note: "" },
  { nome: "Bianchi", totale: 70.4, prodotti: "MW2G3 Pencil Pro", note: "urgente" },
  { nome: "Verdi", totale: 659, prodotti: "MXYZ iPad Pro", note: "" },
];

const spec = (all: unknown[] = [], any: unknown[] = []) =>
  ({ all, any }) as Parameters<typeof applySpec<Row>>[1];

describe("query spec", () => {
  it("AND: piu' condizioni devono valere tutte", () => {
    const out = applySpec(
      rows,
      spec([
        { field: "totale", op: "gte", value: 600 },
        { field: "prodotti", op: "contains", value: "ipad" },
      ]),
      FIELDS,
    );
    expect(out.map((r) => r.nome)).toEqual(["Verdi"]);
  });

  it("OR: basta una condizione di `any`", () => {
    const out = applySpec(
      rows,
      spec(
        [],
        [
          { field: "nome", op: "contains", value: "rossi" },
          { field: "note", op: "eq", value: "urgente" },
        ],
      ),
      FIELDS,
    );
    expect(out.map((r) => r.nome)).toEqual(["Rossi", "Bianchi"]);
  });

  it("confronti numerici sul totale", () => {
    expect(applySpec(rows, spec([{ field: "totale", op: "lt", value: 100 }]), FIELDS)).toHaveLength(1);
    expect(
      applySpec(rows, spec([{ field: "totale", op: "between", value: [500, 660] }]), FIELDS),
    ).toHaveLength(2);
  });

  it("contains e' case-insensitive", () => {
    expect(matchesSpec(rows[0], spec([{ field: "prodotti", op: "contains", value: "IPAD" }]), FIELDS)).toBe(true);
  });

  it("empty / notEmpty sulle note", () => {
    expect(applySpec(rows, spec([{ field: "note", op: "notEmpty" }]), FIELDS)).toHaveLength(1);
    expect(applySpec(rows, spec([{ field: "note", op: "empty" }]), FIELDS)).toHaveLength(2);
  });

  it("confronto numerico su testo non numerico e' falso, non un crash", () => {
    expect(matchesSpec(rows[0], spec([{ field: "nome", op: "gt", value: 10 }]), FIELDS)).toBe(false);
  });

  it("campo sconosciuto: errore parlante", () => {
    expect(() =>
      applySpec(rows, spec([{ field: "pippo", op: "eq", value: "x" }]), FIELDS),
    ).toThrow(/Campo sconosciuto/);
  });

  it("sort decrescente sul totale", () => {
    const out = applySpec(rows, { all: [], any: [], sort: { field: "totale", dir: "desc" } }, FIELDS);
    expect(out.map((r) => r.totale)).toEqual([659, 599, 70.4]);
  });
});
