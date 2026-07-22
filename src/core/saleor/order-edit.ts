// Brain: decision-019 + gotcha-bonifico-discount-evicts-bundle-voucher.
// Editing REALE delle righe di un ordine (Parte C2, money-path). Le mutation
// order-line di Saleor 3.23 operano SOLO su ordini DRAFT/UNCONFIRMED: gli ordini
// offline (bonifico / Carta del Docente) nascono UNCONFIRMED e restano tali
// finche' non evasi -> finestra di modifica. Su un ordine confermato le modifiche
// vanno annotate per Danea (campo Note / override IVA), non applicate qui.
//
// Ogni edit di riga fa RICALCOLARE il totale a Saleor: il residuo del voucher
// bundle FIXED cambia e il totale scontato "salta". Dopo l'edit ri-forziamo il
// totale commerciale atteso riusando lo sconto MANUALE gia' presente (bonifico)
// se c'e', oppure aggiungendone uno nuovo — MAI rimuovere il voucher (auto-conferma).
import { saleorApiUrl } from "./client.js";
import { parseLineColors } from "./orders.js";

function appToken(): string {
  const token = process.env.SALEOR_APP_TOKEN;
  if (!token) throw new Error("SALEOR_APP_TOKEN missing");
  return token;
}

const round2 = (n: number): number => Math.round(n * 100) / 100;

// Esegue una query/mutation Saleor con l'app token; lancia su errori GraphQL.
async function saleorAdmin<T>(query: string, variables: unknown): Promise<T> {
  const res = await fetch(saleorApiUrl(), {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${appToken()}` },
    body: JSON.stringify({ query, variables }),
  });
  if (!res.ok) throw new Error(`Saleor ${res.status}: ${await res.text()}`);
  const json = (await res.json()) as { data?: T; errors?: Array<{ message: string }> };
  if (json.errors?.length) throw new Error(`Saleor: ${json.errors[0].message}`);
  if (!json.data) throw new Error("Saleor: empty data");
  return json.data;
}

interface Attr {
  attribute: { slug: string };
  values: Array<{ slug: string; name: string }>;
}

function attrValue(attrs: Attr[], slug: string): { slug: string; name: string } | null {
  return attrs.find((a) => a.attribute.slug === slug)?.values[0] ?? null;
}

// --- Vista editabilita' ordine -------------------------------------------------

export interface ColorOption {
  variantId: string;
  label: string; // nome colore, es. "Grigio siderale"
}

export interface EditLine {
  id: string; // order line global ID
  productName: string;
  variantName: string;
  sku: string;
  quantity: number;
  variantId: string;
  colorSlug: string; // colore corrente (per evidenziarlo)
  colorName: string; // nome colore acquistato (originale), es. "Grigio siderale"
  colorOptions: ColorOption[]; // varianti sorelle stessa capacita', colore diverso
  requestedColor: string; // colore richiesto via annotazione (kyron_line_colors), o ""
}

// Modalita' di editing riga:
// - "edit"    ordine UNCONFIRMED: modifica REALE (qty/colore) su Saleor (money-path)
// - "annotate" ordine confermato ma non spedito: cambio colore solo come ANNOTAZIONE
// - "locked"   ordine spedito/consegnato/annullato: sola lettura
export type EditMode = "edit" | "annotate" | "locked";

export interface OrderEdit {
  mode: EditMode;
  editable: boolean; // retro-compat: true solo se mode === "edit"
  status: string;
  total: number;
  lines: EditLine[];
}

const ORDER_EDIT_QUERY = `
  query OrderEdit($id: ID!) {
    order(id: $id) {
      status
      metadata { key value }
      total { gross { amount } }
      channel { slug }
      lines {
        id
        productName
        variantName
        quantity
        variant {
          id
          sku
          product { slug }
          attributes { attribute { slug } values { slug name } }
        }
      }
    }
  }`;

interface OrderEditNode {
  status: string;
  metadata: Array<{ key: string; value: string }> | null;
  total: { gross: { amount: number } };
  channel: { slug: string } | null;
  lines: Array<{
    id: string;
    productName: string;
    variantName: string;
    quantity: number;
    variant: {
      id: string;
      sku: string | null;
      product: { slug: string };
      attributes: Attr[];
    } | null;
  }>;
}

// Varianti "sorelle" di un prodotto con la stessa capacita' e colore diverso
// (cambio colore = altra variante stesso taglio). Riusa gli attributi capacita/colore
// del catalogo (client.ts). Vuoto se il prodotto non ha varianti colore.
const SIBLINGS_QUERY = `
  query Siblings($slug: String!, $channel: String!) {
    product(slug: $slug, channel: $channel) {
      variants {
        id
        attributes { attribute { slug } values { slug name } }
      }
    }
  }`;

async function colorOptionsFor(
  productSlug: string,
  channel: string,
  capacitySlug: string | null,
  currentColorSlug: string,
): Promise<ColorOption[]> {
  const data = await saleorAdmin<{
    product: { variants: Array<{ id: string; attributes: Attr[] }> } | null;
  }>(SIBLINGS_QUERY, { slug: productSlug, channel });
  const variants = data.product?.variants ?? [];
  const opts: ColorOption[] = [];
  for (const v of variants) {
    const cap = attrValue(v.attributes, "capacita");
    const color = attrValue(v.attributes, "colore");
    if (!color) continue; // prodotto senza colore -> nessuna opzione
    if (capacitySlug && cap?.slug !== capacitySlug) continue; // solo stessa capacita'
    if (color.slug === currentColorSlug) continue; // salta il colore attuale
    opts.push({ variantId: v.id, label: color.name });
  }
  return opts;
}

// Stati che bloccano ogni modifica riga (ordine gia' evaso o chiuso). Lo stato
// lavorazione Kyron (kyron_status) prevale sul flusso: "spedito" chiude la finestra.
const LOCKED_WORKFLOW = new Set(["spedito", "consegnato", "annullato"]);
const LOCKED_SALEOR = new Set(["FULFILLED", "CANCELED"]);

// Decide la modalita' di editing: reale (bozza), annotazione (confermato non spedito)
// o sola lettura (spedito/annullato). Brain: gotcha-saleor-order-line-edit-unconfirmed-only.
function editModeFor(saleorStatus: string, workflowStatus: string): EditMode {
  if (saleorStatus === "UNCONFIRMED") return "edit";
  if (LOCKED_WORKFLOW.has(workflowStatus) || LOCKED_SALEOR.has(saleorStatus)) return "locked";
  return "annotate";
}

// Vista editing di un ordine: righe con le opzioni colore disponibili. Le opzioni
// sono calcolate se l'ordine e' modificabile o annotabile (non su quelli chiusi).
export async function fetchOrderForEdit(orderId: string): Promise<OrderEdit> {
  const { order } = await saleorAdmin<{ order: OrderEditNode | null }>(ORDER_EDIT_QUERY, { id: orderId });
  if (!order) throw new Error("order not found");
  const workflowStatus = order.metadata?.find((m) => m.key === "kyron_status")?.value ?? "nuovo";
  const mode = editModeFor(order.status, workflowStatus);
  const changes = parseLineColors(order.metadata?.find((m) => m.key === "kyron_line_colors")?.value ?? "");
  const channel = order.channel?.slug ?? "";
  const lines: EditLine[] = [];
  for (const l of order.lines) {
    const v = l.variant;
    const color = v ? attrValue(v.attributes, "colore") : null;
    const cap = v ? attrValue(v.attributes, "capacita") : null;
    const sku = v?.sku ?? "";
    const colorOptions =
      mode !== "locked" && v && color
        ? await colorOptionsFor(v.product.slug, channel, cap?.slug ?? null, color.slug)
        : [];
    lines.push({
      id: l.id,
      productName: l.productName,
      variantName: l.variantName,
      sku,
      quantity: l.quantity,
      variantId: v?.id ?? "",
      colorSlug: color?.slug ?? "",
      colorName: color?.name ?? "",
      colorOptions,
      requestedColor: changes.find((c) => c.sku === sku)?.to ?? "",
    });
  }
  return {
    mode,
    editable: mode === "edit",
    status: order.status,
    total: order.total.gross.amount,
    lines,
  };
}

// --- Mutation righe ------------------------------------------------------------

const LINE_UPDATE = `
  mutation($id: ID!, $input: OrderLineInput!) {
    orderLineUpdate(id: $id, input: $input) {
      order { total { gross { amount } } }
      errors { field message }
    }
  }`;

const LINE_DELETE = `
  mutation($id: ID!) {
    orderLineDelete(id: $id) { order { id } errors { field message } }
  }`;

// Saleor 3.23: la mutation e' orderLinesCreate (non orderLinesAdd).
const LINES_CREATE = `
  mutation($id: ID!, $input: [OrderLineCreateInput!]!) {
    orderLinesCreate(id: $id, input: $input) {
      order { total { gross { amount } } }
      errors { field message }
    }
  }`;

type MutErrors = { errors: Array<{ field: string; message: string }> };

function throwOnErrors(payload: MutErrors, op: string): void {
  if (payload.errors?.length) {
    throw new Error(`${op}: ${payload.errors.map((e) => `[${e.field}] ${e.message}`).join(", ")}`);
  }
}

// Cambia la quantita' di una riga (solo ordini UNCONFIRMED). Mantiene costante il
// prezzo unitario pagato: expectedTotal = pagato/unita' * nuova quantita' sul resto.
export async function updateLineQuantity(
  orderId: string,
  lineId: string,
  quantity: number,
): Promise<number> {
  const before = await fetchEditContext(orderId);
  const line = before.lines.find((l) => l.id === lineId);
  if (!line) throw new Error("line not found");
  const unitPaid = line.quantity > 0 ? line.paidTotal / line.quantity : 0;
  const data = await saleorAdmin<{ orderLineUpdate: MutErrors }>(LINE_UPDATE, {
    id: lineId,
    input: { quantity },
  });
  throwOnErrors(data.orderLineUpdate, "orderLineUpdate");
  const expected = round2(before.total - line.paidTotal + unitPaid * quantity);
  return readjustTotal(orderId, expected);
}

// Cambia la variante (colore) di una riga: Saleor non permette lo swap in-place,
// quindi si aggiunge la nuova variante e si cancella la vecchia. Ordine SICURO
// (add PRIMA di delete): se l'add fallisce la riga originale resta intatta, invece
// di perderla. Il totale commerciale resta invariato (il colore non cambia prezzo):
// lo ri-forziamo al valore pre-edit.
export async function changeLineVariant(
  orderId: string,
  lineId: string,
  newVariantId: string,
  quantity: number,
): Promise<number> {
  const before = await fetchEditContext(orderId);
  const add = await saleorAdmin<{ orderLinesCreate: MutErrors }>(LINES_CREATE, {
    id: orderId,
    input: [{ variantId: newVariantId, quantity }],
  });
  throwOnErrors(add.orderLinesCreate, "orderLinesCreate");
  const del = await saleorAdmin<{ orderLineDelete: MutErrors }>(LINE_DELETE, { id: lineId });
  throwOnErrors(del.orderLineDelete, "orderLineDelete");
  return readjustTotal(orderId, before.total);
}

// --- Re-adjust totale (money-path) ---------------------------------------------

interface EditContext {
  total: number;
  undiscountedTotal: number;
  manualDiscountId: string | null;
  lines: Array<{ id: string; quantity: number; paidTotal: number }>;
}

const EDIT_CONTEXT_QUERY = `
  query($id: ID!) {
    order(id: $id) {
      total { gross { amount } }
      undiscountedTotal { gross { amount } }
      discounts { id type }
      lines { id quantity totalPrice { gross { amount } } }
    }
  }`;

async function fetchEditContext(orderId: string): Promise<EditContext> {
  const { order } = await saleorAdmin<{
    order: {
      total: { gross: { amount: number } };
      undiscountedTotal: { gross: { amount: number } };
      discounts: Array<{ id: string; type: string }>;
      lines: Array<{ id: string; quantity: number; totalPrice: { gross: { amount: number } } }>;
    } | null;
  }>(EDIT_CONTEXT_QUERY, { id: orderId });
  if (!order) throw new Error("order not found");
  const manual = order.discounts.find((d) => d.type === "MANUAL");
  return {
    total: order.total.gross.amount,
    undiscountedTotal: order.undiscountedTotal.gross.amount,
    manualDiscountId: manual?.id ?? null,
    lines: order.lines.map((l) => ({ id: l.id, quantity: l.quantity, paidTotal: l.totalPrice.gross.amount })),
  };
}

const DISCOUNT_ADD = `
  mutation($orderId: ID!, $input: OrderDiscountCommonInput!) {
    orderDiscountAdd(orderId: $orderId, input: $input) {
      order { total { gross { amount } } discounts { id type } }
      errors { field message }
    }
  }`;

const DISCOUNT_UPDATE = `
  mutation($discountId: ID!, $input: OrderDiscountCommonInput!) {
    orderDiscountUpdate(discountId: $discountId, input: $input) {
      order { total { gross { amount } } }
      errors { field message }
    }
  }`;

// Forza order.total su expectedTotal riusando lo sconto MANUALE esistente (se c'e',
// es. bonifico) o aggiungendone uno. Misura-e-correggi (max 2 iterazioni): il residuo
// del voucher bundle e' costante, quindi converge. Errori non silenziosi (money-path).
async function readjustTotal(orderId: string, expectedTotal: number): Promise<number> {
  const ctx = await fetchEditContext(orderId);
  const reason = "Rettifica ordine (Studio)";
  let amount = round2(ctx.undiscountedTotal - expectedTotal);
  if (amount <= 0) return ctx.total; // nessuno sconto necessario
  let discountId = ctx.manualDiscountId;
  let total = discountId
    ? await applyDiscountUpdate(discountId, amount, reason)
    : await applyDiscountAdd(orderId, amount, reason).then((r) => {
        discountId = r.discountId;
        return r.total;
      });
  for (let i = 0; i < 2 && discountId && Math.abs(total - expectedTotal) >= 0.01; i++) {
    amount = round2(amount + (total - expectedTotal));
    if (amount <= 0 || amount >= ctx.undiscountedTotal) break;
    total = await applyDiscountUpdate(discountId, amount, reason);
  }
  return total;
}

async function applyDiscountAdd(
  orderId: string,
  amount: number,
  reason: string,
): Promise<{ total: number; discountId: string | null }> {
  const data = await saleorAdmin<{
    orderDiscountAdd: {
      order: { total: { gross: { amount: number } }; discounts: Array<{ id: string; type: string }> } | null;
    } & MutErrors;
  }>(DISCOUNT_ADD, { orderId, input: { valueType: "FIXED", value: amount, reason } });
  throwOnErrors(data.orderDiscountAdd, "orderDiscountAdd");
  const order = data.orderDiscountAdd.order!;
  const manual = order.discounts.find((d) => d.type === "MANUAL") ?? order.discounts[0];
  return { total: order.total.gross.amount, discountId: manual?.id ?? null };
}

async function applyDiscountUpdate(discountId: string, amount: number, reason: string): Promise<number> {
  const data = await saleorAdmin<{
    orderDiscountUpdate: { order: { total: { gross: { amount: number } } } | null } & MutErrors;
  }>(DISCOUNT_UPDATE, { discountId, input: { valueType: "FIXED", value: amount, reason } });
  throwOnErrors(data.orderDiscountUpdate, "orderDiscountUpdate");
  return data.orderDiscountUpdate.order!.total.gross.amount;
}
