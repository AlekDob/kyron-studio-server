import { and, eq, isNull } from "drizzle-orm";
import {
  clientContacts,
  clients,
  type ClientContact,
  type NewClientContact,
} from "@/core/db/schema/index.js";
import { txWithTenant, type TenantContext } from "@/core/db/client.js";
import type { ContactCreateInput, ContactUpdateInput } from "../contracts.js";

export async function listContactsForClient(
  ctx: TenantContext,
  clientId: string,
): Promise<ClientContact[]> {
  return txWithTenant(ctx, async (tx) => {
    return tx
      .select()
      .from(clientContacts)
      .where(
        and(
          eq(clientContacts.clientId, clientId),
          isNull(clientContacts.deletedAt),
        ),
      );
  });
}

export async function createContact(
  ctx: TenantContext,
  clientId: string,
  input: ContactCreateInput,
): Promise<ClientContact | null> {
  return txWithTenant(ctx, async (tx) => {
    // verify client exists (and belongs to org via RLS)
    const client = await tx
      .select({ id: clients.id })
      .from(clients)
      .where(and(eq(clients.id, clientId), isNull(clients.deletedAt)))
      .limit(1);
    if (client.length === 0) return null;

    const payload: NewClientContact = {
      orgId: ctx.orgId,
      clientId,
      firstName: input.firstName,
      lastName: input.lastName,
      role: input.role,
      email: input.email,
      phone: input.phone,
      isPrimary: input.isPrimary ?? false,
      metadata: input.metadata ?? {},
    };
    const [inserted] = await tx
      .insert(clientContacts)
      .values(payload)
      .returning();
    return inserted;
  });
}

export async function updateContact(
  ctx: TenantContext,
  contactId: string,
  input: ContactUpdateInput,
): Promise<ClientContact | null> {
  return txWithTenant(ctx, async (tx) => {
    const [updated] = await tx
      .update(clientContacts)
      .set({ ...input, updatedAt: new Date() })
      .where(
        and(eq(clientContacts.id, contactId), isNull(clientContacts.deletedAt)),
      )
      .returning();
    return updated ?? null;
  });
}

export async function softDeleteContact(
  ctx: TenantContext,
  contactId: string,
): Promise<boolean> {
  return txWithTenant(ctx, async (tx) => {
    const rows = await tx
      .update(clientContacts)
      .set({ deletedAt: new Date() })
      .where(
        and(eq(clientContacts.id, contactId), isNull(clientContacts.deletedAt)),
      )
      .returning({ id: clientContacts.id });
    return rows.length > 0;
  });
}
