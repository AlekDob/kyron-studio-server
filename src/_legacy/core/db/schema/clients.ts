import {
  pgTable,
  uuid,
  text,
  timestamp,
  smallint,
  numeric,
  jsonb,
  pgEnum,
  index,
  uniqueIndex,
} from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";

export const lifecycleStageEnum = pgEnum("client_lifecycle_stage", [
  "prospect",
  "active",
  "inactive",
  "churned",
  "blacklisted",
]);

export const clients = pgTable(
  "clients",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    orgId: uuid("org_id").notNull(),
    name: text("name").notNull(),
    legalName: text("legal_name"),
    vatNumber: text("vat_number"),
    fiscalCode: text("fiscal_code"),
    website: text("website"),
    industry: text("industry"),
    country: text("country"),
    region: text("region"),
    city: text("city"),
    address: text("address"),
    lifecycleStage: lifecycleStageEnum("lifecycle_stage").notNull().default("prospect"),
    tags: text("tags").array().notNull().default(sql`ARRAY[]::text[]`),
    metadata: jsonb("metadata").notNull().default({}),
    ownerId: uuid("owner_id"),
    externalSource: text("external_source"),
    externalId: text("external_id"),
    lastInteractionAt: timestamp("last_interaction_at", { withTimezone: true }),
    totalRevenueEur: numeric("total_revenue_eur", { precision: 14, scale: 2 }),
    healthScore: smallint("health_score"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
    createdBy: uuid("created_by"),
    updatedBy: uuid("updated_by"),
    deletedAt: timestamp("deleted_at", { withTimezone: true }),
  },
  (t) => ({
    orgLastInteraction: index("idx_clients_org_last_interaction")
      .on(t.orgId, t.lastInteractionAt.desc(), t.id.desc())
      .where(sql`${t.deletedAt} IS NULL`),
    orgStage: index("idx_clients_org_stage")
      .on(t.orgId, t.lifecycleStage)
      .where(sql`${t.deletedAt} IS NULL`),
    externalRef: uniqueIndex("idx_clients_external_ref")
      .on(t.orgId, t.externalSource, t.externalId)
      .where(sql`${t.externalSource} IS NOT NULL AND ${t.externalId} IS NOT NULL`),
  }),
);

export type Client = typeof clients.$inferSelect;
export type NewClient = typeof clients.$inferInsert;
