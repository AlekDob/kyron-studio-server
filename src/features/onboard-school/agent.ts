import { streamText, tool } from "ai";
import { z } from "zod";
import { makePayloadClient } from "@/core/payload/client.js";
import type { TenantConfig } from "@/config/tenants/index.js";
import { resolveModel } from "@/features/settings/resolve-model.js";
import { ONBOARD_SCHOOL_SYSTEM_PROMPT } from "./prompt.js";
import { pendingSchoolSchema } from "./schema.js";

interface AgentRunOptions {
  tenant: TenantConfig;
  cookie: string;
  messages: Array<{ role: "user" | "assistant"; content: string }>;
}

export async function* runOnboardSchoolAgent(opts: AgentRunOptions) {
  const payload = makePayloadClient(opts.tenant, opts.cookie);
  const { model } = await resolveModel("onboard-school", "default");

  const result = streamText({
    model,
    system: ONBOARD_SCHOOL_SYSTEM_PROMPT,
    messages: opts.messages,
    tools: {
      check_slug_availability: tool({
        description:
          "Verifica se uno slug (kebab-case, es. 'orsoline-san-carlo') e' disponibile per una nuova scuola. Chiama questo PRIMA di proporre uno slug all'utente.",
        parameters: z.object({ slug: z.string().min(2) }),
        execute: async ({ slug }) => {
          const available = await payload.checkSlugAvailability(slug);
          return { slug, available };
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
      save_pending_school: tool({
        description:
          "Salva la nuova scuola come PendingSchool in Payload. Chiama SOLO quando hai raccolto tutti i campi obbligatori (slug, nome, indirizzo completo, almeno 1 bundle).",
        parameters: pendingSchoolSchema,
        execute: async (input) => {
          const res = await payload.createPendingSchool({
            ...input,
            status: "review",
            collectedBy: "agent",
          });
          return { id: res.id, message: "Salvata. Alek la rivedera' in Payload." };
        },
      }),
    },
  });

  for await (const part of result.fullStream) {
    yield part;
  }
}
