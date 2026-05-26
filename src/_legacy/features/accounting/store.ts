import { readFile, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import { invoiceSchema, type Invoice } from "./types.js";

// Brain: 002-data-layer — mock JSON oggi, swap a Supabase Postgres in M3
const here = dirname(fileURLToPath(import.meta.url));
const DATA_PATH = resolve(here, "../../../data/invoices.json");

async function loadAll(): Promise<Invoice[]> {
  const raw = await readFile(DATA_PATH, "utf8");
  const parsed = JSON.parse(raw) as unknown[];
  return parsed.map((item) => invoiceSchema.parse(item));
}

async function saveAll(invoices: Invoice[]): Promise<void> {
  await writeFile(DATA_PATH, JSON.stringify(invoices, null, 2) + "\n", "utf8");
}

export const invoicesStore = {
  list: loadAll,
  async findById(id: string): Promise<Invoice | undefined> {
    const all = await loadAll();
    return all.find((inv) => inv.id === id);
  },
  async updateCategory(id: string, category: Invoice["category"]): Promise<Invoice> {
    const all = await loadAll();
    const idx = all.findIndex((inv) => inv.id === id);
    if (idx === -1) throw new Error(`Fattura ${id} non trovata`);
    const inv = all[idx]!;
    const updated: Invoice = { ...inv, category, status: "approved" };
    all[idx] = updated;
    await saveAll(all);
    return updated;
  },
};
