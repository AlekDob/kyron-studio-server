import {
  pgTable,
  uuid,
  text,
  smallint,
  timestamp,
  jsonb,
  pgEnum,
  index,
} from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { clients } from "./clients.js";

export const opportunitySignalEnum = pgEnum("opportunity_signal", [
  "churn_risk",
  "contract_expiry",
  "silence_anomaly",
  "upsell_trigger",
  "renewal_due",
]);

export const opportunityStatusEnum = pgEnum("opportunity_status", [
  "pending",
  "acted",
  "dismissed",
  "expired",
]);

export const opportunityCreatorEnum = pgEnum("opportunity_creator", [
  "rule_engine",
  "agent",
]);

export const clientOpportunities = pgTable(
  "client_opportunities",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    orgId: uuid("org_id").notNull(),
    clientId: uuid("client_id")
      .notNull()
      .references(() => clients.id, { onDelete: "cascade" }),
    signal: opportunitySignalEnum("signal").notNull(),
    priority: smallint("priority").notNull().default(50),
    title: text("title").notNull(),
    narrative: text("narrative"),
    suggestedAction: jsonb("suggested_action"),
    status: opportunityStatusEnum("status").notNull().default("pending"),
    actedAt: timestamp("acted_at", { withTimezone: true }),
    dismissedAt: timestamp("dismissed_at", { withTimezone: true }),
    expiresAt: timestamp("expires_at", { withTimezone: true }),
    createdBy: opportunityCreatorEnum("created_by").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    feed: index("idx_opportunities_feed")
      .on(t.orgId, t.priority.desc(), t.createdAt.desc())
      .where(sql`${t.status} = 'pending'`),
  }),
);

export type ClientOpportunity = typeof clientOpportunities.$inferSelect;
export type NewClientOpportunity = typeof clientOpportunities.$inferInsert;
