import { z } from "zod";

// Brain: OpenAI strict tool schemas pretendono che TUTTI i campi siano in
// `required` (no `.optional()`, no `.default()` lato schema). Per i campi
// realmente facoltativi usiamo `.nullable()` e l'agente passa null quando
// non li ha. Default li applichiamo dopo, nel tool execute / Payload.

const schoolAddressSchema = z.object({
  firstName: z.string(),
  lastName: z.string(),
  companyName: z.string(),
  streetAddress1: z.string(),
  postalCode: z.string(),
  city: z.string(),
  countryArea: z
    .string()
    .length(2, "countryArea deve essere sigla provincia ISO (es. MI)"),
  country: z.string().length(2),
  phone: z.string().nullable(),
});

const componentSchema = z.object({
  productSlug: z.string(),
  selection: z.discriminatedUnion("kind", [
    z.object({ kind: z.literal("fixed"), variantSku: z.string() }),
    z.object({ kind: z.literal("by-attribute"), attribute: z.string() }),
  ]),
});

const bundleSchema = z.object({
  slug: z.string(),
  name: z.string(),
  finalPriceEur: z.number().positive(),
  components: z.array(componentSchema).min(1),
});

export const pendingSchoolSchema = z.object({
  slug: z.string().min(2).regex(/^[a-z0-9-]+$/, "slug kebab-case"),
  nome: z.string().min(2),
  sitoUfficiale: z.string().nullable(),
  codiceMeccanografico: z.string(),
  schoolAddress: schoolAddressSchema,
  branding: z.object({
    nome: z.string(),
    logo: z.string().nullable(),
  }),
  shipToSchool: z.boolean(),
  shippingMethodLabel: z.string(),
  shippingPriceEur: z.number().nonnegative(),
  catalog: z.object({
    visibleSlugs: z.array(z.string()),
    hiddenSlugs: z.array(z.string()),
  }),
  bundles: z.array(bundleSchema),
});

export type PendingSchool = z.infer<typeof pendingSchoolSchema>;
