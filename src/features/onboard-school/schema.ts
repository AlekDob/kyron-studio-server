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
    // valueFilter: vincola altri attributi (es. {capacita:"128gb"}) mentre il
    // cliente sceglie l'attributo `attribute` (colore) al checkout. Forma
    // canonica (non esposta all'LLM) → puo' usare optional.
    z.object({
      kind: z.literal("by-attribute"),
      attribute: z.string(),
      valueFilter: z.record(z.string(), z.string()).optional(),
    }),
  ]),
});

const productDiscountSchema = z.object({
  slug: z.string(),
  // Taglio (slug valore capacita, es. "128gb") a cui lo sconto si applica;
  // null = sconto sul prodotto intero. Solo prodotti con tagli usano capacity.
  capacity: z.string().nullable(),
  kind: z.enum(["percent", "eur"]),
  value: z.number(),
});

// Taglio pubblicato a catalogo: solo le SKU che matchano attribute=value
// (es. capacita=128gb) ricevono il channel listing nel seed; le altre restano
// non vendibili su quel channel. Per i prodotti senza tagli si usa visibleSlugs.
const visibleVariantSchema = z.object({
  productSlug: z.string(),
  attribute: z.string(),
  value: z.string(),
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
    // Tagli pubblicati a catalogo (prodotti con varianti capacita, es. iPad).
    // [] quando nessuno. Il prodotto va comunque pubblicato ma solo le SKU del
    // taglio ricevono il channel listing nel seed.
    visibleVariants: z.array(visibleVariantSchema),
    hiddenSlugs: z.array(z.string()),
    // Sconto per-prodotto (additivo, non rompe visibleSlugs). percent = % di
    // sconto (0-100); eur = prezzo finale scontato in EUR. Solo prodotti con
    // sconto impostato. null/[] quando nessuno. Applicato su Saleor in onboarding.
    productDiscounts: z.array(productDiscountSchema).nullable(),
    // Vendita fuori dal bundle: indica se i prodotti possono essere acquistati
    // anche singolarmente, non solo dentro un kit. Solo informativo per Alek
    // (la logica di pubblicazione su Saleor e' gia' gestita in fase di seed):
    // hero = dispositivi Apple (iPad/Mac/iPhone), accessories = il resto del
    // catalogo. Default false (vendita solo nel bundle, es. caso Orsoline).
    heroOutsideBundle: z.boolean(),
    accessoriesOutsideBundle: z.boolean(),
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
  // SKU variante fissa (accessori monovariante). null se si usa `capacity`.
  variantSku: z.string().nullable(),
  // Taglio (slug valore capacita, es. "128gb"): il cliente sceglie il colore al
  // checkout → mappato a selection by-attribute. null se si usa `variantSku`.
  capacity: z.string().nullable(),
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
        // capacity vince: il cliente sceglie il colore, la capacita e' fissa.
        selection: c.capacity
          ? {
              kind: "by-attribute" as const,
              attribute: "colore",
              valueFilter: { capacita: c.capacity },
            }
          : { kind: "variant" as const, variantSku: c.variantSku ?? c.productSlug },
      })),
    })),
  };
}
