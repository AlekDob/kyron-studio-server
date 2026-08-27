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
import { fetchCampaigns, fetchCampaignDetail } from "./meta-ads.js";
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

// Tipi di grafico della ChartCard condivisa (@studiofuturo/studio-core).
// Il descriptor e' 4 righe: non vale aggiungere qui la dipendenza dal core, che
// costerebbe l'auth GitHub Packages nella build Docker di questo server.
const CHART_KINDS = ["table", "bars", "columns", "timeline", "pie"] as const;

const chartDescriptor = (props: {
  title: string;
  kind: (typeof CHART_KINDS)[number];
  columns: string[];
  rows: unknown[][];
}) => ({ component: "Chart", props, id: `chart_${Date.now()}` });

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
          "Esegue una query HogQL di sola lettura su PostHog e la mostra all'utente come grafico piu' tabella. Budget 60 query/ora: aggrega con GROUP BY invece di fare tante chiamate.",
        parameters: z.object({
          query: z.string().describe("la query HogQL, una sola SELECT/WITH"),
          title: z.string().describe("titolo breve in italiano del risultato"),
          view: z
            .enum(CHART_KINDS)
            .describe(
              "timeline per una serie nel tempo, columns per pochi valori da confrontare, bars per una classifica con etichette lunghe, pie solo per parti di un totale (max 6 fette), table per il resto",
            ),
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
              _ui: chartDescriptor({ title, kind: view, columns, rows }),
            };
          } catch (err) {
            return { error: readableError(err) };
          }
        },
      }),
      render_chart: tool({
        description:
          "Mostra all'utente come grafico piu' tabella dei dati che hai GIA' in mano (da overview o dai tool Meta), senza rifare una query. La prima colonna e' l'etichetta, ogni colonna numerica successiva e' una serie: due colonne di misura diventano due serie a confronto.",
        parameters: z.object({
          title: z.string().describe("titolo breve in italiano del grafico"),
          kind: z.enum(CHART_KINDS),
          columns: z.array(z.string()).describe("nomi delle colonne, la prima e' l'etichetta"),
          rows: z
            .array(z.array(z.unknown()))
            .describe("le righe, nello stesso ordine delle colonne"),
        }),
        execute: async ({ title, kind, columns, rows }) => ({
          rowCount: rows.length,
          _ui: chartDescriptor({ title, kind, columns, rows }),
        }),
      }),
      get_meta_campaigns: tool({
        description:
          "Campagne pubblicitarie Meta (Facebook/Instagram) del periodo: spesa, impression, click, CTR, CPC e conversioni dal pixel. Usalo prima di correlare con le visite PostHog.",
        parameters: z.object({
          range: z.enum(RANGES).describe("periodo predefinito"),
        }),
        execute: async ({ range }) => {
          try {
            const campaigns = await fetchCampaigns(range);
            return {
              range,
              campaigns,
              _ui: {
                component: "MetaCampaignsCard",
                props: { title: `Campagne Meta — ${range}`, campaigns },
                id: `meta_${Date.now()}`,
              },
            };
          } catch (err) {
            return { error: readableError(err) };
          }
        },
      }),
      get_meta_campaign_detail: tool({
        description:
          "Dettaglio di una campagna Meta spaccato per adset (gruppo di inserzioni). Usalo quando l'utente chiede perche' una campagna rende male.",
        parameters: z.object({
          campaignId: z
            .string()
            .describe("id campagna, dal risultato di get_meta_campaigns"),
          range: z.enum(RANGES).describe("periodo predefinito"),
        }),
        execute: async ({ campaignId, range }) => {
          try {
            const { campaign, adsets } = await fetchCampaignDetail(campaignId, range);
            return {
              campaign,
              adsets,
              _ui: {
                component: "MetaCampaignsCard",
                props: {
                  title: campaign ? `${campaign.name} — per adset` : "Adset",
                  campaigns: adsets,
                },
                id: `meta_detail_${Date.now()}`,
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
