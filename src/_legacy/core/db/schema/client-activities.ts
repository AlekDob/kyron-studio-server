import {
  pgTable,
  uuid,
  text,
  timestamp,
  jsonb,
  pgEnum,
  index,
} from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { clients } from "./clients.js";

export const activityKindEnum = pgEnum("client_activity_kind", [
  "note",
  "call",
  "email",
  "meeting",
  "document_uploaded",
  "agent_insight",
  "status_change",
  "opportunity_created",
]);

export const actorTypeEnum = pgEnum("client_activity_actor_type", [
  "user",
  "agent",
  "system",
]);

export const clientActivities = pgTable(
  "client_activities",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    orgId: uuid("org_id").notNull(),
    clientId: uuid("client_id")
      .notNull()
      .references(() => clients.id, { onDelete: "cascade" }),
    kind: activityKindEnum("kind").notNull(),
    title: text("title"),
    body: text("body"),
    actorType: actorTypeEnum("actor_type").notNull(),
    actorId: text("actor_id"),
    metadata: jsonb("metadata").notNull().default({}),
    occurredAt: timestamp("occurred_at", { withTimezone: true }).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    clientTime: index("idx_activities_client_time").on(t.clientId, t.occurredAt.desc()),
    insightFeed: index("idx_activities_insight_feed")
      .on(t.orgId, t.occurredAt.desc())
      .where(sql`${t.kind} = 'agent_insight'`),
  }),
);

export type ClientActivity = typeof clientActivities.$inferSelect;
export type NewClientActivity = typeof clientActivities.$inferInsert;
