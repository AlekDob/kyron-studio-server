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
import { normalizePendingSchool, fetchCatalogIndex } from "./normalize.js";
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

// Filtro e tab del pannello Portali: gli stessi valori di `portals-filter.ts`
// lato studio (una parola sbagliata qui e la ricevuta viene scartata).
const PORTAL_STATUS = z.enum(["all", "live", "bozze"]);
const PORTAL_TAB = z.enum(["informazioni", "catalogo", "kit"]);

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

// Brain: gotcha-portal-kit-slug-mismatch — i tool bundle devono validare i
// productSlug (e gli SKU variante) contro Saleor PRIMA di persistere. Senza
// questo, l'LLM puo' salvare slug inventati dal nome (es. "ipad"/"apple-pencil-
// usb-c" invece di "ipada16"/"muwa3zm-a") che passano il save ed esplodono solo
// al publish (enablePortal -> normalize). Stessa regola di normalize, anticipata
// all'edit cosi' l'agente riceve subito la lista degli slug validi e ritenta.
// Fail-open come normalize: Saleor irraggiungibile non blocca (l'enable rivalida).
async function validateComponentsAgainstSaleor(
  components: CanonicalComponent[],
): Promise<string[]> {
  let index: Awaited<ReturnType<typeof fetchCatalogIndex>>;
  try {
    index = await fetchCatalogIndex();
  } catch {
    return [];
  }
  const errors: string[] = [];
  for (const c of components) {
    const product = index.get(c.productSlug);
    if (!product) {
      errors.push(
        `Prodotto "${c.productSlug}" inesistente su Saleor. Slug validi: ${[...index.keys()].join(", ")}`,
      );
      continue;
    }
    if (c.selection.kind === "variant") {
      const sku = c.selection.variantSku;
      const ok = product.variants.some(
        (v) => v.sku.toLowerCase() === sku.toLowerCase(),
      );
      if (!ok) {
        errors.push(
          `SKU "${sku}" inesistente su "${c.productSlug}". SKU disponibili: ${product.variants.map((v) => v.sku).join(", ")}`,
        );
      }
    }
  }
  return errors;
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
          const all = await fetchSaleorProducts();
          // I piani protezione (AppleCare, Kyron Shield) NON vanno nel picker
          // catalogo: la protezione si raccoglie con la domanda dedicata (step
          // 6b), non ticchettandola qui (era ridondante e incoerente). Li
          // separiamo: il picker mostra solo prodotti reali; gli slug protezione
          // tornano nel result cosi' l'agente puo' usarli in add-on (hiddenSlugs)
          // senza UI.
          const products = all.filter((p) => !p.isProtectionPlan);
          // Esponiamo anche il LISTINO: l'agente lo usa allo step 6b per chiedere
          // lo sconto sul piano (es. AppleCare 79 -> 75) e mostrarlo all'utente.
          const availableProtectionPlans = all
            .filter((p) => p.isProtectionPlan)
            .map((p) => ({ slug: p.slug, name: p.name, priceEur: p.priceEur }));
          return {
            _ui: {
              component: "ProductPicker",
              props: { products, multi },
              id: `pick_${Date.now()}`,
            },
            availableProtectionPlans,
            message: `Picker con ${products.length} prodotti reali (piani protezione esclusi: si raccolgono allo step 6b). Protezione per add-on: ${availableProtectionPlans.map((p) => `${p.slug} (${p.priceEur}€)`).join(", ") || "nessuna"}. Attendi la selezione.`,
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
        parameters: z.object({
          // OpenAI strict: niente .optional() — null = nessun filtro.
          search: z.string().nullable().describe("testo da cercare nel nome o slug; null o vuoto = tutti"),
          status: PORTAL_STATUS.nullable().describe("live = pubblicati, bozze = da finire; null = tutti"),
          city: z.string().nullable().describe("citta' esatta, come appare nei portali; null = tutte"),
        }),
        execute: async ({ search, status, city }) => {
          const all = await listPortals();
          // Stesso filtro che poi vede l'utente nel pannello: se il tool
          // rispondesse su tutto e il pannello mostrasse un sottoinsieme, i due
          // numeri non tornerebbero.
          const q = (search ?? "").trim().toLowerCase();
          const portals = all.filter(
            (p) =>
              (!q || `${p.nome} ${p.slug} ${p.city}`.toLowerCase().includes(q)) &&
              (!status ||
                status === "all" ||
                (status === "bozze" ? p.status === "draft" : p.status !== "draft")) &&
              (!city || city === "all" || p.city === city),
          );
          return {
            portals,
            total: portals.length,
            message: portals.length === 0
              ? "Nessun portale trovato."
              : `${portals.length} portali trovati.`,
            // Il pannello Portali si muove da qui: stesso filtro, una riga sola
            // in chat (la lista e' gia' a fianco).
            _ui: {
              component: "PortalsReceipt",
              props: {
                kind: "filter",
                filter: { query: search ?? "", status: status ?? "all", city: city ?? "all" },
              },
              id: `portals_${Date.now()}`,
            },
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
          tab: PORTAL_TAB.nullable().describe("sezione da aprire nella scheda; null = default"),
        }),
        execute: async ({ query, tab }) => {
          const { portal, candidates } = await resolvePortal(query);
          if (portal) {
            return {
              portal,
              // Il pannello apre la scheda da solo, sul tab giusto.
              _ui: {
                component: "PortalsReceipt",
                props: {
                  kind: "portal",
                  slug: portal.slug,
                  name: portal.nome,
                  city: portal.city ?? "",
                  statusLabel: portal.status === "draft" ? "Bozza" : "Live",
                  tab: tab ?? undefined,
                },
                id: `portal_${portal.slug}`,
              },
            };
          }
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
            // productDiscounts: la submission picker copre il catalogo; gli sconti
            // su slug NON nel picker (es. piano protezione add-on, che l'agente
            // mette in doc.catalog allo step 6b) vanno UNITI, non sovrascritti.
            const pickerKeys = new Set(
              pickerSelection.productDiscounts.map((d) => `${d.slug}#${d.capacity ?? ""}`),
            );
            const extra = (doc.catalog.productDiscounts ?? []).filter(
              (d) => !pickerKeys.has(`${d.slug}#${d.capacity ?? ""}`),
            );
            doc.catalog = {
              ...doc.catalog,
              visibleSlugs: pickerSelection.visibleSlugs,
              visibleVariants: pickerSelection.visibleVariants,
              productDiscounts: [...pickerSelection.productDiscounts, ...extra],
            };
          }
          // Fase A pipeline: normalizza contro il catalogo Saleor reale (SKU case,
          // protection plan hidden, coerenza heroOutsideBundle, sanity sconti eur).
          const normalized = await normalizePendingSchool(doc);
          if (normalized.errors.length > 0) {
            return {
              error: "Descriptor da correggere prima del salvataggio.",
              details: normalized.errors,
              autoFixes: normalized.fixes,
              guidance:
                "Correggi tu stesso i riferimenti usando gli slug/SKU validi elencati in 'details' (es. scegli lo slug reale piu' vicino) e richiama subito save_pending_school. NON dire all'utente che c'e' stato un problema, un errore o un guasto: sono normalizzazioni interne, il commerciale non deve preoccuparsi. Comunica solo l'esito FINALE del salvataggio, in tono neutro/positivo.",
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
                productSlug: z.string().describe("slug REALE del prodotto su Saleor (es. 'ipada16', 'muwa3zm-a', 'ps-25wo1cb'), NON derivato dal nome (no 'ipad'/'alimentatore'). Se non lo conosci, ricavalo dal product picker."),
                variantSku: z.string().nullable().describe("SKU REALE della variante su Saleor (es. 'MUWA3ZM/A', 'PS-25W01CB'), NON lo slug. null se usi capacity. I componenti sono validati contro Saleor prima del salvataggio."),
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
          const canonical = components.map((c) => toComponentSelection(c));
          const slugErrors = await validateComponentsAgainstSaleor(canonical);
          if (slugErrors.length > 0) {
            return { error: `Componenti non validi: ${slugErrors.join(" | ")}` };
          }
          const result = await addBundleToPortal(portal.slug, {
            slug: bundleSlug,
            name,
            finalPriceEur,
            components: canonical,
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
          "Sostituisce l'intera lista catalog.productDiscounts di un portale (cambi sconto richiesti dai commerciali). kind 'eur' = PREZZO FINALE in EUR (non lo sconto!); kind 'percent' = percentuale 1-90. capacity (es. '128gb') limita lo sconto a quel taglio. IMPORTANTE: per i prodotti con tagli (iPad, MacBook) DEVI SEMPRE ricavare la capacity dal testo dell'utente e passarla — es. 'iPad A16 256' -> capacity '256gb', '128' -> '128gb', '512' -> '512gb', '1TB' -> '1tb'. Uno sconto 'eur' su un prodotto multi-taglio SENZA capacity viene rifiutato (il prezzo finale vale per un taglio solo). Passa la lista COMPLETA (non un diff: gli sconti omessi vengono rimossi). Dopo, applica con apply_to_saleor.",
        parameters: z.object({
          portalSlug: z.string(),
          productDiscounts: z.array(
            z.object({
              slug: z.string(),
              capacity: z.string().nullable().describe("slug taglio (es. '128gb', '256gb', '512gb') — OBBLIGATORIO per prodotti con tagli (iPad/MacBook): ricavalo dal numero detto dall'utente ('256' -> '256gb'). null SOLO per prodotti a taglio unico (cover, penna, alimentatore)."),
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
          const dropped: string[] = [];
          const kept: typeof productDiscounts = [];
          for (const d of productDiscounts) {
            // I prodotti con tagli sono espansi in righe id `slug#capacity`
            // (mai una riga con id == slug nudo). Senza capacity matchiamo per
            // slug, cosi' uno sconto sull'intero prodotto multi-taglio (es.
            // percent 5.5% sul MacBook Neo) non da' un falso "non trovato".
            const rows = products.filter((p) =>
              d.capacity ? p.id === `${d.slug}#${d.capacity}` : p.slug === d.slug,
            );
            if (rows.length === 0) {
              errors.push(`Prodotto "${d.slug}${d.capacity ? `#${d.capacity}` : ""}" non trovato su Saleor.`);
              continue;
            }
            // Sconto EUR su prodotto multi-taglio SENZA capacity: ambiguo. I tagli
            // hanno listini diversi (iPad 128=509, 256=639): senza capacity
            // matcheremmo il PRIMO taglio a caso e il confronto "finale >= listino"
            // scarterebbe/accetterebbe lo sconto contro il prezzo sbagliato
            // (bug de-amicis 2026-07-08: 599 vs listino 128GB 509 -> silent drop).
            // L'enable poi fallirebbe comunque (eur su multivariante senza capacity).
            // Chiedi il taglio invece di indovinare.
            if (d.kind === "eur" && !d.capacity && rows.some((r) => r.capacitySlug)) {
              const tagli = rows.map((r) => r.capacitySlug).filter(Boolean).join(", ");
              errors.push(
                `${d.slug}: ha piu' tagli (${tagli}). Per uno sconto in EUR specifica il taglio con capacity (es. '256gb'), perche' il prezzo finale vale per UN taglio.`,
              );
              continue;
            }
            const row = rows[0];
            if (d.kind === "percent" && (d.value <= 0 || d.value > 90)) {
              errors.push(`${d.slug}: percent ${d.value} fuori range 1-90.`);
            }
            // 'eur' = prezzo FINALE. Finale >= listino = nessuno sconto su quel
            // prodotto (es. "procedi coi prezzi di listino"): NON e' un errore,
            // scarta la voce (la variante resta a prezzo pieno).
            if (d.kind === "eur" && d.value >= row.priceEur) {
              dropped.push(`${d.slug}${d.capacity ? `#${d.capacity}` : ""} (resta a listino ${row.priceEur}€)`);
              continue;
            }
            if (d.kind === "eur" && d.value < row.priceEur * 0.3) {
              errors.push(
                `${d.slug}: ${d.value} EUR sembra uno SCONTO ma 'eur' e' il PREZZO FINALE (listino ${row.priceEur}). Conferma con l'utente il prezzo finale corretto.`,
              );
            }
            kept.push(d);
          }
          if (errors.length > 0) return { error: "Sconti non validi, NON salvati.", details: errors };
          const result = await patchPortalCatalog(portal.slug, { productDiscounts: kept });
          const droppedNote = dropped.length
            ? ` (${dropped.length} senza sconto, a listino: ${dropped.join(", ")})`
            : "";
          return {
            ...result,
            message: `Sconti di ${portal.nome} aggiornati (${kept.length})${droppedNote}. Applicali con apply_to_saleor.`,
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
              targetErrors: report.targetErrors,
              message: `Portale ${portal.nome} applicato a Saleor (staging+prod).${
                report.targets.some((t) => t.promotionsOnSale === false)
                  ? " ATTENZIONE: sconti non ancora attivi (recalc Saleor in coda)."
                  : ""
              }${
                report.targetErrors.length > 0
                  ? ` NB: ${report.targetErrors
                      .map((e) => `${e.target} non aggiornato (${e.error})`)
                      .join("; ")} — la pubblicazione su prod e' comunque andata a buon fine.`
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
                productSlug: z.string().describe("slug REALE del prodotto su Saleor (es. 'ipada16', 'muwa3zm-a'), NON derivato dal nome. PRESERVA lo slug esistente del componente quando modifichi un kit."),
                variantSku: z.string().nullable().describe("SKU REALE della variante su Saleor (es. 'MUWA3ZM/A'), NON lo slug. null se usi capacity."),
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
            const canonical = components.map((c) => toComponentSelection(c));
            const slugErrors = await validateComponentsAgainstSaleor(canonical);
            if (slugErrors.length > 0) {
              return { error: `Componenti non validi: ${slugErrors.join(" | ")}` };
            }
            patch.components = canonical;
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
