// I tool di Ivo (feature 022). Stessa regola di Bea e Nico: il pannello a
// fianco e' la lista vera, in chat va solo la ricevuta.
//
// Aprire un ticket e' in due passaggi: draft_request propone e non scrive
// niente, create_request scrive solo con confirm: true. Cosi' l'agente da solo
// non riesce ad aprire ticket.
import { tool } from "ai";
import { z } from "zod";
import { safe } from "@/features/commesso/tool-safe.js";
import { LINEAR_LABELS, URGENCY, URGENCY_KEYS } from "@/core/linear/client.js";
import { createRequest, listRequests, type RequestRow } from "./service.js";

const LABEL = z.enum(["Bug", "Feature", "Improvement", "Article"]);
const STATE = z.enum(["todo", "backlog"]);
const URGENCY_ENUM = z.enum(["bloccante", "alta", "media", "bassa"]);
const GROUP = z.enum(["all", "todo", "doing", "done"]);

/** In chat va l'intestazione: la descrizione intera riempirebbe il contesto. */
const slim = (r: RequestRow) => ({
  identifier: r.identifier,
  title: r.title,
  state: r.state,
  labels: r.labels,
  urgency: r.urgency,
  requestedBy: r.requestedBy,
});

const receipt = (props: Record<string, unknown>) => ({
  component: "RequestsReceipt",
  props,
  id: `requests_${Date.now()}`,
});

export function requestTools(userEmail: string) {
  return {
    list_requests: tool({
      description: [
        "Filtra la lista dei ticket del pannello a fianco e ne torna il conteggio.",
        "La lista in pagina si riallinea da sola: NON ripetere le righe in chat.",
        "`group`: todo = da fare, doing = in corso, done = fatti, all = tutti.",
        "`query` cerca nel titolo e nella descrizione: e' una ricerca testuale semplice, quindi passa UNA parola chiave (\"foto\"), mai una frase intera.",
        "Usalo anche prima di proporre un ticket nuovo, per vedere se la cosa e' gia' stata chiesta.",
      ].join(" "),
      parameters: z.object({
        group: GROUP.optional().describe("stato dei ticket, default all"),
        label: LABEL.optional().describe("tipo di richiesta"),
        query: z.string().optional().describe("testo da cercare nel titolo o nella descrizione"),
        mine: z.boolean().optional().describe("true = solo i ticket chiesti da chi sta parlando"),
      }),
      execute: safe(async ({ group = "all", label, query, mine }) => {
        const all = await listRequests();
        const needle = query?.trim().toLowerCase();
        const rows = all.filter(
          (r) =>
            (group === "all" || r.group === group) &&
            (!label || r.labels.includes(label)) &&
            (!mine || r.requestedBy.toLowerCase() === userEmail.toLowerCase()) &&
            (!needle ||
              r.title.toLowerCase().includes(needle) ||
              r.description.toLowerCase().includes(needle)),
        );
        return {
          count: rows.length,
          // ponytail: 30 righe al modello, il resto lo mostra il pannello.
          requests: rows.slice(0, 30).map(slim),
          _ui: receipt({
            kind: "filter",
            filter: { group, label: label ?? "all", query: query ?? "", mine: mine ?? false },
            count: rows.length,
          }),
        };
      }),
      experimental_toToolResultContent: (r: unknown) => {
        const { _ui: _u, ...rest } = r as Record<string, unknown>;
        void _u;
        return [{ type: "text" as const, text: JSON.stringify(rest) }];
      },
    }),

    draft_request: tool({
      description: [
        "Mostra la BOZZA del ticket nella card, con Conferma e Modifica. NON scrive niente su Linear.",
        "Chiamalo appena hai capito il problema: la bozza si legge nella card, non in chat.",
        `Label ammesse: ${LINEAR_LABELS.join(", ")}.`,
        "Stato: todo se blocca il lavoro adesso, backlog se puo' aspettare.",
        `Urgenza (chiedila SEMPRE, non deciderla da solo): ${URGENCY_KEYS.join(", ")}.`,
      ].join(" "),
      parameters: z.object({
        title: z.string().min(5).max(120).describe("frase corta e concreta"),
        description: z
          .string()
          .min(10)
          .describe("cosa succede, cosa dovrebbe succedere, come ripeterlo"),
        label: LABEL,
        state: STATE,
        urgency: URGENCY_ENUM.describe("quanto e' urgente, secondo chi l'ha chiesta"),
      }),
      execute: safe(async (draft) => ({
        draft,
        _ui: {
          component: "RequestDraft",
          props: { ...draft, urgencyLabel: URGENCY[draft.urgency].label, requestedBy: userEmail },
          id: `draft_${Date.now()}`,
        },
      })),
    }),

    create_request: tool({
      description: [
        "Apre il ticket su Linear davvero, nel progetto Kyron e assegnato ad Alek, e manda la mail ad Alek.",
        "Chiamalo SOLO dopo che l'utente ha confermato la bozza. Senza confirm: true non fa niente.",
      ].join(" "),
      parameters: z.object({
        title: z.string().min(5).max(120),
        description: z.string().min(10),
        label: LABEL,
        state: STATE,
        urgency: URGENCY_ENUM.describe("la stessa urgenza della bozza confermata"),
        confirm: z.boolean().describe("true solo se l'utente ha confermato la bozza"),
      }),
      execute: safe(async ({ confirm, ...input }) => {
        if (!confirm) return { created: false, message: "Serve la conferma prima di aprire il ticket." };
        const issue = await createRequest({ ...input, requestedBy: userEmail });
        return {
          created: true,
          ...issue,
          _ui: receipt({ kind: "created", identifier: issue.identifier, title: issue.title, url: issue.url }),
        };
      }),
    }),
  };
}
