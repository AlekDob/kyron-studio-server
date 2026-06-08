import type { TenantConfig } from "@/config/tenants/index.js";
import { makePayloadGateway } from "@/core/payload/gateway.js";

// Brain: feature-008-organization-users — store degli utenti Studio + ruoli.
// Fonte di verita' su CHI accede a studio.kyronedu.it e con quale ruolo
// (rimpiazza la env var KYRON_REVIEW_EMAILS). Legge/scrive la collection
// Payload `studio-users` via gateway service-to-service (API key tenant).

const SLUG = "studio-users";

export type StudioRole = "admin" | "editor";

export interface StudioUserRecord {
  id: string;
  email: string;
  role: StudioRole;
  isActive: boolean;
  invitedBy?: string | null;
}

// Email sempre normalizzata: il match in login e' case-insensitive.
export function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

function toRecord(doc: Record<string, unknown>): StudioUserRecord {
  return {
    id: String(doc.id),
    email: String(doc.email ?? ""),
    role: (doc.role === "admin" ? "admin" : "editor") as StudioRole,
    isActive: doc.isActive !== false,
    invitedBy: (doc.invitedBy as string | null) ?? null,
  };
}

export async function findStudioUserByEmail(
  tenant: TenantConfig,
  email: string,
): Promise<StudioUserRecord | null> {
  const gw = makePayloadGateway(tenant);
  const res = await gw.list(SLUG, {
    where: { email: { equals: normalizeEmail(email) } },
    limit: 1,
  });
  const doc = res.data[0];
  return doc ? toRecord(doc) : null;
}

export async function listStudioUsers(
  tenant: TenantConfig,
): Promise<StudioUserRecord[]> {
  const gw = makePayloadGateway(tenant);
  const res = await gw.list(SLUG, { limit: 200, sort: "email" });
  return res.data.map(toRecord);
}

export async function createStudioUser(
  tenant: TenantConfig,
  input: { email: string; role: StudioRole; invitedBy?: string },
): Promise<StudioUserRecord> {
  const gw = makePayloadGateway(tenant);
  const res = await gw.create(SLUG, {
    email: normalizeEmail(input.email),
    role: input.role,
    isActive: true,
    invitedBy: input.invitedBy ? normalizeEmail(input.invitedBy) : undefined,
  });
  return toRecord(res.data);
}

export async function updateStudioUser(
  tenant: TenantConfig,
  id: string,
  patch: { role?: StudioRole; isActive?: boolean },
): Promise<StudioUserRecord> {
  const gw = makePayloadGateway(tenant);
  const res = await gw.update(SLUG, id, patch);
  return toRecord(res.data);
}

export async function deleteStudioUser(
  tenant: TenantConfig,
  id: string,
): Promise<void> {
  const gw = makePayloadGateway(tenant);
  await gw.remove(SLUG, id);
}

// Conta gli admin ATTIVI: serve a impedire il lockout (rimuovere/declassare
// l'ultimo admin lascerebbe lo Studio senza nessuno che possa gestire utenti).
export async function countActiveAdmins(
  tenant: TenantConfig,
): Promise<number> {
  const users = await listStudioUsers(tenant);
  return users.filter((u) => u.role === "admin" && u.isActive).length;
}
