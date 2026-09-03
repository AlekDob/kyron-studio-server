// Storico durevole degli import Danea, su Payload (collection `danea-imports`).
//
// Lo store dell'import vive in RAM con TTL di un'ora e si azzera a ogni
// redeploy: senza questo registro nessuno sa quale listino e' stato caricato
// per ultimo, quando, e cosa ha cambiato.
//
// Regola opposta a quella di `email-log`: qui il registro e' un'annotazione, non
// un lock. Se Payload non risponde l'import va avanti lo stesso — perdere una
// riga di storico e' meno grave che bloccare un caricamento.
import { getPortalsGateway } from "@/features/portals/gateway.js";
import type { DaneaApplyResult } from "./danea-apply.js";
import type { DaneaPlan } from "./danea-plan.js";

export const DANEA_IMPORTS_COLLECTION = "danea-imports";

/** Tetto sulle righe salvate: un listino Danea sta sotto, un catalogo intero no. */
const MAX_ROWS = 1000;

export type DaneaRowStatus = "new" | "changed" | "unchanged";

export interface DaneaLogRow {
  sku: string;
  /** Nome variante per le nuove, titolo del gruppo per le altre. */
  name: string;
  /** Prezzo letto dal file Danea. `null` = riga senza prezzo nel piano. */
  priceEur: number | null;
  /** Prezzo oggi su Saleor, solo per chi esiste gia'. */
  currentPriceEur: number | null;
  productSlug: string;
  status: DaneaRowStatus;
}

/**
 * Le righe del piano appiattite, una per codice articolo. PURA.
 *
 * Le righe a prezzo zero non ci sono: `buildDaneaPlan` le scarta prima, con un
 * warning, e qui non abbiamo modo (ne' motivo) di reinventarle.
 */
export function rowsFromPlan(plan: DaneaPlan): DaneaLogRow[] {
  const rows: DaneaLogRow[] = [];
  for (const group of plan.groups) {
    for (const v of group.newVariants) {
      rows.push({
        sku: v.sku,
        name: v.name,
        priceEur: v.priceEur,
        currentPriceEur: null,
        productSlug: group.slug,
        status: "new",
      });
    }
    for (const c of group.priceChanges) {
      rows.push({
        sku: c.sku,
        name: group.suggestedName,
        priceEur: c.toEur,
        currentPriceEur: c.fromEur,
        productSlug: group.slug,
        status: "changed",
      });
    }
    for (const sku of group.unchanged) {
      rows.push({
        sku,
        name: group.suggestedName,
        priceEur: null,
        currentPriceEur: null,
        productSlug: group.slug,
        status: "unchanged",
      });
    }
  }
  return rows.slice(0, MAX_ROWS);
}

async function findId(importId: string): Promise<string | null> {
  const res = await getPortalsGateway().list(DANEA_IMPORTS_COLLECTION, {
    limit: 1,
    where: { importId: { equals: importId } },
  });
  const doc = res.data[0];
  return doc ? String(doc.id) : null;
}

function warn(step: string, err: unknown): void {
  console.warn(`[danea-log] ${step} fallito: ${err instanceof Error ? err.message : String(err)}`);
}

export interface PlanLogInput {
  importId: string;
  filename: string;
  recordCount: number;
  target: string;
  plan: DaneaPlan;
}

/** Crea o aggiorna la riga di questo import. Non lancia mai. */
export async function recordDaneaPlan(input: PlanLogInput): Promise<void> {
  const data = {
    importId: input.importId,
    filename: input.filename,
    uploadedAt: new Date().toISOString(),
    channelSlug: input.plan.channelSlug,
    target: input.target,
    recordCount: input.recordCount,
    totals: input.plan.totals,
    rows: rowsFromPlan(input.plan),
  };
  try {
    const id = await findId(input.importId);
    const gw = getPortalsGateway();
    // Un piano ricalcolato non e' un import nuovo: `uploadedAt` resta quello
    // della prima volta che abbiamo visto il file.
    if (id) {
      const { uploadedAt: _ignored, ...rest } = data;
      await gw.update(DANEA_IMPORTS_COLLECTION, id, rest);
    } else {
      await gw.create(DANEA_IMPORTS_COLLECTION, data);
    }
  } catch (err) {
    warn("scrittura piano", err);
  }
}

/** Segna che l'import e' stato applicato davvero. Non lancia mai. */
export async function recordDaneaApply(
  importId: string,
  result: DaneaApplyResult,
): Promise<void> {
  try {
    const id = await findId(importId);
    if (!id) return;
    await getPortalsGateway().update(DANEA_IMPORTS_COLLECTION, id, {
      appliedAt: new Date().toISOString(),
      applied: result,
    });
  } catch (err) {
    warn("scrittura apply", err);
  }
}

/** Ultimi import, il piu' recente per primo. */
export async function listDaneaImports(limit = 5): Promise<Record<string, unknown>[]> {
  const res = await getPortalsGateway().list(DANEA_IMPORTS_COLLECTION, {
    limit,
    sort: "-uploadedAt",
  });
  return res.data;
}
