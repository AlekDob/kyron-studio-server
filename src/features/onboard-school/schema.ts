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
    z.object({ kind: z.literal("variant"), variantSku: z.string() }),
    z.object({ kind: z.literal("by-attribute"), attribute: z.string() }),
  ]),
});

const productDiscountSchema = z.object({
  slug: z.string(),
  kind: z.enum(["percent", "eur"]),
  value: z.number(),
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
    // Sconto per-prodotto (additivo, non rompe visibleSlugs). percent = % di
    // sconto (0-100); eur = prezzo finale scontato in EUR. Solo prodotti con
    // sconto impostato. null/[] quando nessuno. Applicato su Saleor in onboarding.
    productDiscounts: z.array(productDiscountSchema).nullable(),
  }),
  bundles: z.array(bundleSchema),
});

export type PendingSchool = z.infer<typeof pendingSchoolSchema>;

// Brain: i tool AI ricevono i componenti bundle in forma PIATTA {productSlug,
// variantSku}, cosi' l'LLM non deve mai emettere il discriminatore `selection.kind`
// (bug: l'agente passava kind:"product" inesistente -> invalid_union_discriminator).
// La normalizzazione a `selection:{kind:"variant"}` avviene server-side, coerente
// con add_bundle_to_portal. pendingSchoolSchema resta la forma canonica del writer.
const inputComponentSchema = z.object({
  productSlug: z.string(),
  variantSku: z.string(),
});

const inputBundleSchema = z.object({
  slug: z.string(),
  name: z.string(),
  finalPriceEur: z.number().positive(),
  components: z.array(inputComponentSchema).min(1),
});

export const pendingSchoolInputSchema = pendingSchoolSchema.extend({
  bundles: z.array(inputBundleSchema),
});

export type PendingSchoolInput = z.infer<typeof pendingSchoolInputSchema>;

// Mappa la forma piatta dei tool AI alla forma canonica con `selection`.
export function toCanonicalPendingSchool(
  input: PendingSchoolInput,
): PendingSchool {
  return {
    ...input,
    bundles: input.bundles.map((bundle) => ({
      ...bundle,
      components: bundle.components.map((c) => ({
        productSlug: c.productSlug,
        selection: { kind: "variant" as const, variantSku: c.variantSku },
      })),
    })),
  };
}
