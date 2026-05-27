import { streamText, tool } from "ai";
import { z } from "zod";
import type { TenantConfig } from "@/config/tenants/index.js";
import { resolveModel } from "@/features/settings/resolve-model.js";
import { REVIEW_EDITOR_SYSTEM_PROMPT } from "./prompt.js";

interface PendingTarget {
  urn: string | null;
  nodeKind: "text" | "image" | "section" | "page" | "gap";
  page: string;
  currentText?: string;
  assetSrc?: string;
  selector?: string;
}

interface AgentRunOptions {
  tenant: TenantConfig;
  context?: {
    currentUrl?: string;
    currentPath?: string;
    annotationsCount?: number;
    pendingTarget?: PendingTarget;
  };
  messages: Array<{ role: "user" | "assistant" | "system"; content: string }>;
}

function formatPendingTarget(t: PendingTarget): string {
  const parts = [
    `nodeKind: ${t.nodeKind}`,
    `page: ${t.page}`,
    t.selector ? `selector: ${t.selector}` : null,
    t.currentText ? `testo originale: "${t.currentText}"` : null,
    t.assetSrc ? `asset: ${t.assetSrc}` : null,
  ].filter(Boolean);
  return parts.join("\n");
}

const annotationKindSchema = z.enum([
  "edit-text",
  "replace-image",
  "comment",
  "add-section",
  "restructure",
]);

export async function* runReviewEditorAgent(opts: AgentRunOptions) {
  const { model } = await resolveModel("review-editor", "default");

  const ctx = opts.context ?? {};
  const preamble = [
    ctx.currentUrl ? `URL corrente iframe: ${ctx.currentUrl}` : null,
    ctx.currentPath ? `Path: ${ctx.currentPath}` : null,
    ctx.annotationsCount !== undefined
      ? `Annotazioni nel bundle: ${ctx.annotationsCount}`
      : null,
    ctx.pendingTarget
      ? `ELEMENTO SELEZIONATO DALL'UTENTE:\n${formatPendingTarget(ctx.pendingTarget)}`
      : null,
  ]
    .filter(Boolean)
    .join("\n");

  const result = streamText({
    model,
    system:
      REVIEW_EDITOR_SYSTEM_PROMPT +
      (preamble ? `\n\nCONTESTO CORRENTE:\n${preamble}` : ""),
    messages: opts.messages,
    maxSteps: 8,
    tools: {
      propose_annotation: tool({
        description:
          "Proponi una nuova annotazione strutturata. Il client la mostra all'utente per conferma prima di aggiungerla al bundle. Usa SEMPRE questo prima di add_annotation.",
        parameters: z.object({
          kind: annotationKindSchema,
          page: z
            .string()
            .describe(
              "pathname pubblico, es. '/' o '/prodotti/foo'. Usa quello dell'URL corrente.",
            ),
          selector: z
            .string()
            .optional()
            .describe("CSS selector dell'elemento target. Opzionale."),
          original: z
            .object({
              text: z.string().optional(),
              assetSrc: z.string().optional(),
            })
            .optional(),
          proposal: z.object({
            text: z.string().optional(),
            note: z.string().optional(),
            newAssetHint: z.string().optional(),
            position: z.enum(["before", "after", "replace"]).optional(),
          }),
        }),
        execute: async (input) => {
          return {
            ok: true,
            preview: input,
            instruction:
              "Mostro la proposta all'utente. Se conferma, chiamerai add_annotation con questo stesso payload.",
          };
        },
      }),
      add_annotation: tool({
        description:
          "Aggiungi un'annotazione al bundle locale del client. Chiama SOLO dopo che l'utente ha esplicitamente confermato (es. 'ok', 'sì', 'aggiungi').",
        parameters: z.object({
          kind: annotationKindSchema,
          page: z.string(),
          selector: z.string().optional(),
          original: z
            .object({
              text: z.string().optional(),
              assetSrc: z.string().optional(),
            })
            .optional(),
          proposal: z.object({
            text: z.string().optional(),
            note: z.string().optional(),
            newAssetHint: z.string().optional(),
            position: z.enum(["before", "after", "replace"]).optional(),
          }),
        }),
        execute: async (input) => ({
          ok: true,
          added: input,
        }),
      }),
      request_send_bundle: tool({
        description:
          "Richiedi al client di inviare il bundle via email. Il client mostra conferma e chiama /api/review/send.",
        parameters: z.object({
          note: z.string().optional(),
        }),
        execute: async ({ note }) => ({ ok: true, note: note ?? "" }),
      }),
    },
  });

  for await (const part of result.fullStream) {
    yield part;
  }
}
