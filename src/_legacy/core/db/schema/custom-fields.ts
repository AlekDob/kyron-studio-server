import {
  pgTable,
  uuid,
  text,
  boolean,
  smallint,
  timestamp,
  jsonb,
  pgEnum,
  uniqueIndex,
  check,
  index,
} from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";

export const customFieldEntityEnum = pgEnum("custom_field_entity", [
  "client",
  "contact",
  "activity",
  "opportunity",
]);

export const customFieldTypeEnum = pgEnum("custom_field_type", [
  "text",
  "number",
  "boolean",
  "date",
  "enum",
  "url",
  "email",
  "phone",
  "multiselect",
]);

export const customFieldDefinitions = pgTable(
  "custom_field_definitions",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    orgId: uuid("org_id").notNull(),
    entity: customFieldEntityEnum("entity").notNull(),
    key: text("key").notNull(),
    label: text("label").notNull(),
    labelI18n: jsonb("label_i18n").notNull().default({}),
    type: customFieldTypeEnum("type").notNull(),
    options: jsonb("options"),
    required: boolean("required").notNull().default(false),
    searchable: boolean("searchable").notNull().default(false),
    displayOrder: smallint("display_order").notNull().default(0),
    group: text("group"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
    deletedAt: timestamp("deleted_at", { withTimezone: true }),
  },
  (t) => ({
    orgEntityKey: uniqueIndex("idx_custom_fields_unique").on(t.orgId, t.entity, t.key),
    orgEntityOrder: index("idx_custom_fields_org_entity")
      .on(t.orgId, t.entity, t.displayOrder)
      .where(sql`${t.deletedAt} IS NULL`),
    keyFormat: check("custom_fields_key_format", sql`${t.key} ~ '^[a-z][a-z0-9_]*$'`),
  }),
);

export type CustomFieldDefinition = typeof customFieldDefinitions.$inferSelect;
export type NewCustomFieldDefinition = typeof customFieldDefinitions.$inferInsert;
