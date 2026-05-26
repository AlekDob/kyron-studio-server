import { createTool } from "@mastra/core/tools";
import { z } from "zod";
import {
  aggregateClientsByGroup,
  type AggregateMetric,
  type AggregateGroupBy,
} from "@/features/clients/store/clients.store.js";
import { requireAnalystTenantCtx } from "./search-clients.tool.js";

const metricSchema = z.enum([
  "count",
  "sum_revenue",
  "avg_health",
  "avg_days_since_interaction",
]);

const groupBySchema = z.enum(["stage", "region", "country", "owner", "tag"]);

export const aggregateClientsTool = createTool({
  id: "aggregate_clients",
  description:
    "Aggrega clienti per un raggruppamento (stage, regione, paese, owner, tag) calcolando una metrica " +
    "(count, sum fatturato in EUR, media health score, media giorni da ultima interazione). " +
    "Usalo quando l'utente chiede 'quanti', 'quanto fatturato', 'distribuzione', 'per regione/stage/ecc.'.",
  inputSchema: z.object({
    metric: metricSchema,
    groupBy: groupBySchema,
  }),
  outputSchema: z.object({
    metric: metricSchema,
    groupBy: groupBySchema,
    rows: z.array(z.object({ group: z.string(), value: z.number() })),
  }),
  execute: async ({ context }) => {
    const tenantCtx = requireAnalystTenantCtx();
    const rows = await aggregateClientsByGroup(
      tenantCtx,
      context.metric as AggregateMetric,
      context.groupBy as AggregateGroupBy,
    );
    return {
      metric: context.metric,
      groupBy: context.groupBy,
      rows,
    };
  },
});
