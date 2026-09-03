import { describe, it, expect } from "vitest";
import { splitSimpleFilters } from "@/features/orders/spec-simple.js";

const options = {
  portals: [
    { slug: "iiss-majorana-brindisi", name: "I.I.S.S. Majorana - Brindisi" },
    { slug: "ic-massari-galilei", name: "I.C. Massari - Galilei" },
  ],
  agents: ["a.ravelli", "t.dicosmo", "r.russo"],
};

const spec = (all: unknown[]) => ({ all, any: [] }) as never;

// Sbagliare qui non e' cosmetico: la lista mostrerebbe un portale solo mentre
// la frase in testata dice "tutti i portali".
describe("splitSimpleFilters", () => {
  it("porta portale, agente e stato nei filtri semplici", () => {
    const out = splitSimpleFilters(
      spec([
        { field: "portaleNome", op: "contains", value: "majorana" },
        { field: "agente", op: "eq", value: "a.ravelli" },
        { field: "stato", op: "eq", value: "da-confermare" },
      ]),
      options,
    );
    expect(out).toEqual({
      portal: "iiss-majorana-brindisi",
      agent: "a.ravelli",
      status: "da-confermare",
      spec: null,
    });
  });

  it("lascia nella spec quello che i chip non sanno dire", () => {
    const out = splitSimpleFilters(
      spec([
        { field: "portaleNome", op: "contains", value: "majorana" },
        { field: "totale", op: "gte", value: 600 },
      ]),
      options,
    );
    expect(out.portal).toBe("iiss-majorana-brindisi");
    expect(out.spec?.all).toEqual([{ field: "totale", op: "gte", value: 600 }]);
  });

  it("non assorbe se la condizione e' ambigua o l'OR e' in gioco", () => {
    // "i." sta sia in Majorana che in Massari: due portali, non si tocca.
    const ambiguo = splitSimpleFilters(
      spec([{ field: "portaleNome", op: "contains", value: "i." }]),
      options,
    );
    expect(ambiguo.portal).toBe("all");
    expect(ambiguo.spec).not.toBeNull();

    const or = splitSimpleFilters(
      {
        all: [],
        any: [{ field: "portaleNome", op: "contains", value: "majorana" }],
      } as never,
      options,
    );
    expect(or.portal).toBe("all");
  });
});

import { fieldHints } from "@/features/orders/spec-simple.js";

// "ordini di ravelli" filtrato su `cliente` torna zero: senza suggerimento
// l'agente risponde "non ci sono ordini" e chiude una porta che era aperta.
describe("fieldHints", () => {
  it("riconosce il nome cercato sul campo sbagliato", () => {
    const hints = fieldHints(
      spec([{ field: "cliente", op: "contains", value: "ravelli" }]),
      options,
    );
    expect(hints).toEqual([{ campo: "agente", valore: "a.ravelli" }]);
  });

  it("non suggerisce il campo che si sta gia' usando", () => {
    expect(
      fieldHints(spec([{ field: "agente", op: "eq", value: "a.ravelli" }]), options),
    ).toEqual([]);
  });

  it("ignora i termini troppo corti", () => {
    expect(fieldHints(spec([{ field: "cliente", op: "contains", value: "a." }]), options)).toEqual(
      [],
    );
  });
});
