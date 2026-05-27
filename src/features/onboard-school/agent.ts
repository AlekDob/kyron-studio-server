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
import { listPortals, getPortal } from "@/features/portals/reader.js";
import {
  updatePortal,
  deletePortal,
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
          "Recupera il dettaglio completo di un portale scuola dato il suo slug. Include indirizzo, catalogo prodotti, kit/bundle, branding, spedizione. Il client naviga automaticamente alla pagina dettaglio del portale. Usa questo tool quando l'utente chiede informazioni su un portale specifico.",
        parameters: z.object({
          slug: z.string().describe("slug del portale (es. 'martucelli-itc')"),
        }),
        execute: async ({ slug }) => {
          const portal = await getPortal(slug);
          if (!portal) return { error: `Portale "${slug}" non trovato.` };
          return { portal };
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
          slug: z.string().describe("slug del portale da aggiornare"),
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
          const portal = await getPortal(slug);
          if (!portal) return { error: `Portale "${slug}" non trovato.` };
          const updates: Record<string, unknown> = {};
          for (const [k, v] of Object.entries(fields)) {
            if (v != null) updates[k] = v;
          }
          if (Object.keys(updates).length === 0) {
            return { error: "Nessun campo da aggiornare." };
          }
          const result = await updatePortal(slug, updates);
          return {
            ...result,
            message: `Aggiornati ${result.updatedFields.join(", ")} per ${slug}.`,
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
          const portal = await getPortal(slug);
          if (!portal) return { error: `Portale "${slug}" non trovato.` };
          if (portal.nome.toLowerCase() !== confirmedName.toLowerCase()) {
            return {
              error: `Conferma non valida. Hai scritto "${confirmedName}" ma il portale si chiama "${portal.nome}". Riscrivi il nome esatto.`,
            };
          }
          const result = await deletePortal(slug);
          return {
            ...result,
            message: `Portale "${portal.nome}" (${slug}) eliminato definitivamente.`,
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
