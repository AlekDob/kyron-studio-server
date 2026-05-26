import { z } from "zod";

// ========== Lifecycle stage enum ==========
export const lifecycleStageSchema = z.enum([
  "prospect",
  "active",
  "inactive",
  "churned",
  "blacklisted",
]);
export type LifecycleStage = z.infer<typeof lifecycleStageSchema>;

// ========== Activity kind enum ==========
export const activityKindSchema = z.enum([
  "note",
  "call",
  "email",
  "meeting",
  "document_uploaded",
  "agent_insight",
  "status_change",
  "opportunity_created",
]);
export type ActivityKind = z.infer<typeof activityKindSchema>;

// ========== Client ==========
export const clientCreateSchema = z.object({
  name: z.string().min(1).max(200),
  legalName: z.string().max(200).optional(),
  vatNumber: z.string().max(30).optional(),
  fiscalCode: z.string().max(30).optional(),
  website: z.string().url().optional(),
  industry: z.string().max(100).optional(),
  country: z.string().length(2).optional(),
  region: z.string().max(100).optional(),
  city: z.string().max(100).optional(),
  address: z.string().max(300).optional(),
  lifecycleStage: lifecycleStageSchema.optional(),
  tags: z.array(z.string()).max(20).optional(),
  metadata: z.record(z.unknown()).optional(),
  healthScore: z.number().int().min(0).max(100).nullable().optional(),
  ownerId: z.string().uuid().optional(),
});
export type ClientCreateInput = z.infer<typeof clientCreateSchema>;

export const clientUpdateSchema = clientCreateSchema.partial();
export type ClientUpdateInput = z.infer<typeof clientUpdateSchema>;

export const clientListQuerySchema = z.object({
  cursor: z.string().optional(),
  limit: z.coerce.number().int().min(1).max(200).optional(),
  search: z.string().min(1).max(200).optional(),
  stage: z.union([lifecycleStageSchema, z.array(lifecycleStageSchema)]).optional(),
  tags: z.union([z.string(), z.array(z.string())]).optional(),
  country: z.string().length(2).optional(),
  region: z.string().max(100).optional(),
  ownerId: z.string().uuid().optional(),
  lastInteractionFrom: z.string().datetime().optional(),
  lastInteractionTo: z.string().datetime().optional(),
  healthMin: z.coerce.number().min(0).max(100).optional(),
  healthMax: z.coerce.number().min(0).max(100).optional(),
  sort: z.enum(["last_interaction", "name", "revenue", "health"]).optional(),
  sortDir: z.enum(["asc", "desc"]).optional(),
});
export type ClientListQuery = z.infer<typeof clientListQuerySchema>;

// ========== Contact ==========
export const contactCreateSchema = z.object({
  firstName: z.string().max(100).optional(),
  lastName: z.string().max(100).optional(),
  role: z.string().max(100).optional(),
  email: z.string().email().optional(),
  phone: z.string().max(40).optional(),
  isPrimary: z.boolean().optional(),
  metadata: z.record(z.unknown()).optional(),
});
export type ContactCreateInput = z.infer<typeof contactCreateSchema>;

export const contactUpdateSchema = contactCreateSchema.partial();
export type ContactUpdateInput = z.infer<typeof contactUpdateSchema>;

// ========== Activity ==========
export const activityCreateSchema = z.object({
  kind: activityKindSchema,
  title: z.string().max(300).optional(),
  body: z.string().max(10000).optional(),
  occurredAt: z.string().datetime().optional(), // default now
  metadata: z.record(z.unknown()).optional(),
});
export type ActivityCreateInput = z.infer<typeof activityCreateSchema>;

export const activityListQuerySchema = z.object({
  kind: z.union([activityKindSchema, z.array(activityKindSchema)]).optional(),
  cursor: z.string().optional(),
  limit: z.coerce.number().int().min(1).max(200).optional(),
});
export type ActivityListQuery = z.infer<typeof activityListQuerySchema>;

// ========== Custom field definition ==========
export const customFieldEntitySchema = z.enum(["client", "contact", "activity", "opportunity"]);
export const customFieldTypeSchema = z.enum([
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

export const customFieldCreateSchema = z.object({
  entity: customFieldEntitySchema,
  key: z.string().regex(/^[a-z][a-z0-9_]*$/).max(64),
  label: z.string().min(1).max(100),
  labelI18n: z.record(z.string()).optional(),
  type: customFieldTypeSchema,
  options: z.array(z.object({ value: z.string(), labelI18n: z.record(z.string()) })).optional(),
  required: z.boolean().optional(),
  searchable: z.boolean().optional(),
  displayOrder: z.number().int().min(0).max(1000).optional(),
  group: z.string().max(100).optional(),
});
export type CustomFieldCreateInput = z.infer<typeof customFieldCreateSchema>;

export const customFieldUpdateSchema = customFieldCreateSchema.partial().omit({ entity: true, key: true });
export type CustomFieldUpdateInput = z.infer<typeof customFieldUpdateSchema>;
