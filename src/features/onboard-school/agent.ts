import { streamText, tool } from "ai";
import { z } from "zod";
import type { TenantConfig } from "@/config/tenants/index.js";
import { resolveModel } from "@/features/settings/resolve-model.js";
import { ONBOARD_SCHOOL_SYSTEM_PROMPT } from "./prompt.js";
import { pendingSchoolInputSchema, toCanonicalPendingSchool } from "./schema.js";
import {
  pendingSchoolSlugExists,
  writePendingSchoolMarkdown,
} from "./markdown-writer.js";
import { normalizePendingSchool } from "./normalize.js";
import { fetchSaleorProducts } from "@/core/saleor/client.js";
import { listPortals, resolvePortal } from "@/features/portals/reader.js";
import {
  updatePortal,
  deletePortal,
  addBundleToPortal,
  patchPortalCatalog,
  updateBundleInPortal,
  removeBundleFromPortal,
} from "@/features/portals/writer.js";
import { enablePortal } from "@/features/portals/enable/enable.js";
import { notifyPortalLive } from "@/features/portals/enable/notify.js";

interface AgentRunOptions {
  tenant: TenantConfig;
  cookie: string;
  // Email dell'agente Studio loggato che ha avviato l'onboarding (cookie kyron-rev).
  userEmail: string;
  messages: Array<{ role: "user" | "assistant"; content: string }>;
}

interface ProductDiscount {
  slug: string;
  // Taglio (slug valore capacita, es. "128gb") o null = prodotto intero.
  capacity: string | null;
  kind: "percent" | "eur";
  value: number;
}

interface VisibleVariant {
  productSlug: string;
  attribute: string;
  value: string;
}

interface PickerSelection {
  visibleSlugs: string[];
  visibleVariants: VisibleVariant[];
  productDiscounts: ProductDiscount[];
}

// Forma della submission ProductPicker (client): selezioni come {slug, capacitySlug?}
// e sconti come {slug, capacitySlug?, kind, value}. capacitySlug => taglio.
interface PickerSubmissionRow {
  slug: string;
  capacitySlug?: string | null;
}
interface PickerDiscountRow extends PickerSubmissionRow {
  kind: "percent" | "eur";
  value: number;
}

// Brain: la selezione catalogo (prodotti interi vs tagli) e gli sconti vengono
// presi DETERMINISTICAMENTE dall'ultima submission del ProductPicker (messaggio
// JSON generative_submission), NON dall'LLM che li droppa/confonde. Le righe con
// capacitySlug diventano visibleVariants (taglio), le altre visibleSlugs.
// Iniettati in save_pending_school.
function extractPickerSelection(
  messages: Array<{ role: string; content: string }>,
): PickerSelection | null {
  for (let i = messages.length - 1; i >= 0; i--) {
    const m = messages[i];
    if (m.role !== "user") continue;
    try {
      const p = JSON.parse(m.content) as {
        kind?: string;
        component?: string;
        data?: {
          selections?: PickerSubmissionRow[];
          productDiscounts?: PickerDiscountRow[];
        };
      };
      if (p?.kind !== "generative_submission" || p.component !== "ProductPicker") {
        continue;
      }
      const selections = p.data?.selections ?? [];
      const visibleSlugs: string[] = [];
      const visibleVariants: VisibleVariant[] = [];
      for (const s of selections) {
        if (s.capacitySlug) {
          visibleVariants.push({
            productSlug: s.slug,
            attribute: "capacita",
            value: s.capacitySlug,
          });
        } else {
          visibleSlugs.push(s.slug);
        }
      }
      const productDiscounts: ProductDiscount[] = (p.data?.productDiscounts ?? []).map(
        (d) => ({
          slug: d.slug,
          capacity: d.capacitySlug ?? null,
          kind: d.kind,
          value: d.value,
        }),
      );
      return { visibleSlugs, visibleVariants, productDiscounts };
    } catch {
      // non-JSON message, ignora
    }
  }
  return null;
}

type CanonicalComponent = {
  productSlug: string;
  selection:
    | { kind: "variant"; variantSku: string }
    | { kind: "by-attribute"; attribute: string; valueFilter: Record<string, string> };
};

// Mappa un componente flat {productSlug, variantSku?, capacity?} alla forma
// canonica `selection`. capacity => by-attribute su `colore` con la capacita
// fissata in valueFilter (il cliente sceglie il colore al checkout).
function toComponentSelection(c: {
  productSlug: string;
  variantSku?: string | null;
  capacity?: string | null;
}): CanonicalComponent {
  if (c.capacity) {
    return {
      productSlug: c.productSlug,
      selection: {
        kind: "by-attribute",
        attribute: "colore",
        valueFilter: { capacita: c.capacity },
      },
    };
  }
  return {
    productSlug: c.productSlug,
    selection: { kind: "variant", variantSku: c.variantSku ?? c.productSlug },
  };
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
  // Selezione catalogo + sconti deterministici dalla submission ProductPicker (non LLM).
  const pickerSelection = extractPickerSelection(opts.messages);

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
          "Mostra all'utente un builder visuale per comporre un KIT/bundle. USA QUESTO TOOL allo step 7 al posto di chiedere componenti/prezzo a parole. Passa gli `availableSlugs` raccolti nello step 6 (selectedSlugs dalla submission ProductPicker): il builder mostra solo i prodotti gia' selezionati dall'utente come componenti possibili del kit. Passa `includeProtection=true` SOLO se la protezione (es. Kyron Shield) e' INCLUSA nel bundle (durata fissa 24/36, scelta dal commerciale): in quel caso il builder mostra i piani protezione come righe-variante 24/36 selezionabili. L'utente sceglie nome, prezzo finale, e quali prodotti compongono il kit. Dopo il render, attendi il messaggio utente con la submission (formato JSON {name, priceEur, components}) prima di procedere.",
        parameters: z.object({
          availableSlugs: z
            .array(z.string())
            .describe(
              "Slug dei prodotti gia' selezionati dall'utente nello step 6 (catalogo). Il builder mostra solo questi come componenti possibili.",
            ),
          includeProtection: z
            .boolean()
            .describe(
              "true se la protezione e' INCLUSA nel bundle (Kyron Shield/AppleCare obbligatori, durata 24/36 scelta dal commerciale): il builder aggiunge le righe-variante protezione. false per add-on a catalogo (toggle cliente) o nessuna protezione.",
            ),
        }),
        execute: async ({ availableSlugs, includeProtection }) => {
          // Espandi le varianti protezione (Kyron Shield 24/36) per il contesto bundle.
          const all = await fetchSaleorProducts(undefined, 100, {
            expandProtectionVariants: true,
          });
          // Componenti normali: selezione catalogo, esclusi i piani protezione
          // (che entrano solo se inclusi nel bundle, per non sporcare l'add-on).
          const base = all.filter(
            (p) => availableSlugs.includes(p.slug) && !p.isProtectionPlan,
          );
          const protection = includeProtection
            ? all.filter((p) => p.isProtectionPlan)
            : [];
          const products = [...base, ...protection];
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
          "Salva la nuova scuola in Payload (collection pending-schools). I componenti di ogni bundle sono PIATTI: { productSlug, variantSku }. Chiama SOLO quando hai raccolto tutti i campi obbligatori (slug, nome, indirizzo completo, almeno 1 bundle) e l'utente ha confermato esplicitamente.",
        parameters: pendingSchoolInputSchema,
        execute: async (input) => {
          const doc = toCanonicalPendingSchool(input);
          // Override deterministico: selezione catalogo (prodotti interi vs tagli)
          // e sconti vengono dal ProductPicker, non dall'LLM (che a volte li omette
          // o confonde). Se la submission c'e', vince.
          if (pickerSelection) {
            doc.catalog = {
              ...doc.catalog,
              visibleSlugs: pickerSelection.visibleSlugs,
              visibleVariants: pickerSelection.visibleVariants,
              productDiscounts:
                pickerSelection.productDiscounts.length > 0
                  ? pickerSelection.productDiscounts
                  : doc.catalog.productDiscounts,
            };
          }
          // Fase A pipeline: normalizza contro il catalogo Saleor reale (SKU case,
          // protection plan hidden, coerenza heroOutsideBundle, sanity sconti eur).
          const normalized = await normalizePendingSchool(doc);
          if (normalized.errors.length > 0) {
            return {
              error: "Descriptor non valido, NON salvato. Correggi e riprova.",
              details: normalized.errors,
              autoFixes: normalized.fixes,
            };
          }
          const res = await writePendingSchoolMarkdown(normalized.doc, opts.userEmail);
          const fixNote =
            normalized.fixes.length > 0
              ? ` Correzioni automatiche applicate: ${normalized.fixes.join("; ")}.`
              : "";
          const skipNote = normalized.skippedValidation
            ? " ATTENZIONE: Saleor irraggiungibile, validazione catalogo saltata."
            : "";
          return {
            id: res.slug,
            filePath: res.filePath,
            overwrote: res.alreadyExisted,
            autoFixes: normalized.fixes,
            message:
              (res.alreadyExisted
                ? `Aggiornato ${res.filePath} (esisteva gia').`
                : `Salvato ${res.filePath}.`) + fixNote + skipNote,
          };
        },
      }),
      set_portal_status: tool({
        description:
          "Cambia SOLO lo stato di un portale esistente (draft=Bozza, review=Da rivedere, approved=Approvato, onboarded=Live/Completato). Usa QUESTO tool per qualunque richiesta di cambio stato (es. 'metti completato', 'segna come live') invece di update_portal. Parametri minimi: slug + status.",
        parameters: z.object({
          slug: z.string().describe("slug ESATTO o nome del portale (fuzzy match)"),
          status: z
            .enum(["draft", "review", "approved", "onboarded"])
            .describe("nuovo stato; 'completato'/'live' => onboarded"),
        }),
        execute: async ({ slug, status }) => {
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
          const result = await updatePortal(portal.slug, { status });
          return { ...result, message: `Stato di ${portal.nome} impostato a "${status}".` };
        },
      }),
      update_portal: tool({
        description:
          "Aggiorna campi specifici di un portale esistente. Per il solo STATO usa set_portal_status. Passa null per i campi che NON vuoi modificare. Usa SOLO per portali gia' salvati. Prima chiama get_portal per mostrare lo stato attuale, poi chiedi all'utente cosa vuole cambiare.",
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
                variantSku: z.string().nullable().describe("SKU della variante fissa (accessori monovariante); usa il productSlug se non c'e' variante specifica. null se usi capacity."),
                capacity: z.string().nullable().describe("slug taglio capacita (es. '128gb'): il componente diventa by-attribute (cliente sceglie il colore al checkout). null se usi variantSku."),
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
            components: components.map((c) => toComponentSelection(c)),
          });
          return {
            ...result,
            message: `Bundle "${name}" aggiunto a ${portal.nome} (${result.total} kit totali).`,
          };
        },
      }),
      update_catalog: tool({
        description:
          "Sostituisce le liste del catalogo di un portale esistente: visibleSlugs (prodotti interi) e/o visibleVariants (tagli capacita, es. iPad 128gb). Usa per aggiungere/rimuovere prodotti dal portale. Passa SEMPRE la lista completa del campo che tocchi (non un diff), null per i campi che non tocchi. Dopo le modifiche, ricorda all'utente di applicarle con apply_to_saleor.",
        parameters: z.object({
          portalSlug: z.string(),
          visibleSlugs: z
            .array(z.string())
            .nullable()
            .describe("nuova lista completa di slug prodotti visibili, o null"),
          visibleVariants: z
            .array(
              z.object({
                productSlug: z.string(),
                value: z.string().describe("slug taglio capacita, es. '128gb'"),
              }),
            )
            .nullable()
            .describe("nuova lista completa dei tagli pubblicati, o null"),
        }),
        execute: async ({ portalSlug, visibleSlugs, visibleVariants }) => {
          const { portal, candidates } = await resolvePortal(portalSlug);
          if (!portal) {
            if (candidates.length > 1) {
              return {
                error: `"${portalSlug}" e' ambiguo (${candidates.length} match).`,
                candidates: candidates.map((c) => ({ slug: c.slug, nome: c.nome })),
              };
            }
            return { error: `Portale "${portalSlug}" non trovato.` };
          }
          if (visibleSlugs == null && visibleVariants == null) {
            return { error: "Nessuna lista da aggiornare." };
          }
          const result = await patchPortalCatalog(portal.slug, {
            ...(visibleSlugs ? { visibleSlugs } : {}),
            ...(visibleVariants
              ? {
                  visibleVariants: visibleVariants.map((v) => ({
                    productSlug: v.productSlug,
                    attribute: "capacita",
                    value: v.value,
                  })),
                }
              : {}),
          });
          return {
            ...result,
            message: `Catalogo ${portal.nome} aggiornato (${result.updatedFields.join(", ")}). Le modifiche vanno applicate a Saleor con apply_to_saleor.`,
          };
        },
      }),
      update_discounts: tool({
        description:
          "Sostituisce l'intera lista catalog.productDiscounts di un portale (cambi sconto richiesti dai commerciali). kind 'eur' = PREZZO FINALE in EUR (non lo sconto!); kind 'percent' = percentuale 1-90. capacity (es. '128gb') limita lo sconto a quel taglio. Passa la lista COMPLETA (non un diff: gli sconti omessi vengono rimossi). Dopo, applica con apply_to_saleor.",
        parameters: z.object({
          portalSlug: z.string(),
          productDiscounts: z.array(
            z.object({
              slug: z.string(),
              capacity: z.string().nullable().describe("slug taglio (es. '128gb') o null = prodotto intero"),
              kind: z.enum(["percent", "eur"]),
              value: z.number().positive(),
            }),
          ),
        }),
        execute: async ({ portalSlug, productDiscounts }) => {
          const { portal, candidates } = await resolvePortal(portalSlug);
          if (!portal) {
            if (candidates.length > 1) {
              return {
                error: `"${portalSlug}" e' ambiguo (${candidates.length} match).`,
                candidates: candidates.map((c) => ({ slug: c.slug, nome: c.nome })),
              };
            }
            return { error: `Portale "${portalSlug}" non trovato.` };
          }
          // Sanity contro i listini reali: 'eur' e' il prezzo FINALE — un valore
          // molto sotto il listino e' quasi certamente uno sconto scritto male
          // (gotcha-onboarding-productdiscount-final-price).
          const products = await fetchSaleorProducts();
          const errors: string[] = [];
          for (const d of productDiscounts) {
            const row = products.find((p) =>
              d.capacity ? p.id === `${d.slug}#${d.capacity}` : p.id === d.slug,
            );
            if (!row) {
              errors.push(`Prodotto "${d.slug}${d.capacity ? `#${d.capacity}` : ""}" non trovato su Saleor.`);
              continue;
            }
            if (d.kind === "percent" && (d.value <= 0 || d.value > 90)) {
              errors.push(`${d.slug}: percent ${d.value} fuori range 1-90.`);
            }
            if (d.kind === "eur" && d.value >= row.priceEur) {
              errors.push(`${d.slug}: prezzo finale ${d.value} >= listino ${row.priceEur}.`);
            }
            if (d.kind === "eur" && d.value < row.priceEur * 0.3) {
              errors.push(
                `${d.slug}: ${d.value} EUR sembra uno SCONTO ma 'eur' e' il PREZZO FINALE (listino ${row.priceEur}). Conferma con l'utente il prezzo finale corretto.`,
              );
            }
          }
          if (errors.length > 0) return { error: "Sconti non validi, NON salvati.", details: errors };
          const result = await patchPortalCatalog(portal.slug, { productDiscounts });
          return {
            ...result,
            message: `Sconti di ${portal.nome} aggiornati (${productDiscounts.length}). Applicali con apply_to_saleor.`,
          };
        },
      }),
      apply_to_saleor: tool({
        description:
          "Applica lo stato corrente del portale (catalogo, tagli, sconti, bundle) a Saleor STAGING e PROD: seed idempotente + riconciliazione (i prodotti rimossi dal portale vengono nascosti dal channel). Operazione lunga (~30-90s). Usa DOPO update_catalog/update_discounts/update_bundle, o per il primo go-live. Chiedi conferma all'utente prima di chiamarlo.",
        parameters: z.object({
          portalSlug: z.string(),
        }),
        execute: async ({ portalSlug }) => {
          const { portal, candidates } = await resolvePortal(portalSlug);
          if (!portal) {
            if (candidates.length > 1) {
              return {
                error: `"${portalSlug}" e' ambiguo (${candidates.length} match).`,
                candidates: candidates.map((c) => ({ slug: c.slug, nome: c.nome })),
              };
            }
            return { error: `Portale "${portalSlug}" non trovato.` };
          }
          try {
            const firstGoLive = portal.status !== "onboarded";
            const report = await enablePortal(portal.slug);
            // Mail "portale live" solo al primo go-live, non ad ogni modifica.
            const emailSent = firstGoLive
              ? await notifyPortalLive(portal.slug, report)
              : false;
            return {
              report: report.targets.map((t) => ({
                target: t.target,
                channelId: t.channelId,
                prodotti: t.productsPublished,
                promozioni: t.promotionsApplied,
                voucher: Object.keys(t.vouchers).length,
                sconti_attivi: t.promotionsOnSale,
                steps: t.steps,
              })),
              emailSent,
              message: `Portale ${portal.nome} applicato a Saleor (staging+prod).${
                report.targets.some((t) => t.promotionsOnSale === false)
                  ? " ATTENZIONE: sconti non ancora attivi (recalc Saleor in coda)."
                  : ""
              }${firstGoLive && emailSent ? " Mail di go-live inviata." : ""}`,
            };
          } catch (err) {
            return { error: err instanceof Error ? err.message : "enable failed" };
          }
        },
      }),
      update_bundle: tool({
        description:
          "Modifica nome, prezzo e/o componenti di un bundle esistente. Passa null per i campi che NON vuoi modificare. Per `components` passa l'intera lista nuova (non un diff).",
        parameters: z.object({
          portalSlug: z.string(),
          bundleSlug: z.string(),
          name: z.string().nullable(),
          finalPriceEur: z.number().positive().nullable(),
          components: z
            .array(
              z.object({
                productSlug: z.string(),
                variantSku: z.string().nullable(),
                capacity: z
                  .string()
                  .nullable()
                  .describe("slug taglio capacita (es. '128gb') => by-attribute colore; null se usi variantSku"),
              }),
            )
            .nullable()
            .describe("intera nuova lista componenti, o null per non toccare"),
        }),
        execute: async ({ portalSlug, bundleSlug, name, finalPriceEur, components }) => {
          const { portal, candidates } = await resolvePortal(portalSlug);
          if (!portal) {
            if (candidates.length > 1) {
              return {
                error: `"${portalSlug}" e' ambiguo.`,
                candidates: candidates.map((c) => ({ slug: c.slug, nome: c.nome })),
              };
            }
            return { error: `Portale "${portalSlug}" non trovato.` };
          }
          const patch: {
            name?: string;
            finalPriceEur?: number;
            components?: CanonicalComponent[];
          } = {};
          if (name != null) patch.name = name;
          if (finalPriceEur != null) patch.finalPriceEur = finalPriceEur;
          if (components != null) {
            patch.components = components.map((c) => toComponentSelection(c));
          }
          try {
            const result = await updateBundleInPortal(
              portal.slug,
              bundleSlug,
              patch,
            );
            return {
              ...result,
              message: `Bundle ${bundleSlug} aggiornato: ${result.updatedFields.join(", ")}.`,
            };
          } catch (err) {
            return { error: err instanceof Error ? err.message : "update failed" };
          }
        },
      }),
      remove_bundle: tool({
        description:
          "Rimuove un bundle/kit da un portale. ATTENZIONE: irreversibile. Chiedi conferma all'utente PRIMA di chiamare il tool.",
        parameters: z.object({
          portalSlug: z.string(),
          bundleSlug: z.string(),
        }),
        execute: async ({ portalSlug, bundleSlug }) => {
          const { portal } = await resolvePortal(portalSlug);
          if (!portal) return { error: `Portale "${portalSlug}" non trovato.` };
          try {
            const result = await removeBundleFromPortal(portal.slug, bundleSlug);
            return {
              ...result,
              message: `Bundle ${bundleSlug} rimosso da ${portal.nome} (${result.total} kit rimanenti).`,
            };
          } catch (err) {
            return { error: err instanceof Error ? err.message : "remove failed" };
          }
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
