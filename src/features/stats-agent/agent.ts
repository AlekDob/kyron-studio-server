// Ada — agente del modulo Statistiche. SOLA LETTURA su PostHog: scrive HogQL
// da sola, il guard la sanifica e le conta il budget. Stesso protocollo
// SSE/_ui degli altri agenti (decision-015).
import { streamText, tool } from "ai";
import { z } from "zod";
import type { TenantConfig } from "@/config/tenants/index.js";
import { resolveModel } from "@/features/settings/resolve-model.js";
import { runHogqlWithColumns } from "@/features/analytics/posthog.js";
import { getOverview } from "@/features/analytics/service.js";
import { listPortals } from "@/features/portals/reader.js";
import { HogqlRejected, assertReadOnly, statsBudget } from "./hogql-guard.js";
import { STATS_SYSTEM_PROMPT } from "./prompt.js";

interface AgentRunOptions {
  tenant: TenantConfig;
  cookie: string;
  userEmail: string;
  messages: Array<{ role: "user" | "assistant"; content: string }>;
}

const RANGES = [
  "today",
  "yesterday",
  "week",
  "month",
  "7d",
  "30d",
  "90d",
] as const;

const VIEWS = ["table", "bars", "line"] as const;

// I tool non devono lanciare: un errore leggibile torna nel result, cosi' Ada
// lo spiega all'utente invece di far cadere lo stream.
function readableError(err: unknown): string {
  if (err instanceof HogqlRejected) return err.message;
  if (err instanceof Error) return err.message;
  return String(err);
}

export async function* runStatsAgent(opts: AgentRunOptions) {
  void opts.tenant;
  void opts.cookie;
  void opts.userEmail;
  const { model } = await resolveModel("stats", "default");

  const result = streamText({
    model,
    system: STATS_SYSTEM_PROMPT,
    messages: opts.messages,
    maxSteps: 6,
    tools: {
      overview: tool({
        description:
          "KPI, serie storica, citta', fonti, pagine, device e breakdown per portale su un range predefinito. Gia' in cache: usalo per le domande standard, non consuma budget query.",
        parameters: z.object({
          range: z.enum(RANGES).describe("periodo predefinito"),
        }),
        execute: async ({ range }) => {
          try {
            return await getOverview(range);
          } catch (err) {
            return { error: readableError(err) };
          }
        },
      }),
      run_hogql: tool({
        description:
          "Esegue una query HogQL di sola lettura su PostHog e la mostra all'utente come tabella, classifica a barre o grafico a linea. Budget 40 query/ora: aggrega con GROUP BY invece di fare tante chiamate.",
        parameters: z.object({
          query: z.string().describe("la query HogQL, una sola SELECT/WITH"),
          title: z.string().describe("titolo breve in italiano del risultato"),
          view: z
            .enum(VIEWS)
            .describe("line per serie nel tempo, bars per classifiche, table per il resto"),
        }),
        execute: async ({ query, title, view }) => {
          let safe: string;
          try {
            safe = assertReadOnly(query);
            statsBudget.take();
          } catch (err) {
            return { rejected: true, message: readableError(err) };
          }
          try {
            const { columns, rows } = await runHogqlWithColumns(safe);
            return {
              query: safe,
              columns,
              rows,
              rowCount: rows.length,
              _ui: {
                component: "StatsResult",
                props: { title, columns, rows, view },
                id: `stats_${Date.now()}`,
              },
            };
          } catch (err) {
            return { error: readableError(err) };
          }
        },
      }),
      list_portals: tool({
        description:
          "Elenco dei portali scuola onboardati con slug e nome. Usalo per tradurre il nome di una scuola nello school_slug da mettere nella query.",
        parameters: z.object({}),
        execute: async () => {
          try {
            const portals = await listPortals();
            return portals.map((p) => ({ slug: p.slug, nome: p.nome }));
          } catch (err) {
            return { error: readableError(err) };
          }
        },
      }),
    },
  });

  for await (const part of result.fullStream) yield part;
}
