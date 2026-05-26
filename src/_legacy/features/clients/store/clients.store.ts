import {
  and,
  desc,
  eq,
  gte,
  lte,
  inArray,
  isNull,
  lt,
  or,
  sql,
  count as drizzleCount,
  sum as drizzleSum,
  avg as drizzleAvg,
  type SQL,
} from "drizzle-orm";
import {
  clients,
  type Client,
  type NewClient,
} from "@/core/db/schema/index.js";
import { txWithTenant, type TenantContext } from "@/core/db/client.js";
import type {
  ClientListQuery,
  ClientCreateInput,
  ClientUpdateInput,
} from "../contracts.js";
import { clampLimit, decodeCursor, encodeCursor } from "../pagination.js";

export type ClientSummary = Pick<
  Client,
  | "id"
  | "name"
  | "legalName"
  | "lifecycleStage"
  | "tags"
  | "country"
  | "region"
  | "city"
  | "ownerId"
  | "lastInteractionAt"
  | "healthScore"
  | "createdAt"
  | "updatedAt"
>;

type ListResult = { items: ClientSummary[]; nextCursor: string | null };

export async function listClients(
  ctx: TenantContext,
  query: ClientListQuery,
): Promise<ListResult> {
  return txWithTenant(ctx, async (tx) => {
    const limit = clampLimit(query.limit);
    const cursor = query.cursor ? decodeCursor(query.cursor) : null;

    const conds: SQL[] = [isNull(clients.deletedAt) as SQL];

    if (query.search) {
      const like = `%${query.search}%`;
      conds.push(
        sql`(${clients.name} % ${query.search} OR ${clients.name} ILIKE ${like})`,
      );
    }
    if (query.stage) {
      const stages = Array.isArray(query.stage) ? query.stage : [query.stage];
      conds.push(inArray(clients.lifecycleStage, stages));
    }
    if (query.tags) {
      const tags = Array.isArray(query.tags) ? query.tags : [query.tags];
      conds.push(sql`${clients.tags} && ${tags}`);
    }
    if (query.country) conds.push(eq(clients.country, query.country));
    if (query.region) conds.push(eq(clients.region, query.region));
    if (query.ownerId) conds.push(eq(clients.ownerId, query.ownerId));
    if (query.lastInteractionFrom) {
      conds.push(
        gte(clients.lastInteractionAt, new Date(query.lastInteractionFrom)),
      );
    }
    if (query.lastInteractionTo) {
      conds.push(
        lte(clients.lastInteractionAt, new Date(query.lastInteractionTo)),
      );
    }
    if (query.healthMin !== undefined) {
      conds.push(gte(clients.healthScore, query.healthMin));
    }
    if (query.healthMax !== undefined) {
      conds.push(lte(clients.healthScore, query.healthMax));
    }

    if (cursor) {
      const cursorCond = or(
        lt(clients.lastInteractionAt, new Date(cursor.ts)),
        and(
          eq(clients.lastInteractionAt, new Date(cursor.ts)),
          lt(clients.id, cursor.id),
        ),
      );
      if (cursorCond) conds.push(cursorCond);
    }

    // Sort dinamico. Il cursor keyset funziona bene solo con last_interaction
    // (l'indice composito e' su (org_id, last_interaction_at DESC, id DESC)).
    // Con altri sort il cursor va ignorato e la paginazione e' limit-only.
    const sortKey = query.sort ?? "last_interaction";
    const dirDesc = (query.sortDir ?? "desc") === "desc";
    const primaryCol =
      sortKey === "name"
        ? clients.name
        : sortKey === "revenue"
          ? clients.totalRevenueEur
          : sortKey === "health"
            ? clients.healthScore
            : clients.lastInteractionAt;
    const primaryOrder = dirDesc ? desc(primaryCol) : primaryCol;

    const rows = await tx
      .select({
        id: clients.id,
        name: clients.name,
        legalName: clients.legalName,
        lifecycleStage: clients.lifecycleStage,
        tags: clients.tags,
        country: clients.country,
        region: clients.region,
        city: clients.city,
        ownerId: clients.ownerId,
        lastInteractionAt: clients.lastInteractionAt,
        healthScore: clients.healthScore,
        totalRevenueEur: clients.totalRevenueEur,
        createdAt: clients.createdAt,
        updatedAt: clients.updatedAt,
      })
      .from(clients)
      .where(and(...conds))
      .orderBy(primaryOrder, desc(clients.id))
      .limit(limit + 1);

    let nextCursor: string | null = null;
    if (rows.length > limit) {
      const last = rows[limit - 1];
      if (last && last.lastInteractionAt) {
        nextCursor = encodeCursor({
          ts: last.lastInteractionAt.toISOString(),
          id: last.id,
        });
      }
      rows.pop();
    }

    return { items: rows, nextCursor };
  });
}

export async function getClient(
  ctx: TenantContext,
  id: string,
): Promise<Client | null> {
  return txWithTenant(ctx, async (tx) => {
    const rows = await tx
      .select()
      .from(clients)
      .where(and(eq(clients.id, id), isNull(clients.deletedAt)))
      .limit(1);
    return rows[0] ?? null;
  });
}

export async function createClient(
  ctx: TenantContext,
  input: ClientCreateInput,
): Promise<Client> {
  return txWithTenant(ctx, async (tx) => {
    const payload: NewClient = {
      orgId: ctx.orgId,
      name: input.name,
      legalName: input.legalName,
      vatNumber: input.vatNumber,
      fiscalCode: input.fiscalCode,
      website: input.website,
      industry: input.industry,
      country: input.country,
      region: input.region,
      city: input.city,
      address: input.address,
      lifecycleStage: input.lifecycleStage ?? "prospect",
      tags: input.tags ?? [],
      metadata: input.metadata ?? {},
      ownerId: input.ownerId,
      createdBy: ctx.userId,
      updatedBy: ctx.userId,
    };
    const [inserted] = await tx.insert(clients).values(payload).returning();
    return inserted;
  });
}

export async function updateClient(
  ctx: TenantContext,
  id: string,
  input: ClientUpdateInput,
): Promise<Client | null> {
  return txWithTenant(ctx, async (tx) => {
    const [updated] = await tx
      .update(clients)
      .set({ ...input, updatedBy: ctx.userId, updatedAt: new Date() })
      .where(and(eq(clients.id, id), isNull(clients.deletedAt)))
      .returning();
    return updated ?? null;
  });
}

export async function softDeleteClient(
  ctx: TenantContext,
  id: string,
): Promise<boolean> {
  return txWithTenant(ctx, async (tx) => {
    const rows = await tx
      .update(clients)
      .set({ deletedAt: new Date(), updatedBy: ctx.userId })
      .where(and(eq(clients.id, id), isNull(clients.deletedAt)))
      .returning({ id: clients.id });
    return rows.length > 0;
  });
}

export async function restoreClient(
  ctx: TenantContext,
  id: string,
): Promise<Client | null> {
  return txWithTenant(ctx, async (tx) => {
    const [restored] = await tx
      .update(clients)
      .set({ deletedAt: null, updatedBy: ctx.userId, updatedAt: new Date() })
      .where(eq(clients.id, id))
      .returning();
    return restored ?? null;
  });
}

// ========== Aggregate (Analyst) ==========

export type AggregateMetric =
  | "count"
  | "sum_revenue"
  | "avg_health"
  | "avg_days_since_interaction";

export type AggregateGroupBy = "stage" | "region" | "country" | "owner" | "tag";

export interface AggregateRow {
  group: string;
  value: number;
}

export async function aggregateClientsByGroup(
  ctx: TenantContext,
  metric: AggregateMetric,
  groupBy: AggregateGroupBy,
): Promise<AggregateRow[]> {
  return txWithTenant(ctx, async (tx) => {
    // groupBy -> column expression
    const groupCol =
      groupBy === "stage"
        ? clients.lifecycleStage
        : groupBy === "region"
          ? clients.region
          : groupBy === "country"
            ? clients.country
            : groupBy === "owner"
              ? clients.ownerId
              : clients.tags; // tag handled below (array expand)

    // metric -> value expression
    const valueExpr =
      metric === "count"
        ? drizzleCount(clients.id)
        : metric === "sum_revenue"
          ? drizzleSum(clients.totalRevenueEur)
          : metric === "avg_health"
            ? drizzleAvg(clients.healthScore)
            : sql<number>`AVG(EXTRACT(EPOCH FROM (now() - ${clients.lastInteractionAt})) / 86400)`;

    if (groupBy === "tag") {
      // tag unnest
      const rows = await tx.execute<{ group: string | null; value: number | null }>(sql`
        SELECT unnest(tags) AS "group", ${valueExpr} AS value
        FROM clients
        WHERE deleted_at IS NULL
        GROUP BY unnest(tags)
        ORDER BY value DESC NULLS LAST
        LIMIT 50
      `);
      return (rows as unknown as Array<{ group: string | null; value: number | null }>).map(
        (r) => ({
          group: r.group ?? "(senza tag)",
          value: Number(r.value ?? 0),
        }),
      );
    }

    // ORDER BY positional (2 = seconda colonna SELECT = value).
    // Postgres non riconosce l'alias "value" perche' Drizzle non lo aliasa
    // nel SQL compilato quando usiamo aggregazioni (count/sum/avg).
    const rows = await tx
      .select({ group: groupCol, value: valueExpr })
      .from(clients)
      .where(isNull(clients.deletedAt))
      .groupBy(groupCol)
      .orderBy(sql`2 DESC NULLS LAST`)
      .limit(50);

    return rows.map((r) => ({
      group: (r.group as string | null) ?? "(nessuno)",
      value: Number(r.value ?? 0),
    }));
  });
}
