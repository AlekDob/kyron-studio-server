// Price Guard — agente AI del modulo "Controlli". SOLO LETTURA: i tool chiamano
// lo stesso motore deterministico (runPriceGuard); l'AI non calcola i soldi,
// spiega solo in italiano le anomalie gia' calcolate. Stesso protocollo SSE/_ui
// dell'agente onboarding (decision-015).
import { streamText, tool } from "ai";
import { z } from "zod";
import type { TenantConfig } from "@/config/tenants/index.js";
import { resolveModel } from "@/features/settings/resolve-model.js";
import { runPriceGuard } from "./check.js";
import { resolvePortal } from "@/features/portals/reader.js";

const SYSTEM_PROMPT = [
  "Sei Bruno, l'agente che controlla i prezzi in Kyron Studio. Verifichi prezzi e sconti dei portali scuola su Saleor (SOLA LETTURA: non modifichi mai nulla).",
  "Quando l'utente chiede di controllare tutti i portali usa il tool run_all_checks; quando nomina un portale specifico usa check_portal.",
  "Dopo il tool, spiega in ITALIANO semplice le anomalie trovate: cosa significano e cosa conviene verificare. NON inventare numeri: usa solo quelli tornati dal tool.",
  "Se non ci sono anomalie, dillo chiaramente ('nessun problema rilevato'). Non proporre modifiche automatiche: qui si controlla soltanto.",
].join(" ");

interface AgentRunOptions {
  tenant: TenantConfig;
  cookie: string;
  userEmail: string;
  messages: Array<{ role: "user" | "assistant"; content: string }>;
}

export async function* runPriceGuardAgent(opts: AgentRunOptions) {
  void opts.tenant;
  void opts.cookie;
  void opts.userEmail;
  const { model } = await resolveModel("price-guard", "default");

  const result = streamText({
    model,
    system: SYSTEM_PROMPT,
    messages: opts.messages,
    maxSteps: 6,
    tools: {
      run_all_checks: tool({
        description:
          "Esegue il controllo prezzi/sconti su TUTTI i portali onboarded (Saleor prod, sola lettura). Ritorna le anomalie e un descriptor _ui che il client renderizza come report. Usa quando l'utente chiede un giro completo o non nomina un portale.",
        parameters: z.object({}),
        execute: async () => {
          const anomalies = await runPriceGuard();
          return {
            count: anomalies.length,
            anomalies,
            _ui: { component: "AnomalyReport", props: { anomalies }, id: `pg_all_${Date.now()}` },
          };
        },
      }),
      check_portal: tool({
        description:
          "Esegue il controllo su UN portale (per nome o slug, fuzzy match). Sola lettura. Ritorna anomalie + descriptor _ui. Usa quando l'utente nomina una scuola/portale specifico.",
        parameters: z.object({
          query: z.string().describe("nome o slug del portale, es. 'massari'"),
        }),
        execute: async ({ query }) => {
          const res = await resolvePortal(query);
          if (!res.portal) {
            return {
              resolved: false,
              message: `Portale "${query}" non risolto univocamente.`,
              candidates: res.candidates.map((c) => ({ slug: c.slug, nome: c.nome })),
            };
          }
          const anomalies = await runPriceGuard({ portalSlug: res.portal.slug });
          return {
            resolved: true,
            portal: res.portal.slug,
            count: anomalies.length,
            anomalies,
            _ui: {
              component: "AnomalyReport",
              props: { anomalies },
              id: `pg_${res.portal.slug}_${Date.now()}`,
            },
          };
        },
      }),
    },
  });

  for await (const part of result.fullStream) {
    yield part;
  }
}
