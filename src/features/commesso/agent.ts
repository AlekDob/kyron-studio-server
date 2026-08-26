// Nico — agente del modulo Commesso. Legge e scrive il catalogo Saleor.
// I tool non lanciano mai: un errore torna come dato, cosi' Nico lo spiega
// invece di far cadere lo stream.
import { streamText, tool } from "ai";
import { z } from "zod";
import type { TenantConfig } from "@/config/tenants/index.js";
import { resolveModel } from "@/features/settings/resolve-model.js";
import type { SaleorTarget } from "@/features/portals/enable/saleor-admin.js";
import { COMMESSO_SYSTEM_PROMPT } from "./prompt.js";
import { getCatalogMeta, getProduct, listProducts } from "./reads.js";
import { planPrices } from "./plan-service.js";
import { planDaneaImport } from "./danea-service.js";
import { applyDaneaPlan } from "./danea-apply.js";
import { applyPricePlan, resolveChannelId } from "./price-writes.js";
import {
  addProductImage,
  createProduct,
  publishOnChannel,
  setStock,
  updateProduct,
  upsertVariant,
} from "./writes.js";

interface AgentRunOptions {
  tenant: TenantConfig;
  cookie: string;
  userEmail: string;
  messages: Array<{ role: "user" | "assistant"; content: string }>;
}

// Il default e' prod: e' li' che vendiamo. Staging si chiede esplicitamente.
const TARGET = z
  .enum(["prod", "staging"])
  .default("prod")
  .describe("Saleor su cui operare; prod se non specificato");

function readable(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

// Ogni tool ha la stessa forma: prova, e se va male torna {error}. Il wrapper
// evita di ripetere try/catch dieci volte.
function safe<A, R>(fn: (args: A) => Promise<R>) {
  return async (args: A): Promise<R | { error: string }> => {
    try {
      return await fn(args);
    } catch (err) {
      return { error: readable(err) };
    }
  };
}

async function resolveProductId(target: SaleorTarget, slug: string): Promise<string> {
  const product = await getProduct(target, slug);
  if (!product) throw new Error(`Prodotto "${slug}" non trovato su ${target}`);
  return product.id;
}

export async function* runCommessoAgent(opts: AgentRunOptions) {
  void opts.tenant;
  void opts.cookie;
  const { model } = await resolveModel("commesso", "default");

  const result = streamText({
    model,
    system: COMMESSO_SYSTEM_PROMPT,
    messages: opts.messages,
    maxSteps: 10,
    tools: {
      list_products: tool({
        description:
          "Cerca prodotti nel catalogo Saleor (anche non pubblicati) per nome, slug o SKU. Torna varianti, giacenze e prezzi per canale.",
        parameters: z.object({
          search: z.string().optional().describe("testo da cercare; vuoto = tutto"),
          target: TARGET,
        }),
        execute: safe(async ({ search, target }) => {
          const products = await listProducts(target, { search });
          return { count: products.length, products };
        }),
      }),
      get_product: tool({
        description: "Scheda completa di un prodotto dal suo slug.",
        parameters: z.object({ slug: z.string(), target: TARGET }),
        execute: safe(async ({ slug, target }) => {
          const product = await getProduct(target, slug);
          return product ?? { error: `Prodotto "${slug}" non trovato su ${target}` };
        }),
      }),
      get_catalog_meta: tool({
        description:
          "Canali, categorie, tipi prodotto e magazzini realmente esistenti. Da leggere prima di creare un prodotto o di scrivere un prezzo.",
        parameters: z.object({ target: TARGET }),
        execute: safe(async ({ target }) => getCatalogMeta(target)),
      }),
      create_product: tool({
        description:
          "Crea un prodotto. Nasce NON pubblicato e senza prezzo: la pubblicazione e il prezzo sono passi separati.",
        parameters: z.object({
          name: z.string(),
          slug: z.string().describe("minuscolo con trattini, non si cambia piu'"),
          productTypeId: z.string().describe("id da get_catalog_meta"),
          categorySlug: z.string().describe("slug categoria da get_catalog_meta"),
          description: z.string().optional(),
          target: TARGET,
        }),
        execute: safe(async ({ target, ...input }) => {
          const product = await createProduct(target, input);
          return {
            ...product,
            next: "Ora servono: variante (update_variant), prezzo (plan_prices), pubblicazione (publish_product).",
          };
        }),
      }),
      update_product: tool({
        description: "Cambia nome, descrizione o categoria di un prodotto esistente.",
        parameters: z.object({
          slug: z.string(),
          name: z.string().optional(),
          description: z.string().optional(),
          categorySlug: z.string().optional(),
          target: TARGET,
        }),
        execute: safe(async ({ slug, target, ...patch }) => {
          await updateProduct(target, await resolveProductId(target, slug), patch);
          return { ok: true, slug };
        }),
      }),
      update_variant: tool({
        description:
          "Crea o rinomina una variante (taglio, colore, durata). Il prezzo NON si tocca qui: usa plan_prices.",
        parameters: z.object({
          productSlug: z.string(),
          sku: z.string().describe("codice articolo Danea"),
          name: z.string().describe("nome variante, es. '256GB'"),
          variantId: z.string().optional().describe("presente = rinomina, assente = crea"),
          target: TARGET,
        }),
        execute: safe(async ({ productSlug, target, ...args }) => {
          const productId = await resolveProductId(target, productSlug);
          return upsertVariant(target, { productId, ...args });
        }),
      }),
      set_stock: tool({
        description: "Imposta la giacenza di una variante in un magazzino.",
        parameters: z.object({
          variantId: z.string(),
          warehouseId: z.string().describe("id da get_catalog_meta"),
          quantity: z.number().int().min(0),
          target: TARGET,
        }),
        execute: safe(async ({ target, ...args }) => {
          await setStock(target, args);
          return { ok: true, quantity: args.quantity };
        }),
      }),
      add_product_image: tool({
        description: "Aggiunge un'immagine a un prodotto da URL pubblico.",
        parameters: z.object({
          productSlug: z.string(),
          imageUrl: z.string().url(),
          alt: z.string().optional(),
          target: TARGET,
        }),
        execute: safe(async ({ productSlug, target, ...args }) => {
          await addProductImage(target, {
            productId: await resolveProductId(target, productSlug),
            ...args,
          });
          return { ok: true };
        }),
      }),
      publish_product: tool({
        description:
          "Pubblica un prodotto su un canale, rendendolo acquistabile. Gesto esplicito: la creazione non pubblica niente.",
        parameters: z.object({
          productSlug: z.string(),
          channelSlug: z.string(),
          visibleInListings: z
            .boolean()
            .default(true)
            .describe("false = comprabile solo dentro un kit, non a catalogo"),
          target: TARGET,
        }),
        execute: safe(async ({ productSlug, channelSlug, visibleInListings, target }) => {
          const meta = await getCatalogMeta(target);
          if (!meta.channels.some((c) => c.slug === channelSlug)) {
            return { error: `Canale "${channelSlug}" inesistente su ${target}` };
          }
          await publishOnChannel(target, {
            channelId: await resolveChannelId(target, channelSlug),
            productId: await resolveProductId(target, productSlug),
            visibleInListings,
          });
          return { ok: true, channelSlug };
        }),
      }),
      render_danea_uploader: tool({
        description:
          "Mostra il riquadro per caricare il file EcommProdotti.xml di Danea. Chiamalo ogni volta che serve il file: mai descriverlo a parole.",
        parameters: z.object({}),
        execute: async () => ({
          ready: true,
          _ui: {
            component: "DaneaUploader",
            props: {},
            id: `danea_${Date.now()}`,
          },
        }),
      }),
      plan_danea_import: tool({
        description:
          "Confronta il file Danea caricato col catalogo: cosa e' nuovo, quali prezzi cambierebbero, cosa e' invariato. NON scrive niente.",
        parameters: z.object({
          importId: z.string().describe("id restituito dall'uploader"),
          channelSlug: z.string().describe("canale su cui confrontare i prezzi"),
          target: TARGET,
        }),
        execute: safe(async ({ importId, channelSlug, target }) => {
          const plan = await planDaneaImport(target, { importId, channelSlug });
          return {
            target,
            importId,
            plan,
            _ui: {
              component: "DaneaImportPlan",
              props: { target, plan },
              id: `daneaplan_${Date.now()}`,
            },
          };
        }),
      }),
      apply_danea_import: tool({
        description:
          "Crea i prodotti e le varianti NUOVE del piano Danea, col loro prezzo sul canale indicato. Nascono non pubblicati. I prezzi che cambiano su prodotti esistenti NON si toccano qui: quelli passano da plan_prices. Serve la conferma dell'utente.",
        parameters: z.object({
          importId: z.string(),
          channelSlug: z.string(),
          mappings: z
            .array(
              z.object({
                aggregator: z.string().describe("chiave del gruppo nel piano"),
                productName: z.string().describe("nome del prodotto per il negozio"),
                slug: z.string(),
                productTypeId: z.string().describe("id da get_catalog_meta"),
                categorySlug: z.string(),
              }),
            )
            .min(1)
            .describe("un mapping per ogni gruppo da creare; i gruppi senza mapping si saltano"),
          confirm: z.literal(true),
          target: TARGET,
        }),
        execute: safe(async ({ importId, channelSlug, mappings, target }) => {
          // Ricalcoliamo il piano: tra il mostrare e il confermare il catalogo
          // puo' essere cambiato, e un doppio apply non deve duplicare varianti.
          const plan = await planDaneaImport(target, { importId, channelSlug });
          return applyDaneaPlan(target, { channelSlug, groups: plan.groups, mappings });
        }),
      }),
      plan_prices: tool({
        description:
          "Calcola un piano prezzi su un canale e lo mostra. NON scrive niente. Segnala i kit scuola coinvolti: se un prodotto e' componente di un kit il piano deve includere anche il nuovo importo del voucher.",
        parameters: z.object({
          channelSlug: z.string().describe("canale su cui cambiare i prezzi"),
          changes: z
            .array(z.object({ sku: z.string(), newPriceEur: z.number() }))
            .min(1),
          voucherUpdates: z
            .array(
              z.object({ voucherCode: z.string(), newDiscountEur: z.number() }),
            )
            .optional()
            .describe("nuovi importi voucher dei kit coinvolti"),
          target: TARGET,
        }),
        execute: safe(async ({ target, channelSlug, changes, voucherUpdates }) => {
          const plan = await planPrices(target, {
            channelSlug,
            requests: changes,
            voucherUpdates,
          });
          return {
            target,
            plan,
            applicable: plan.errors.length === 0,
            _ui: {
              component: "PricePlanCard",
              props: { target, plan },
              id: `priceplan_${Date.now()}`,
            },
          };
        }),
      }),
      apply_price_plan: tool({
        description:
          "Applica un piano prezzi calcolato da plan_prices. Rilegge i prezzi prima di scrivere: se qualcosa si e' mosso non scrive niente. Serve la conferma dell'utente.",
        parameters: z.object({
          channelSlug: z.string(),
          changes: z
            .array(z.object({ sku: z.string(), newPriceEur: z.number() }))
            .min(1),
          voucherUpdates: z
            .array(
              z.object({ voucherCode: z.string(), newDiscountEur: z.number() }),
            )
            .optional(),
          confirm: z
            .literal(true)
            .describe("solo dopo che l'utente ha confermato a voce il piano"),
          target: TARGET,
        }),
        execute: safe(async ({ target, channelSlug, changes, voucherUpdates }) => {
          // Ricalcoliamo il piano invece di fidarci di quello del turno prima:
          // le guardie (kit, prezzo valido, no-op) devono girare sui dati di ora.
          const plan = await planPrices(target, {
            channelSlug,
            requests: changes,
            voucherUpdates,
          });
          if (plan.errors.length) {
            return { applied: false, errors: plan.errors };
          }
          const outcome = await applyPricePlan(target, plan);
          return { applied: outcome.drift.length === 0, ...outcome };
        }),
      }),
    },
  });

  for await (const part of result.fullStream) yield part;
}

