// Nico — agente del modulo Commesso. Legge e scrive il catalogo Saleor.
// I tool non lanciano mai: un errore torna come dato, cosi' Nico lo spiega
// invece di far cadere lo stream.
import { streamText, tool } from "ai";
import { z } from "zod";
import type { TenantConfig } from "@/config/tenants/index.js";
import { resolveModel } from "@/features/settings/resolve-model.js";
import type { SaleorTarget } from "@/features/portals/enable/saleor-admin.js";
import { COMMESSO_SYSTEM_PROMPT } from "./prompt.js";
import { safe } from "./tool-safe.js";
import { orderTools } from "./order-tools.js";
import { ddtTools } from "./ddt-tools.js";
import { getCatalogMeta, getChannelDirectory, getProduct, listProducts, narrowProductToChannel, resolveChannelSlug, type ProductRow } from "./reads.js";
import { planPrices } from "./plan-service.js";
import { planDaneaImport } from "./danea-service.js";
import { applyDaneaPlan } from "./danea-apply.js";
import type { DaneaPlan } from "./danea-plan.js";
import { addProductsToPortals } from "./danea-portals.js";
import { resolveProductsImport, saveCreatedSlugs } from "./danea-uploads.js";
import { applyPricePlan, resolveChannelId } from "./price-writes.js";
import { runPriceGuard } from "@/features/price-guard/check.js";
import { resolvePortal } from "@/features/portals/reader.js";
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

// Il result completo va al client (il pannello ci prende le thumbnail), ma al
// modello serve solo il testo: senza imageUrl non puo' incollare foto in chat,
// e senza description/id il contesto non si riempie di roba inutile.
function slim<T extends { imageUrl?: unknown; description?: unknown; id?: unknown }>(
  row: T,
): Omit<T, "imageUrl" | "description" | "id"> {
  const { imageUrl: _i, description: _d, id: _x, ...rest } = row;
  return rest;
}

function asText(value: unknown) {
  return [{ type: "text" as const, text: JSON.stringify(value) }];
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
      ...orderTools,
      ...ddtTools(opts.userEmail),
      list_products: tool({
        description:
          "Cerca prodotti nel catalogo Saleor (anche non pubblicati) per nome, slug o SKU. Passa channelSlug quando l'utente parla di un portale: filtra quel canale e torna i prezzi di quel canale.",
        parameters: z.object({
          search: z.string().optional().describe("testo da cercare; vuoto = tutto"),
          channelSlug: z
            .string()
            .optional()
            .describe("slug o nome scuola (es. orsoline); il tool lo risolve"),
          target: TARGET,
        }),
        execute: safe(async ({ search, channelSlug, target }) => {
          let slug = channelSlug?.trim() || undefined;
          if (slug) {
            const resolved = resolveChannelSlug(slug, await getChannelDirectory(target));
            if ("slug" in resolved) {
              slug = resolved.slug;
            } else {
              const names = resolved.candidates.map((c) => c.slug);
              return {
                count: 0,
                products: [],
                channelSlug: null,
                error:
                  names.length === 0
                    ? `Canale "${channelSlug}" non trovato.`
                    : `Canale ambiguo, scegli uno slug: ${names.join(", ")}`,
              };
            }
          }
          const products = await listProducts(target, { search, channelSlug: slug });
          return { count: products.length, products, channelSlug: slug ?? null };
        }),
        experimental_toToolResultContent: (r) =>
          asText(
            "products" in r
              ? {
                  count: r.count,
                  channelSlug: r.channelSlug,
                  ...("error" in r && r.error ? { error: r.error } : {}),
                  products: r.products.map((p: ProductRow) =>
                    slim(r.channelSlug ? narrowProductToChannel(p, r.channelSlug) : p),
                  ),
                }
              : r,
          ),
      }),
      get_product: tool({
        description: "Scheda completa di un prodotto dal suo slug.",
        parameters: z.object({ slug: z.string(), target: TARGET }),
        execute: safe(async ({ slug, target }) => {
          const product = await getProduct(target, slug);
          return product ?? { error: `Prodotto "${slug}" non trovato su ${target}` };
        }),
        experimental_toToolResultContent: (r) => asText("slug" in r ? slim(r) : r),
      }),
      get_catalog_meta: tool({
        description:
          "Canali (slug e nome scuola), categorie, tipi prodotto e magazzini realmente esistenti. Da leggere per risolvere un nome scuola o prima di creare un prodotto.",
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
          "Mostra il riquadro per caricare un file XML di Danea: listino prodotti (EcommProdotti.xml) o export di DDT. Chiamalo ogni volta che serve il file: mai descriverlo a parole.",
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
          importId: z
            .string()
            .optional()
            .describe("id dan_... della card; se manca si usa l'ultimo file in memoria"),
          channelSlug: z.string().describe("canale su cui confrontare i prezzi"),
          target: TARGET,
        }),
        execute: safe(async ({ importId, channelSlug, target }) => {
          const entry = resolveProductsImport(
            importId,
            opts.messages.map((m) => m.content),
          );
          const plan = await planDaneaImport(target, { importId: entry.id, channelSlug });
          return {
            target,
            importId: entry.id,
            plan,
            _ui: {
              component: "DaneaImportPlan",
              props: { target, importId: entry.id, plan },
              id: `daneaplan_${Date.now()}`,
            },
          };
        }),
        experimental_toToolResultContent: (r) =>
          asText(
            "error" in r && r.error
              ? r
              : {
                  importId: "importId" in r ? r.importId : undefined,
                  totals: "plan" in r ? r.plan.totals : undefined,
                  newGroups:
                    "plan" in r
                      ? (r.plan as DaneaPlan).groups
                          .filter((g) => g.newVariants.length > 0)
                          .map((g) => ({ aggregator: g.aggregator, suggestedName: g.suggestedName }))
                      : [],
                  note: "I nomi si confermano sulla card, non in questo risultato.",
                },
          ),
      }),
      apply_danea_import: tool({
        description:
          "Crea i prodotti e le varianti NUOVE. I mapping stanno sulla card (gia' confermati). NON inventare mappings. Nascono non pubblicati.",
        parameters: z.object({
          importId: z.string().optional(),
          channelSlug: z.string(),
          confirm: z.literal(true),
          target: TARGET,
        }),
        execute: safe(async ({ importId, channelSlug, target }) => {
          const entry = resolveProductsImport(
            importId,
            opts.messages.map((m) => m.content),
          );
          if (!entry.mappingsConfirmed || !entry.mappings?.length) {
            return { error: "Conferma i nomi sulla card prima di applicare." };
          }
          const plan = await planDaneaImport(target, { importId: entry.id, channelSlug });
          const result = await applyDaneaPlan(target, {
            channelSlug,
            groups: plan.groups,
            mappings: entry.mappings,
          });
          saveCreatedSlugs(entry.id, result.createdProducts);
          return result;
        }),
      }),
      add_to_portals: tool({
        description:
          "Aggiunge prodotti gia' creati a portali scuola scelti (checkbox). Mai tutti i portali. Serve conferma.",
        parameters: z.object({
          productSlugs: z.array(z.string()).min(1),
          portalSlugs: z.array(z.string()).min(1),
          confirm: z.literal(true),
          target: TARGET,
        }),
        execute: safe(async ({ productSlugs, portalSlugs, target }) => {
          return addProductsToPortals({ productSlugs, portalSlugs, target });
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
      run_all_checks: tool({
        description:
          "Price Guard su TUTTI i portali onboarded: verifica prezzi, sconti e voucher dei kit su Saleor produzione. SOLA LETTURA, non tocca niente. Usalo quando l'utente chiede un giro di controlli senza nominare un portale, e SEMPRE da solo dopo aver applicato un piano prezzi.",
        parameters: z.object({}),
        execute: safe(async () => {
          const anomalies = await runPriceGuard();
          return {
            count: anomalies.length,
            anomalies,
            _ui: { component: "AnomalyReport", props: { anomalies }, id: `pg_all_${Date.now()}` },
          };
        }),
      }),
      check_portal: tool({
        description:
          "Price Guard su UN portale (nome o slug, fuzzy match). SOLA LETTURA. Usalo quando l'utente nomina una scuola, e subito dopo aver cambiato prezzi su quel portale.",
        parameters: z.object({
          query: z.string().describe("nome o slug del portale, es. 'massari'"),
        }),
        execute: safe(async ({ query }) => {
          const res = await resolvePortal(query);
          if (!res.portal) {
            return {
              resolved: false,
              message: `Portale "${query}" non risolto univocamente.`,
              candidates: res.candidates.map((c) => ({ slug: c.slug, nome: c.nome })),
            };
          }
          const anomalies = await runPriceGuard({ portalSlug: res.portal.slug });
          return {
            resolved: true,
            portal: res.portal.slug,
            count: anomalies.length,
            anomalies,
            _ui: {
              component: "AnomalyReport",
              props: { anomalies },
              id: `pg_${res.portal.slug}_${Date.now()}`,
            },
          };
        }),
      }),
    },
  });

  for await (const part of result.fullStream) yield part;
}

