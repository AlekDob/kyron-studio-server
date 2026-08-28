import { Hono } from "hono";
import { z } from "zod";
import { studioAuthMiddleware } from "@/middleware/studio-auth.js";
import { requireAdmin } from "@/middleware/require-admin.js";
import { tenantMiddleware } from "@/core/tenant/middleware.js";
import { fetchOrdersForRange } from "@/core/saleor/orders.js";
import { listForOrder } from "./email-log.js";
import { sendDdtTestMail } from "./ddt-mailing.js";
import {
  buildPortalIndex,
  enrichOrder,
  type PortalMeta,
} from "./enrich.js";
import { querySpecSchema, type QuerySpec } from "@/core/query/spec.js";
import { bucketTotals, filterOptions, filterOrders } from "./query-fields.js";
import {
  setWorkflowStatus,
  isWorkflowStatus,
} from "./status.js";
import { markTeacherCardAcquired } from "./teacher-card.js";
import { markBankTransferPaid, markResidualBankTransferPaid } from "./bank-transfer.js";
import { setOrderMeta } from "@/core/saleor/orders.js";
import {
  fetchOrderForEdit,
  updateLineQuantity,
  changeLineVariant,
  setOrderTotal,
} from "@/core/saleor/order-edit.js";
import { setLineColor } from "./line-color.js";
import { notifyVatReliefAmount } from "./vat-relief-notify.js";

// GET /api/v1/orders?from=YYYY-MM-DD&to=YYYY-MM-DD&portal=slug&agent=email
// Vista situazione ordini per i commerciali (feature 008). Accesso: tutti gli
// utenti Studio loggati (read-only, no requireAdmin). Brain: feature 007 (ordini Saleor).
const ordersRoute = new Hono();

ordersRoute.use("*", tenantMiddleware);
ordersRoute.use("*", studioAuthMiddleware);

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const dateSchema = z.string().regex(DATE_RE).optional();

const querySchema = z.object({
  from: dateSchema,
  to: dateSchema,
  portal: z.string().optional(),
  agent: z.string().optional(),
  status: z.string().optional(),
  q: z.string().optional(),
  // Query ricca composta da Nico (JSON urlencoded). Il pannello la rimanda
  // indietro cosi' com'e': e' lui a tenerla nell'URL.
  spec: z.string().optional(),
});

// Email degli ordini di test interni, esclusi dalla vista (riusa la stessa env
// del report giornaliero, feature 007).
function excludedEmails(): string[] {
  return (
    process.env.ORDERS_REPORT_EXCLUDE_EMAILS ??
    "alekdobrohotov@gmail.com,gmail@alekdob.com"
  )
    .split(",")
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean);
}

// Data UTC YYYY-MM-DD a `days` giorni fa (0 = oggi).
function isoDaysAgo(days: number): string {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() - days);
  return d.toISOString().slice(0, 10);
}

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

ordersRoute.get("/", async (c) => {
  const parsed = querySchema.safeParse(c.req.query());
  if (!parsed.success) {
    return c.json({ error: "invalid_query" }, 400);
  }
  const { from, to, portal, agent, status, q, spec: rawSpec } = parsed.data;
  const fromDate = from ?? isoDaysAgo(30);
  const toDate = to ?? isoDaysAgo(0);
  const spec = parseSpec(rawSpec);
  if (spec === "invalid") return c.json({ error: "invalid_spec" }, 400);
  try {
    // L'arricchimento portali (Payload) non deve far cadere la lista ordini:
    // se Payload non e' raggiungibile, si degrada a indice vuoto (agente/cod.
    // meccanografico vuoti) invece di restituire 502.
    let index = new Map<string, PortalMeta>();
    try {
      index = await buildPortalIndex();
    } catch (e) {
      console.warn("[orders] portal index unavailable, continuing:", String(e));
    }
    const exclude = excludedEmails();
    const all = (await fetchOrdersForRange(fromDate, toDate))
      .filter((o) => !exclude.includes(o.userEmail.toLowerCase()))
      .map((o) => enrichOrder(o, index));
    // I KPI si contano PRIMA di applicare lo stato: cliccando "Confermati"
    // l'operatore deve continuare a vedere quanti sono gli altri.
    const scoped = filterOrders(all, { portal, agent, q }, spec);
    const orders = filterOrders(scoped, { status });
    return c.json({
      from: fromDate,
      to: toDate,
      count: orders.length,
      totalGross: orders.reduce((sum, o) => sum + o.totalGross, 0),
      buckets: bucketTotals(scoped),
      ...filterOptions(all),
      orders,
    });
  } catch (err) {
    return c.json({ error: "orders_failed", detail: String(err) }, 502);
  }
});

// PATCH /api/v1/orders/status — cambia lo stato lavorazione (tutti gli utenti).
// Body { id, status }. Se status="spedito" prova la notifica (gato allowlist).
const statusSchema = z.object({ id: z.string().min(1), status: z.string() });

ordersRoute.patch("/status", async (c) => {
  const body = await c.req.json().catch(() => null);
  const parsed = statusSchema.safeParse(body);
  if (!parsed.success || !isWorkflowStatus(parsed.data.status)) {
    return c.json({ error: "invalid_status" }, 400);
  }
  try {
    const result = await setWorkflowStatus(parsed.data.id, parsed.data.status);
    return c.json({ ok: true, ...result });
  } catch (err) {
    return c.json({ error: "status_failed", detail: String(err) }, 502);
  }
});

// POST /api/v1/orders/teacher-card-acquired — segna il buono Carta del Docente
// come acquisito (metadata) e manda la mail di conferma al cliente (decision-019).
const acquiredSchema = z.object({ id: z.string().min(1) });

ordersRoute.post("/teacher-card-acquired", async (c) => {
  const body = await c.req.json().catch(() => null);
  const parsed = acquiredSchema.safeParse(body);
  if (!parsed.success) {
    return c.json({ error: "invalid_body" }, 400);
  }
  try {
    const result = await markTeacherCardAcquired(parsed.data.id);
    return c.json({ ok: true, ...result });
  } catch (err) {
    return c.json({ error: "acquired_failed", detail: String(err) }, 502);
  }
});

// POST /api/v1/orders/bank-transfer-paid — segna il bonifico come incassato:
// marca l'ordine pagato in Saleor (orderMarkAsPaid) + metadata + mail al cliente.
ordersRoute.post("/bank-transfer-paid", async (c) => {
  const body = await c.req.json().catch(() => null);
  const parsed = acquiredSchema.safeParse(body);
  if (!parsed.success) {
    return c.json({ error: "invalid_body" }, 400);
  }
  try {
    const result = await markBankTransferPaid(parsed.data.id);
    return c.json({ ok: true, ...result });
  } catch (err) {
    return c.json({ error: "paid_failed", detail: String(err) }, 502);
  }
});

// POST /api/v1/orders/teacher-card-residual-paid — pagamento misto tranche 2:
// il team ha incassato il residuo bonifico dopo il buono. Marca pagato (decision-019).
ordersRoute.post("/teacher-card-residual-paid", async (c) => {
  const body = await c.req.json().catch(() => null);
  const parsed = acquiredSchema.safeParse(body);
  if (!parsed.success) {
    return c.json({ error: "invalid_body" }, 400);
  }
  try {
    const result = await markResidualBankTransferPaid(parsed.data.id);
    return c.json({ ok: true, ...result });
  } catch (err) {
    return c.json({ error: "paid_failed", detail: String(err) }, 502);
  }
});

// PATCH /api/v1/orders/note — nota libera dell'operatore (metadata kyron_note),
// visibile in Studio e riportata nelle FootNotes dell'export Danea (Parte B).
const noteSchema = z.object({ id: z.string().min(1), note: z.string().max(2000) });

ordersRoute.patch("/note", async (c) => {
  const body = await c.req.json().catch(() => null);
  const parsed = noteSchema.safeParse(body);
  if (!parsed.success) {
    return c.json({ error: "invalid_body" }, 400);
  }
  try {
    await setOrderMeta(parsed.data.id, "kyron_note", parsed.data.note);
    return c.json({ ok: true, note: parsed.data.note });
  } catch (err) {
    return c.json({ error: "note_failed", detail: String(err) }, 502);
  }
});

// PATCH /api/v1/orders/vat-override — aliquota IVA forzata a livello ordine
// (metadata kyron_vat_override), letta dall'export Danea (Parte C1, annotazione).
// Stringa vuota = rimuovi override. Vale l'intero ordine (granularita' semplice).
const vatSchema = z.object({ id: z.string().min(1), vat: z.string().max(8) });

ordersRoute.patch("/vat-override", async (c) => {
  const body = await c.req.json().catch(() => null);
  const parsed = vatSchema.safeParse(body);
  if (!parsed.success) {
    return c.json({ error: "invalid_body" }, 400);
  }
  try {
    await setOrderMeta(parsed.data.id, "kyron_vat_override", parsed.data.vat);
    return c.json({ ok: true, vat: parsed.data.vat });
  } catch (err) {
    return c.json({ error: "vat_failed", detail: String(err) }, 502);
  }
});

// PATCH /api/v1/orders/vat-agevolata — valida la richiesta di IVA agevolata 4%
// arrivata dal checkout (feature 002). approve = status "approved" (l'export Danea
// applica il 4%); reject = status "rejected" + rimuove kyron_vat_override (torna
// 22%). NON tocca il totale: il riallineo importo lo fa l'operatore in UI
// (proposta 4% pre-compilata, poi conferma/modifica via /payment-total).
const vatAgevolataSchema = z.object({
  id: z.string().min(1),
  action: z.enum(["approve", "reject"]),
});

ordersRoute.patch("/vat-agevolata", async (c) => {
  const body = await c.req.json().catch(() => null);
  const parsed = vatAgevolataSchema.safeParse(body);
  if (!parsed.success) {
    return c.json({ error: "invalid_body" }, 400);
  }
  const { id, action } = parsed.data;
  try {
    if (action === "approve") {
      await setOrderMeta(id, "kyron_vat_agevolata_status", "approved");
    } else {
      // Rifiuto: torna all'aliquota standard (rimuove l'override 4%).
      await setOrderMeta(id, "kyron_vat_agevolata_status", "rejected");
      await setOrderMeta(id, "kyron_vat_override", "");
    }
    return c.json({ ok: true, status: action === "approve" ? "approved" : "rejected" });
  } catch (err) {
    return c.json({ error: "vat_agevolata_failed", detail: String(err) }, 502);
  }
});

// PATCH /api/v1/orders/payment-total — allinea il totale dell'ordine (es. IVA 22%
// -> 4%). Ibrido: ordine UNCONFIRMED = cambio reale (money-path), confermato =
// annotazione kyron_payment_amount_override, spedito/annullato = 409. amount<=0
// rimuove l'annotazione. Brain: decision-019 (money-path + annotazione).
const paymentTotalSchema = z.object({ id: z.string().min(1), amount: z.number().min(0) });

ordersRoute.patch("/payment-total", async (c) => {
  const body = await c.req.json().catch(() => null);
  const parsed = paymentTotalSchema.safeParse(body);
  if (!parsed.success) {
    return c.json({ error: "invalid_body" }, 400);
  }
  try {
    const result = await setOrderTotal(parsed.data.id, parsed.data.amount);
    // Feature 002: se l'ordine ha l'IVA agevolata approvata, il cliente riceve il
    // nuovo importo. Best-effort: la mail non deve far fallire l'allineamento.
    let emailed = false;
    try {
      emailed = await notifyVatReliefAmount(parsed.data.id, parsed.data.amount);
    } catch (e) {
      console.warn("[payment-total] vat relief email failed:", String(e));
    }
    return c.json({ ok: true, ...result, emailed });
  } catch (err) {
    const msg = String(err);
    if (msg.includes("order locked")) return c.json({ error: "order_locked" }, 409);
    return c.json({ error: "payment_total_failed", detail: msg }, 502);
  }
});

// GET /api/v1/orders/comms?number=326 — comunicazioni gia' inviate al cliente
// di quell'ordine (registro `email-log` su Payload). Sola lettura, per il drawer.
ordersRoute.get("/comms", async (c) => {
  const number = c.req.query("number");
  if (!number) return c.json({ error: "invalid_query" }, 400);
  try {
    return c.json({ comms: await listForOrder(number) });
  } catch (err) {
    return c.json({ error: "comms_failed", detail: String(err) }, 502);
  }
});

// POST /api/v1/orders/ddt-test-mail — manda UNA mail di prova con la
// comunicazione DDT che l'operatore sta guardando nella card. Admin-only:
// tutte le altre rotte di questo file sono in lettura, questa invia davvero.
const testMailSchema = z.object({
  importId: z.string().min(1),
  campaignId: z.string().min(1),
  subject: z.string().min(1),
  heading: z.string().min(1),
  paragraphs: z.array(z.string()).min(1),
  previewIndex: z.number().int().min(0).default(0),
  to: z.string().min(3),
});

ordersRoute.post("/ddt-test-mail", requireAdmin, async (c) => {
  const parsed = testMailSchema.safeParse(await c.req.json().catch(() => null));
  if (!parsed.success) return c.json({ error: "invalid_body" }, 400);
  const { importId, campaignId, subject, heading, paragraphs, previewIndex, to } = parsed.data;
  try {
    const res = await sendDdtTestMail({
      importId,
      campaignId,
      campaign: { subject, heading, paragraphs },
      previewIndex,
      to,
    });
    // Chi ha mandato cosa a chi: una prova resta pur sempre una mail vera.
    console.log(`[ddt-test-mail] ${c.get("studioUser").email} -> ${res.to} (${res.docKey})`);
    return c.json({ ok: true, ...res });
  } catch (err) {
    return c.json({ error: "test_mail_failed", detail: String(err) }, 502);
  }
});

// GET /api/v1/orders/edit?id=... — vista editing riga (Parte C2). Ritorna
// editable=true solo per ordini UNCONFIRMED + le opzioni colore per riga.
ordersRoute.get("/edit", async (c) => {
  const id = c.req.query("id");
  if (!id) return c.json({ error: "invalid_query" }, 400);
  try {
    return c.json(await fetchOrderForEdit(id));
  } catch (err) {
    return c.json({ error: "edit_view_failed", detail: String(err) }, 502);
  }
});

// POST /api/v1/orders/line — editing reale riga su ordine UNCONFIRMED (money-path):
// cambio quantita' (quantity) o cambio colore/variante (variantId). Dopo l'edit
// ri-forza il totale commerciale. Saleor rifiuta se l'ordine non e' editabile.
const lineSchema = z
  .object({
    id: z.string().min(1), // order global ID
    lineId: z.string().min(1),
    quantity: z.number().int().positive().optional(),
    variantId: z.string().min(1).optional(),
  })
  .refine((v) => v.quantity !== undefined || v.variantId !== undefined, {
    message: "quantity or variantId required",
  });

ordersRoute.post("/line", async (c) => {
  const body = await c.req.json().catch(() => null);
  const parsed = lineSchema.safeParse(body);
  if (!parsed.success) {
    return c.json({ error: "invalid_body" }, 400);
  }
  const { id, lineId, quantity, variantId } = parsed.data;
  try {
    // Cambio variante prevale sul cambio quantita' (il colore porta la sua qty).
    const total = variantId
      ? await changeLineVariant(id, lineId, variantId, quantity ?? 1)
      : await updateLineQuantity(id, lineId, quantity!);
    return c.json({ ok: true, total });
  } catch (err) {
    return c.json({ error: "line_edit_failed", detail: String(err) }, 502);
  }
});

// POST /api/v1/orders/line-color — cambio colore come ANNOTAZIONE su ordini
// confermati (decision-019). NON tocca Saleor: salva l'acquisto originale + il colore
// richiesto in metadata pubblico (kyron_line_colors), visibile in Studio, area ordini
// cliente ed export Danea. `to` vuoto = rimuove l'annotazione (torna all'originale).
const lineColorSchema = z.object({
  id: z.string().min(1),
  sku: z.string().min(1),
  product: z.string().min(1),
  from: z.string().max(120).default(""),
  to: z.string().max(120), // "" = rimuove
});

ordersRoute.post("/line-color", async (c) => {
  const body = await c.req.json().catch(() => null);
  const parsed = lineColorSchema.safeParse(body);
  if (!parsed.success) {
    return c.json({ error: "invalid_body" }, 400);
  }
  const { id, ...change } = parsed.data;
  try {
    const changes = await setLineColor(id, change);
    return c.json({ ok: true, changes });
  } catch (err) {
    return c.json({ error: "line_color_failed", detail: String(err) }, 502);
  }
});

export { ordersRoute };
