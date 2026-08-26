import { describe, expect, it } from "vitest";

// Il guard e' l'unico pezzo non banale dell'agente Statistiche: sanifica la
// query che scrive l'LLM e conta il budget della Query API PostHog.
import {
  HogqlRejected,
  assertReadOnly,
  makeQueryBudget,
} from "@/features/stats-agent/hogql-guard.js";

const OK = "SELECT count() FROM events WHERE properties.$host = 'kyronedu.it'";

describe("assertReadOnly", () => {
  it("passa una SELECT e le appende il LIMIT", () => {
    expect(assertReadOnly(OK)).toBe(`${OK} LIMIT 200`);
  });

  it("rispetta il LIMIT che c'e' gia'", () => {
    const q = `${OK} LIMIT 5`;
    expect(assertReadOnly(q)).toBe(q);
  });

  it("accetta anche le CTE (WITH)", () => {
    const q = "WITH x AS (SELECT 1) SELECT * FROM x LIMIT 1";
    expect(assertReadOnly(q)).toBe(q);
  });

  it("tollera il punto e virgola finale", () => {
    expect(assertReadOnly(`${OK} LIMIT 5;`)).toBe(`${OK} LIMIT 5`);
  });

  it.each([
    ["DROP TABLE events", "scrittura mascherata da comando"],
    [`${OK}; DELETE FROM events`, "due istruzioni"],
    ["ALTER TABLE events ADD COLUMN x Int", "DDL"],
    ["INSERT INTO events VALUES (1)", "insert"],
    ["SELECT * FROM url('http://x.dev/y', CSV)", "fonte esterna"],
    ["SELECT 1 INTO OUTFILE '/tmp/x'", "scrittura su file"],
    ["", "query vuota"],
  ])("rifiuta %s", (query) => {
    expect(() => assertReadOnly(query)).toThrow(HogqlRejected);
  });

  it("non confonde una colonna che contiene una parola vietata", () => {
    const q = "SELECT updated_at, created_at FROM events LIMIT 1";
    expect(assertReadOnly(q)).toBe(q);
  });
});

describe("makeQueryBudget", () => {
  it("lascia passare fino al tetto e poi blocca", () => {
    const budget = makeQueryBudget(40, 60 * 60_000);
    for (let i = 0; i < 40; i++) budget.take();
    expect(() => budget.take()).toThrow(/budget query PostHog esaurito/);
  });
});
