import {
  and,
  desc,
  eq,
  inArray,
  isNull,
  lt,
  or,
  type SQL,
} from "drizzle-orm";
import {
  clientActivities,
  clients,
  type ClientActivity,
  type NewClientActivity,
} from "@/core/db/schema/index.js";
import { txWithTenant, type TenantContext } from "@/core/db/client.js";
import type {
  ActivityCreateInput,
  ActivityListQuery,
} from "../contracts.js";
import { clampLimit, decodeCursor, encodeCursor } from "../pagination.js";

type ListResult = { items: ClientActivity[]; nextCursor: string | null };

export async function listActivitiesForClient(
  ctx: TenantContext,
  clientId: string,
  query: ActivityListQuery,
): Promise<ListResult> {
  return txWithTenant(ctx, async (tx) => {
    const limit = clampLimit(query.limit);
    const cursor = query.cursor ? decodeCursor(query.cursor) : null;

    const conds: SQL[] = [eq(clientActivities.clientId, clientId) as SQL];
    if (query.kind) {
      const kinds = Array.isArray(query.kind) ? query.kind : [query.kind];
      conds.push(inArray(clientActivities.kind, kinds));
    }
    if (cursor) {
      const cursorCond = or(
        lt(clientActivities.occurredAt, new Date(cursor.ts)),
        and(
          eq(clientActivities.occurredAt, new Date(cursor.ts)),
          lt(clientActivities.id, cursor.id),
        ),
      );
      if (cursorCond) conds.push(cursorCond);
    }

    const rows = await tx
      .select()
      .from(clientActivities)
      .where(and(...conds))
      .orderBy(desc(clientActivities.occurredAt), desc(clientActivities.id))
      .limit(limit + 1);

    let nextCursor: string | null = null;
    if (rows.length > limit) {
      const last = rows[limit - 1];
      if (last) {
        nextCursor = encodeCursor({
          ts: last.occurredAt.toISOString(),
          id: last.id,
        });
      }
      rows.pop();
    }

    return { items: rows, nextCursor };
  });
}

export async function createActivity(
  ctx: TenantContext,
  clientId: string,
  input: ActivityCreateInput,
  actorOverride?: { type: "user" | "agent" | "system"; id: string },
): Promise<ClientActivity | null> {
  return txWithTenant(ctx, async (tx) => {
    const client = await tx
      .select({ id: clients.id })
      .from(clients)
      .where(and(eq(clients.id, clientId), isNull(clients.deletedAt)))
      .limit(1);
    if (client.length === 0) return null;

    const payload: NewClientActivity = {
      orgId: ctx.orgId,
      clientId,
      kind: input.kind,
      title: input.title,
      body: input.body,
      actorType: actorOverride?.type ?? "user",
      actorId: actorOverride?.id ?? ctx.userId,
      metadata: input.metadata ?? {},
      occurredAt: input.occurredAt ? new Date(input.occurredAt) : new Date(),
    };
    const [inserted] = await tx
      .insert(clientActivities)
      .values(payload)
      .returning();
    return inserted;
  });
}
