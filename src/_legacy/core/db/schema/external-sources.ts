import {
  pgTable,
  uuid,
  text,
  timestamp,
  jsonb,
  pgEnum,
  index,
} from "drizzle-orm/pg-core";

export const externalSourceTypeEnum = pgEnum("external_source_type", [
  "hubspot",
  "pipedrive",
  "salesforce",
  "postgres_direct",
  "mysql_direct",
  "csv_import",
]);

export const externalSourceStatusEnum = pgEnum("external_source_status", [
  "active",
  "paused",
  "error",
]);

export const syncDirectionEnum = pgEnum("sync_direction", [
  "pull",
  "push",
  "bidirectional",
]);

export const clientExternalSources = pgTable(
  "client_external_sources",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    orgId: uuid("org_id").notNull(),
    name: text("name").notNull(),
    type: externalSourceTypeEnum("type").notNull(),
    configEncrypted: text("config_encrypted").notNull(),
    status: externalSourceStatusEnum("status").notNull().default("paused"),
    lastSyncAt: timestamp("last_sync_at", { withTimezone: true }),
    lastSyncSummary: jsonb("last_sync_summary"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    orgIdx: index("idx_external_sources_org").on(t.orgId),
  }),
);

export const clientFieldMappings = pgTable("client_field_mappings", {
  id: uuid("id").primaryKey().defaultRandom(),
  sourceId: uuid("source_id")
    .notNull()
    .references(() => clientExternalSources.id, { onDelete: "cascade" }),
  externalField: text("external_field").notNull(),
  internalField: text("internal_field").notNull(),
  transformFn: text("transform_fn"),
  direction: syncDirectionEnum("direction").notNull().default("pull"),
  defaultValue: jsonb("default_value"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export type ClientExternalSource = typeof clientExternalSources.$inferSelect;
export type ClientFieldMapping = typeof clientFieldMappings.$inferSelect;
