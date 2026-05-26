import { and, asc, eq, isNull, type SQL } from "drizzle-orm";
import {
  customFieldDefinitions,
  type CustomFieldDefinition,
  type NewCustomFieldDefinition,
} from "@/core/db/schema/index.js";
import { txWithTenant, type TenantContext } from "@/core/db/client.js";
import type {
  CustomFieldCreateInput,
  CustomFieldUpdateInput,
} from "../contracts.js";

export async function listCustomFields(
  ctx: TenantContext,
  entity?: CustomFieldDefinition["entity"],
): Promise<CustomFieldDefinition[]> {
  return txWithTenant(ctx, async (tx) => {
    const conds: SQL[] = [isNull(customFieldDefinitions.deletedAt) as SQL];
    if (entity) conds.push(eq(customFieldDefinitions.entity, entity));
    return tx
      .select()
      .from(customFieldDefinitions)
      .where(and(...conds))
      .orderBy(
        asc(customFieldDefinitions.entity),
        asc(customFieldDefinitions.displayOrder),
      );
  });
}

export async function createCustomField(
  ctx: TenantContext,
  input: CustomFieldCreateInput,
): Promise<CustomFieldDefinition> {
  return txWithTenant(ctx, async (tx) => {
    const payload: NewCustomFieldDefinition = {
      orgId: ctx.orgId,
      entity: input.entity,
      key: input.key,
      label: input.label,
      labelI18n: input.labelI18n ?? {},
      type: input.type,
      options: input.options,
      required: input.required ?? false,
      searchable: input.searchable ?? false,
      displayOrder: input.displayOrder ?? 0,
      group: input.group,
    };
    const [inserted] = await tx
      .insert(customFieldDefinitions)
      .values(payload)
      .returning();
    return inserted;
  });
}

export async function updateCustomField(
  ctx: TenantContext,
  id: string,
  input: CustomFieldUpdateInput,
): Promise<CustomFieldDefinition | null> {
  return txWithTenant(ctx, async (tx) => {
    const [updated] = await tx
      .update(customFieldDefinitions)
      .set({ ...input, updatedAt: new Date() })
      .where(
        and(
          eq(customFieldDefinitions.id, id),
          isNull(customFieldDefinitions.deletedAt),
        ),
      )
      .returning();
    return updated ?? null;
  });
}

export async function softDeleteCustomField(
  ctx: TenantContext,
  id: string,
): Promise<boolean> {
  return txWithTenant(ctx, async (tx) => {
    const rows = await tx
      .update(customFieldDefinitions)
      .set({ deletedAt: new Date() })
      .where(
        and(
          eq(customFieldDefinitions.id, id),
          isNull(customFieldDefinitions.deletedAt),
        ),
      )
      .returning({ id: customFieldDefinitions.id });
    return rows.length > 0;
  });
}
