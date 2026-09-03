// GET /api/v1/customers — vista clienti derivata dagli ordini (feature 021).
// Accesso: tutti gli utenti Studio loggati, sola lettura, come /api/v1/orders.
import { Hono } from "hono";
import { z } from "zod";
import { tenantMiddleware } from "@/core/tenant/middleware.js";
import { studioAuthMiddleware } from "@/middleware/studio-auth.js";
import { querySpecSchema, type QuerySpec } from "@/core/query/spec.js";
import { bucketTotals, filterCustomers, filterOptions } from "./query-fields.js";
import {
  appendNote,
  deleteSegment,
  getNote,
  listSegments,
  saveSegment,
} from "./store.js";
import {
  DEFAULT_DAYS,
  customerComms,
  isoDaysAgo,
  loadCustomers,
  ordersOfCustomer,
} from "./service.js";

export const customersRoute = new Hono();

customersRoute.use("*", tenantMiddleware);
customersRoute.use("*", studioAuthMiddleware);

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const dateSchema = z.string().regex(DATE_RE).optional();

const querySchema = z.object({
  from: dateSchema,
  to: dateSchema,
  portal: z.string().optional(),
  agent: z.string().optional(),
  group: z.string().optional(),
  q: z.string().optional(),
  // Query ricca composta da Bea (JSON urlencoded). Il pannello la rimanda
  // indietro cosi' com'e': e' lui a tenerla nell'URL.
  spec: z.string().optional(),
});

// Spec JSON dalla query string. "invalid" (non throw) cosi' il chiamante
// risponde 400 invece di 502: un filtro storto e' colpa di chi chiama.
function parseSpec(raw: string | undefined): QuerySpec | undefined | "invalid" {
  if (!raw) return undefined;
  try {
    const parsed = querySpecSchema.safeParse(JSON.parse(raw));
    return parsed.success ? parsed.data : "invalid";
  } catch {
    return "invalid";
  }
}

customersRoute.get("/", async (c) => {
  const parsed = querySchema.safeParse(c.req.query());
  if (!parsed.success) return c.json({ error: "invalid_query" }, 400);
  const { from, to, portal, agent, group, q, spec: rawSpec } = parsed.data;
  const fromDate = from ?? isoDaysAgo(DEFAULT_DAYS);
  const toDate = to ?? isoDaysAgo(0);
  const spec = parseSpec(rawSpec);
  if (spec === "invalid") return c.json({ error: "invalid_spec" }, 400);
  try {
    const { customers: all } = await loadCustomers(fromDate, toDate);
    // I KPI si contano PRIMA di applicare il gruppo: cliccando "Ricorrenti"
    // l'operatore deve continuare a vedere quanti sono i nuovi.
    const scoped = filterCustomers(all, { portal, agent, q }, spec);
    const customers = filterCustomers(scoped, { group });
    return c.json({
      from: fromDate,
      to: toDate,
      count: customers.length,
      buckets: bucketTotals(scoped),
      ...filterOptions(all),
      customers,
    });
  } catch (err) {
    return c.json({ error: "customers_failed", detail: String(err) }, 502);
  }
});

// --- NOTE E SEGMENTI ---------------------------------------------------
// Registrate PRIMA di `/:email`: Hono prende la prima rotta che combacia, e
// `/:email` mangerebbe anche "segments".

// PATCH /api/v1/customers/note — accoda una riga alla nota interna del cliente.
customersRoute.patch("/note", async (c) => {
  const body = await c.req.json().catch(() => null);
  const parsed = z
    .object({ email: z.string().email(), note: z.string().min(1).max(500) })
    .safeParse(body);
  if (!parsed.success) return c.json({ error: "invalid_body" }, 400);
  try {
    const note = await appendNote(parsed.data.email, parsed.data.note, c.get("studioUser").email);
    return c.json({ note });
  } catch (err) {
    return c.json({ error: "note_failed", detail: String(err) }, 502);
  }
});

customersRoute.get("/segments", async (c) => {
  try {
    return c.json({ segments: await listSegments() });
  } catch (err) {
    return c.json({ error: "segments_failed", detail: String(err) }, 502);
  }
});

customersRoute.post("/segments", async (c) => {
  const body = await c.req.json().catch(() => null);
  const parsed = z.object({ name: z.string().min(2).max(60), spec: querySpecSchema }).safeParse(body);
  if (!parsed.success) return c.json({ error: "invalid_body" }, 400);
  try {
    const segment = await saveSegment({ ...parsed.data, createdBy: c.get("studioUser").email });
    return c.json({ segment });
  } catch (err) {
    return c.json({ error: "segment_save_failed", detail: String(err) }, 502);
  }
});

customersRoute.delete("/segments/:slug", async (c) => {
  try {
    const removed = await deleteSegment(c.req.param("slug"));
    return removed ? c.json({ removed: true }) : c.json({ error: "segment_not_found" }, 404);
  } catch (err) {
    return c.json({ error: "segment_delete_failed", detail: String(err) }, 502);
  }
});

// GET /api/v1/customers/:email — scheda cliente: riga, suoi ordini, mail ricevute.
customersRoute.get("/:email", async (c) => {
  const email = decodeURIComponent(c.req.param("email")).trim().toLowerCase();
  if (!email.includes("@")) return c.json({ error: "invalid_email" }, 400);
  const from = c.req.query("from") ?? isoDaysAgo(DEFAULT_DAYS);
  const to = c.req.query("to") ?? isoDaysAgo(0);
  try {
    const { orders, customers } = await loadCustomers(from, to);
    const customer = customers.find((x) => x.email === email);
    if (!customer) return c.json({ error: "customer_not_found" }, 404);
    // Le comunicazioni non devono far cadere la scheda: Resend e Payload sono
    // fuori dal nostro controllo.
    const comms = await customerComms(email).catch((e) => {
      console.warn("[customers] comms:", String(e));
      return [];
    });
    // La nota e' best-effort come le comunicazioni: Payload giu' non deve
    // portarsi via la scheda.
    const note = await getNote(email).catch(() => null);
    return c.json({ customer, orders: ordersOfCustomer(orders, email), comms, note });
  } catch (err) {
    return c.json({ error: "customer_failed", detail: String(err) }, 502);
  }
});
