// Note interne e segmenti salvati dei clienti (feature 021).
//
// studio-server non ha database e il filesystem si azzera a ogni redeploy: il
// posto durevole e' Payload, come per `email-log`. Due collection nuove,
// nessuna colonna su tabelle esistenti.
import { getPortalsGateway } from "@/features/portals/gateway.js";
import type { QuerySpec } from "@/core/query/spec.js";

const NOTES = "customer-notes";
const SEGMENTS = "customer-segments";

export interface CustomerNote {
  email: string;
  note: string;
  updatedBy: string;
  updatedAt: string;
}

export interface CustomerSegment {
  id: string;
  name: string;
  slug: string;
  spec: QuerySpec;
  createdBy: string;
  updatedAt: string;
}

const norm = (email: string): string => email.trim().toLowerCase();

/** Riga nota di un cliente, o null. L'email e' unique: al massimo una. */
async function findNote(email: string): Promise<Record<string, unknown> | null> {
  const res = await getPortalsGateway().list(NOTES, {
    limit: 1,
    where: { email: { equals: norm(email) } },
  });
  return res.data[0] ?? null;
}

/** La nota del cliente. Payload giu' = nessuna nota, non scheda rotta. */
export async function getNote(email: string): Promise<CustomerNote | null> {
  const doc = await findNote(email);
  if (!doc) return null;
  return {
    email: String(doc.email ?? ""),
    note: String(doc.note ?? ""),
    updatedBy: String(doc.updatedBy ?? ""),
    updatedAt: String(doc.updatedAt ?? ""),
  };
}

/**
 * Accoda una riga alla nota. Mai sovrascrivere: la nota e' condivisa tra
 * colleghi (stessa regola di `add_order_note`).
 */
export async function appendNote(email: string, text: string, author: string): Promise<CustomerNote> {
  const existing = await findNote(email);
  const prev = existing ? String(existing.note ?? "") : "";
  const note = prev ? `${prev}\n${text}` : text;
  const data = { email: norm(email), note, updatedBy: author };
  if (existing) await getPortalsGateway().update(NOTES, String(existing.id), data);
  else await getPortalsGateway().create(NOTES, data);
  return { ...data, updatedAt: new Date().toISOString() };
}

const toSegment = (doc: Record<string, unknown>): CustomerSegment => ({
  id: String(doc.id ?? ""),
  name: String(doc.name ?? ""),
  slug: String(doc.slug ?? ""),
  spec: (doc.spec ?? {}) as QuerySpec,
  createdBy: String(doc.createdBy ?? ""),
  updatedAt: String(doc.updatedAt ?? ""),
});

export async function listSegments(): Promise<CustomerSegment[]> {
  const res = await getPortalsGateway().list(SEGMENTS, { limit: 100, sort: "name" });
  return res.data.map(toSegment);
}

export async function getSegment(slug: string): Promise<CustomerSegment | null> {
  const res = await getPortalsGateway().list(SEGMENTS, { limit: 1, where: { slug: { equals: slug } } });
  return res.data[0] ? toSegment(res.data[0]) : null;
}

/** Slug dal nome: e' l'identita' del segmento, e serve a riconoscerlo a colpo d'occhio. */
export function slugify(name: string): string {
  return name
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 60);
}

/** Salva o aggiorna un segmento. Stesso slug = si sovrascrive la spec, non si duplica. */
export async function saveSegment(input: {
  name: string;
  spec: QuerySpec;
  createdBy: string;
}): Promise<CustomerSegment> {
  const slug = slugify(input.name);
  if (!slug) throw new Error("nome segmento non valido");
  const existing = await getSegment(slug);
  const data = { name: input.name, slug, spec: input.spec, createdBy: input.createdBy };
  const res = existing
    ? await getPortalsGateway().update(SEGMENTS, existing.id, data)
    : await getPortalsGateway().create(SEGMENTS, data);
  return toSegment(res.data);
}

export async function deleteSegment(slug: string): Promise<boolean> {
  const existing = await getSegment(slug);
  if (!existing) return false;
  await getPortalsGateway().remove(SEGMENTS, existing.id);
  return true;
}
