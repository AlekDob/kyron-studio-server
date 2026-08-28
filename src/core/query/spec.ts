// Motore di query generico: uno schema JSON validato + il suo valutatore.
// Non sa niente di ordini. Chi lo usa porta la propria FieldMap (nome campo ->
// come si legge da una riga). Cosi' lo stesso motore serve gli ordini oggi e i
// prodotti domani, e i filtri del pannello, dell'API e dell'agente sono uno solo.
import { z } from "zod";

export const conditionSchema = z.object({
  field: z.string(),
  op: z.enum([
    "eq",
    "ne",
    "gt",
    "gte",
    "lt",
    "lte",
    "contains",
    "in",
    "between",
    "empty",
    "notEmpty",
  ]),
  value: z
    .union([
      z.string(),
      z.number(),
      z.boolean(),
      z.array(z.union([z.string(), z.number()])),
    ])
    .optional(),
});

export const querySpecSchema = z.object({
  all: z.array(conditionSchema).default([]), // AND
  any: z.array(conditionSchema).default([]), // OR, vuoto = ignorato
  sort: z
    .object({ field: z.string(), dir: z.enum(["asc", "desc"]) })
    .optional(),
});

export type Condition = z.infer<typeof conditionSchema>;
export type QuerySpec = z.infer<typeof querySpecSchema>;

export type FieldValue = string | number | boolean | null;
export type FieldMap<T> = Record<string, (row: T) => FieldValue>;

export const EMPTY_SPEC: QuerySpec = { all: [], any: [] };

/** Spec vuota = nessun filtro: si puo' saltare il giro. */
export function isEmptySpec(spec: QuerySpec | undefined): boolean {
  return !spec || (spec.all.length === 0 && spec.any.length === 0 && !spec.sort);
}

function readField<T>(row: T, field: string, fields: FieldMap<T>): FieldValue {
  const get = fields[field];
  // Campo sconosciuto: errore parlante. L'agente sbaglia il nome e lo scopre
  // subito, invece di ricevere zero righe e raccontare che non c'e' niente.
  if (!get) {
    throw new Error(
      `Campo sconosciuto: "${field}". Campi validi: ${Object.keys(fields).join(", ")}`,
    );
  }
  return get(row);
}

function text(v: FieldValue): string {
  return v === null ? "" : String(v).toLowerCase();
}

/** Numero o NaN: i confronti numerici su testo non numerico devono fallire. */
function num(v: unknown): number {
  if (typeof v === "number") return v;
  if (typeof v === "string" && v.trim() !== "") return Number(v);
  return NaN;
}

function compare(a: FieldValue, op: Condition["op"], b: unknown): boolean {
  const x = num(a);
  const y = num(b);
  if (Number.isNaN(x) || Number.isNaN(y)) return false;
  if (op === "gt") return x > y;
  if (op === "gte") return x >= y;
  if (op === "lt") return x < y;
  return x <= y;
}

function matchesCondition<T>(row: T, c: Condition, fields: FieldMap<T>): boolean {
  const raw = readField(row, c.field, fields);
  switch (c.op) {
    case "empty":
      return text(raw) === "";
    case "notEmpty":
      return text(raw) !== "";
    case "eq":
      return text(raw) === text(c.value as FieldValue);
    case "ne":
      return text(raw) !== text(c.value as FieldValue);
    case "contains":
      return text(raw).includes(text(c.value as FieldValue));
    case "in":
      return Array.isArray(c.value)
        ? c.value.some((v) => text(v) === text(raw))
        : false;
    case "between": {
      // [min, max] inclusivo. Utile su totale e su data (stringhe ISO ordinabili).
      if (!Array.isArray(c.value) || c.value.length !== 2) return false;
      const [lo, hi] = c.value;
      if (typeof raw === "string" && Number.isNaN(num(raw))) {
        return text(raw) >= text(lo) && text(raw) <= text(hi);
      }
      return compare(raw, "gte", lo) && compare(raw, "lte", hi);
    }
    default:
      return compare(raw, c.op, c.value);
  }
}

export function matchesSpec<T>(
  row: T,
  spec: QuerySpec,
  fields: FieldMap<T>,
): boolean {
  for (const c of spec.all) {
    if (!matchesCondition(row, c, fields)) return false;
  }
  if (spec.any.length > 0) {
    return spec.any.some((c) => matchesCondition(row, c, fields));
  }
  return true;
}

/** Filtro + ordinamento in un colpo solo. */
export function applySpec<T>(
  rows: T[],
  spec: QuerySpec | undefined,
  fields: FieldMap<T>,
): T[] {
  if (isEmptySpec(spec)) return rows;
  const s = spec!;
  const out = rows.filter((r) => matchesSpec(r, s, fields));
  if (!s.sort) return out;
  const { field, dir } = s.sort;
  const sign = dir === "asc" ? 1 : -1;
  return out.sort((a, b) => {
    const va = readField(a, field, fields);
    const vb = readField(b, field, fields);
    const na = num(va);
    const nb = num(vb);
    if (!Number.isNaN(na) && !Number.isNaN(nb)) return (na - nb) * sign;
    return text(va).localeCompare(text(vb)) * sign;
  });
}
