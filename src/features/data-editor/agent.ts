import { streamText, tool } from "ai";
import { z } from "zod";
import { makePayloadGateway } from "@/core/payload/gateway.js";
import type { TenantConfig } from "@/config/tenants/index.js";
import { resolveModel } from "@/features/settings/resolve-model.js";
import { findCollection } from "@/features/collections/registry.js";
import { DATA_EDITOR_SYSTEM_PROMPT } from "./prompt.js";

interface AgentRunOptions {
  tenant: TenantConfig;
  context?: { slug?: string; id?: string | number };
  messages: Array<{ role: "user" | "assistant" | "system"; content: string }>;
}

function assertEditable(slug: string): void {
  const entry = findCollection(slug);
  if (!entry) throw new Error(`unknown collection: ${slug}`);
  if (!entry.editable) throw new Error(`collection ${slug} is read-only`);
}

export async function* runDataEditorAgent(opts: AgentRunOptions) {
  const gw = makePayloadGateway(opts.tenant);
  const { model } = await resolveModel("data-editor", "default");

  const contextPreamble = opts.context?.slug
    ? `\n\nCONTESTO UTENTE: l'utente sta visualizzando la collection "${opts.context.slug}"${opts.context.id ? `, record id ${opts.context.id}` : ""}.`
    : "";

  const result = streamText({
    model,
    system: DATA_EDITOR_SYSTEM_PROMPT + contextPreamble,
    messages: opts.messages,
    maxSteps: 8,
    tools: {
      list_records: tool({
        description:
          "Lista record di una collection. Usa q per filtrare per titolo/slug. limit max 50.",
        parameters: z.object({
          slug: z.string(),
          q: z.string().optional(),
          page: z.number().int().min(1).optional(),
          limit: z.number().int().min(1).max(50).optional(),
        }),
        execute: async ({ slug, q, page, limit }) => {
          const res = await gw.list(slug, {
            q,
            page: page ?? 1,
            limit: limit ?? 20,
          });
          return {
            total: res.meta.total,
            page: res.meta.page,
            totalPages: res.meta.totalPages,
            docs: res.data.map((d) => ({
              id: d.id,
              titolo: d.titolo ?? d.title ?? d.name ?? null,
              slug: d.slug ?? null,
            })),
          };
        },
      }),
      get_record: tool({
        description:
          "Ottieni un record completo (tutti i campi, tutte le locali IT+EN). Chiama PRIMA di update per non sovrascrivere campi inesistenti.",
        parameters: z.object({
          slug: z.string(),
          id: z.union([z.string(), z.number()]),
        }),
        execute: async ({ slug, id }) => {
          const res = await gw.get(slug, String(id));
          return res.data;
        },
      }),
      update_record: tool({
        description:
          "Aggiorna i campi di un record. Passa SOLO i campi che vuoi cambiare (PATCH semantico). Per i campi localized passa { it: ..., en: ... } o usa il parametro locale.",
        parameters: z.object({
          slug: z.string(),
          id: z.union([z.string(), z.number()]),
          patch: z
            .record(z.unknown())
            .describe("Oggetto con i campi da aggiornare"),
        }),
        execute: async ({ slug, id, patch }) => {
          assertEditable(slug);
          const res = await gw.update(slug, String(id), patch);
          return { ok: true, id: res.data.id };
        },
      }),
      create_record: tool({
        description:
          "Crea un nuovo record in una collection editable. Passa tutti i campi required.",
        parameters: z.object({
          slug: z.string(),
          data: z.record(z.unknown()),
        }),
        execute: async ({ slug, data }) => {
          assertEditable(slug);
          const res = await gw.create(slug, data);
          return { ok: true, id: res.data.id };
        },
      }),
      delete_record: tool({
        description:
          "Elimina un record. Chiedi SEMPRE conferma esplicita all'utente prima di chiamare questo tool.",
        parameters: z.object({
          slug: z.string(),
          id: z.union([z.string(), z.number()]),
        }),
        execute: async ({ slug, id }) => {
          assertEditable(slug);
          await gw.remove(slug, String(id));
          return { ok: true, id };
        },
      }),
    },
  });

  for await (const part of result.fullStream) {
    yield part;
  }
}
