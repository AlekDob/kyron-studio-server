import { streamText, tool } from "ai";
import { z } from "zod";
import type { TenantConfig } from "@/config/tenants/index.js";
import { resolveModel } from "@/features/settings/resolve-model.js";
import { ONBOARD_SCHOOL_SYSTEM_PROMPT } from "./prompt.js";
import { pendingSchoolSchema } from "./schema.js";
import {
  pendingSchoolSlugExists,
  writePendingSchoolMarkdown,
} from "./markdown-writer.js";
import { fetchSaleorProducts } from "@/core/saleor/client.js";
import { listPortals, resolvePortal } from "@/features/portals/reader.js";
import {
  updatePortal,
  deletePortal,
  addBundleToPortal,
} from "@/features/portals/writer.js";

interface AgentRunOptions {
  tenant: TenantConfig;
  cookie: string;
  messages: Array<{ role: "user" | "assistant"; content: string }>;
}

export async function* runOnboardSchoolAgent(opts: AgentRunOptions) {
  // Brain: WS04 (decision-015 + diary 2026-05-26) — l'agente onboarding
  // bypassa Payload e scrive il descriptor .md direttamente su filesystem
  // via markdown-writer. La collection PendingSchools cms ha schema drift
  // in dev e il flusso e2e e' lo stesso (Alek copia .md in ecommerce e
  // lancia seed/onboard-school.ts). `opts.tenant` e `opts.cookie` restano
  // nella signature per compatibilita' col route SSE.
  void opts.tenant;
  void opts.cookie;
  const { model } = await resolveModel("onboard-school", "default");

  const result = streamText({
    model,
    system: ONBOARD_SCHOOL_SYSTEM_PROMPT,
    messages: opts.messages,
    maxSteps: 8,
    tools: {
      render_product_picker: tool({
        description:
          "Mostra all'utente un picker visuale del catalogo prodotti scuola da cui selezionare gli accessori visibili sul portale. I prodotti vengono caricati live dal catalogo Saleor. USA QUESTO TOOL al posto di elencare i prodotti a parole nello step 6 (catalogo). Restituisce un descriptor _ui che il client renderizza come componente interattivo. Dopo il render, attendi il messaggio utente con la selezione (formato JSON {selectedSlugs: [...]}) prima di procedere.",
        parameters: z.object({
          multi: z
            .boolean()
            .describe("true se l'utente puo' selezionare piu' prodotti (default per il catalogo)"),
        }),
        execute: async ({ multi }) => {
          const products = await fetchSaleorProducts();
          return {
            _ui: {
              component: "ProductPicker",
              props: { products, multi },
              id: `pick_${Date.now()}`,
            },
            message: `Picker con ${products.length} prodotti dal catalogo Saleor. Attendi la selezione.`,
          };
        },
      }),
      render_bundle_builder: tool({
        description:
          "Mostra all'utente un builder visuale per comporre un KIT/bundle. USA QUESTO TOOL allo step 7 al posto di chiedere componenti/prezzo a parole. Passa gli `availableSlugs` raccolti nello step 6 (selectedSlugs dalla submission ProductPicker): il builder mostra solo i prodotti gia' selezionati dall'utente come componenti possibili del kit. L'utente sceglie nome, prezzo finale, e quali prodotti compongono il kit. Dopo il render, attendi il messaggio utente con la submission (formato JSON {name, priceEur, components}) prima di procedere.",
        parameters: z.object({
          availableSlugs: z
            .array(z.string())
            .describe(
              "Slug dei prodotti gia' selezionati dall'utente nello step 6 (catalogo). Il builder mostra solo questi come componenti possibili.",
            ),
        }),
        execute: async ({ availableSlugs }) => {
          const all = await fetchSaleorProducts();
          const products = all.filter((p) =>
            availableSlugs.includes(p.slug),
          );
          return {
            _ui: {
              component: "BundleBuilder",
              props: { products },
              id: `bundle_${Date.now()}`,
            },
            message:
              "Bundle builder renderizzato. Attendi la submission utente prima di continuare.",
          };
        },
      }),
      check_slug_availability: tool({
        description:
          "Verifica se uno slug (kebab-case, es. 'orsoline-san-carlo') e' disponibile per una nuova scuola. Chiama questo PRIMA di proporre uno slug all'utente. La verifica controlla se esiste gia' un descriptor .md nello stesso slug.",
        parameters: z.object({ slug: z.string().min(2) }),
        execute: async ({ slug }) => {
          const exists = await pendingSchoolSlugExists(slug);
          return { slug, available: !exists };
        },
      }),
      validate_school_data: tool({
        description:
          "Valida i campi raccolti prima di salvare. Passa null per i campi non ancora raccolti. Controlla: slug kebab-case, sigla provincia ISO (2 lettere), codice MIUR formato (10 char alfanum o 'TBD'), CAP italiano (5 cifre), URL sito valido. Chiama PRIMA di save_pending_school. Restituisce array di errori da risolvere o ok:true.",
        parameters: z.object({
          slug: z.string().nullable(),
          countryArea: z.string().nullable(),
          codiceMeccanografico: z.string().nullable(),
          postalCode: z.string().nullable(),
          sitoUfficiale: z.string().nullable(),
        }),
        execute: async (input) => {
          const errors: string[] = [];
          if (input.slug && !/^[a-z0-9-]+$/.test(input.slug)) {
            errors.push("slug deve essere kebab-case (a-z, 0-9, trattini)");
          }
          if (input.countryArea && !/^[A-Z]{2}$/.test(input.countryArea)) {
            errors.push("countryArea deve essere sigla provincia ISO 2 lettere maiuscole (es. MI)");
          }
          if (
            input.codiceMeccanografico &&
            input.codiceMeccanografico !== "TBD" &&
            !/^[A-Z0-9]{10}$/.test(input.codiceMeccanografico)
          ) {
            errors.push("codiceMeccanografico: 10 caratteri alfanumerici maiuscoli, oppure 'TBD'");
          }
          if (input.postalCode && !/^\d{5}$/.test(input.postalCode)) {
            errors.push("postalCode: 5 cifre (CAP italiano)");
          }
          if (input.sitoUfficiale) {
            try {
              new URL(input.sitoUfficiale);
            } catch {
              errors.push("sitoUfficiale: URL non valido");
            }
          }
          return errors.length === 0
            ? { ok: true }
            : { ok: false, errors };
        },
      }),
      list_portals: tool({
        description:
          "Elenca tutti i portali scuola configurati con il loro stato (draft, review, approved, onboarded), citta', numero prodotti e kit. Usa questo tool quando l'utente chiede di vedere i portali esistenti, fare un riepilogo, o analizzare lo stato dei portali.",
        parameters: z.object({}),
        execute: async () => {
          const portals = await listPortals();
          return {
            portals,
            total: portals.length,
            message: portals.length === 0
              ? "Nessun portale configurato."
              : `${portals.length} portali trovati.`,
          };
        },
      }),
      get_portal: tool({
        description:
          "Recupera il dettaglio completo di un portale scuola. Accetta slug esatto (es. 'itc-martinelli-pisa') OPPURE nome (es. 'ITC Martinelli'): il tool fa fuzzy match su entrambi. Include indirizzo, catalogo, kit, branding, spedizione. Usa questo tool quando l'utente chiede informazioni su un portale specifico.",
        parameters: z.object({
          query: z
            .string()
            .describe("slug o nome del portale (fuzzy match case-insensitive)"),
        }),
        execute: async ({ query }) => {
          const { portal, candidates } = await resolvePortal(query);
          if (portal) return { portal };
          if (candidates.length > 1) {
            return {
              error: `Trovati ${candidates.length} portali che corrispondono a "${query}". Specifica meglio.`,
              candidates: candidates.map((c) => ({ slug: c.slug, nome: c.nome })),
            };
          }
          return { error: `Nessun portale trovato per "${query}".` };
        },
      }),
      save_pending_school: tool({
        description:
          "Salva la nuova scuola come descriptor .md su filesystem. Chiama SOLO quando hai raccolto tutti i campi obbligatori (slug, nome, indirizzo completo, almeno 1 bundle) e l'utente ha confermato esplicitamente.",
        parameters: pendingSchoolSchema,
        execute: async (input) => {
          const res = await writePendingSchoolMarkdown(input);
          return {
            id: res.slug,
            filePath: res.filePath,
            overwrote: res.alreadyExisted,
            message: res.alreadyExisted
              ? `Aggiornato ${res.filePath} (esisteva gia').`
              : `Salvato ${res.filePath}. Alek lo committera' in kyron-ecommerce.`,
          };
        },
      }),
      update_portal: tool({
        description:
          "Aggiorna campi specifici di un portale esistente. Passa null per i campi che NON vuoi modificare. Usa SOLO per portali gia' salvati. Prima chiama get_portal per mostrare lo stato attuale, poi chiedi all'utente cosa vuole cambiare.",
        parameters: z.object({
          slug: z.string().describe("slug ESATTO del portale (ottenuto da get_portal/list_portals)"),
          nome: z.string().nullable().describe("nuovo nome (null = invariato)"),
          sitoUfficiale: z.string().nullable().describe("nuovo sito (null = invariato)"),
          codiceMeccanografico: z.string().nullable().describe("nuovo codice MIUR (null = invariato)"),
          streetAddress1: z.string().nullable().describe("nuova via (null = invariata)"),
          postalCode: z.string().nullable().describe("nuovo CAP (null = invariato)"),
          city: z.string().nullable().describe("nuova citta' (null = invariata)"),
          countryArea: z.string().nullable().describe("nuova provincia 2 lettere (null = invariata)"),
          phone: z.string().nullable().describe("nuovo telefono (null = invariato)"),
          shipToSchool: z.boolean().nullable().describe("spedizione a scuola (null = invariato)"),
          status: z.enum(["draft", "review", "approved", "onboarded"]).nullable().describe("nuovo stato (null = invariato)"),
        }),
        execute: async ({ slug, ...fields }) => {
          const { portal, candidates } = await resolvePortal(slug);
          if (!portal) {
            if (candidates.length > 1) {
              return {
                error: `"${slug}" e' ambiguo (${candidates.length} match). Specifica lo slug esatto.`,
                candidates: candidates.map((c) => ({ slug: c.slug, nome: c.nome })),
              };
            }
            return { error: `Portale "${slug}" non trovato.` };
          }
          const realSlug = portal.slug;
          const updates: Record<string, unknown> = {};
          for (const [k, v] of Object.entries(fields)) {
            if (v != null) updates[k] = v;
          }
          if (Object.keys(updates).length === 0) {
            return { error: "Nessun campo da aggiornare." };
          }
          const result = await updatePortal(realSlug, updates);
          return {
            ...result,
            message: `Aggiornati ${result.updatedFields.join(", ")} per ${realSlug}.`,
          };
        },
      }),
      delete_portal: tool({
        description:
          "Elimina definitivamente un portale. ATTENZIONE: azione irreversibile. L'utente DEVE scrivere il nome esatto del portale come conferma. Se il nome non corrisponde, rifiuta.",
        parameters: z.object({
          slug: z.string().describe("slug del portale da eliminare"),
          confirmedName: z.string().describe("nome ESATTO del portale scritto dall'utente come conferma"),
        }),
        execute: async ({ slug, confirmedName }) => {
          const { portal, candidates } = await resolvePortal(slug);
          if (!portal) {
            if (candidates.length > 1) {
              return {
                error: `"${slug}" e' ambiguo (${candidates.length} match). Specifica lo slug esatto.`,
                candidates: candidates.map((c) => ({ slug: c.slug, nome: c.nome })),
              };
            }
            return { error: `Portale "${slug}" non trovato.` };
          }
          if (portal.nome.toLowerCase() !== confirmedName.toLowerCase()) {
            return {
              error: `Conferma non valida. Hai scritto "${confirmedName}" ma il portale si chiama "${portal.nome}". Riscrivi il nome esatto.`,
            };
          }
          const result = await deletePortal(portal.slug);
          return {
            ...result,
            message: `Portale "${portal.nome}" (${slug}) eliminato definitivamente.`,
          };
        },
      }),
      add_bundle_to_portal: tool({
        description:
          "Aggiunge (o sostituisce se lo slug esiste gia') un bundle/kit a un portale ESISTENTE. Usa questo tool dopo la submission del BundleBuilder quando l'utente sta modificando un portale gia' salvato (NON durante l'onboarding di un nuovo portale: in quel caso i bundle vanno in save_pending_school).",
        parameters: z.object({
          portalSlug: z.string().describe("slug del portale (es. 'itc-martinelli-pisa')"),
          bundleSlug: z
            .string()
            .describe("slug del bundle kebab-case (es. 'kit-base'). Se gia' esiste verra' sostituito."),
          name: z.string().describe("nome visibile del kit"),
          finalPriceEur: z.number().positive().describe("prezzo finale in EUR"),
          components: z
            .array(
              z.object({
                productSlug: z.string(),
                variantSku: z.string().describe("SKU della variante; usa il productSlug se la submission non specifica una variante diversa"),
              }),
            )
            .min(1)
            .describe("componenti del kit dal BundleBuilder"),
        }),
        execute: async ({ portalSlug, bundleSlug, name, finalPriceEur, components }) => {
          const { portal, candidates } = await resolvePortal(portalSlug);
          if (!portal) {
            if (candidates.length > 1) {
              return {
                error: `"${portalSlug}" e' ambiguo (${candidates.length} match). Specifica lo slug esatto.`,
                candidates: candidates.map((c) => ({ slug: c.slug, nome: c.nome })),
              };
            }
            return { error: `Portale "${portalSlug}" non trovato.` };
          }
          const result = await addBundleToPortal(portal.slug, {
            slug: bundleSlug,
            name,
            finalPriceEur,
            components: components.map((c) => ({
              productSlug: c.productSlug,
              selection: { kind: "variant", variantSku: c.variantSku },
            })),
          });
          return {
            ...result,
            message: `Bundle "${name}" aggiunto a ${portal.nome} (${result.total} kit totali).`,
          };
        },
      }),
      render_logo_uploader: tool({
        description:
          "Mostra un uploader per il logo della scuola. Il file viene caricato, validato (PNG/JPG/WebP) e salvato. Usa questo tool allo step 5 (logo) al posto di chiedere a parole. Se il portale e' gia' salvato, passa lo slug. Se ancora in fase di onboarding, passa lo slug proposto.",
        parameters: z.object({
          slug: z.string().describe("slug del portale (esistente o proposto)"),
        }),
        execute: async ({ slug }) => {
          return {
            _ui: {
              component: "LogoUploader",
              props: { slug },
              id: `logo_${Date.now()}`,
            },
            message: "Uploader logo renderizzato. Attendi il caricamento.",
          };
        },
      }),
    },
  });

  for await (const part of result.fullStream) {
    yield part;
  }
}
