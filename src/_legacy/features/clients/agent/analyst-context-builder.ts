import { sql as drizzleSql, isNull } from "drizzle-orm";
import { txWithTenant, type TenantContext } from "@/core/db/client.js";
import { clients } from "@/core/db/schema/index.js";
import { listCustomFields } from "@/features/clients/store/custom-fields.store.js";

export interface AnalystContext {
  totalClients: number;
  stageDistribution: string;
  searchableCustomFields: string;
  temporalContext: string;
}

export async function buildAnalystContext(
  ctx: TenantContext,
): Promise<AnalystContext> {
  const [distribution, customFields] = await Promise.all([
    txWithTenant(ctx, async (tx) => {
      return tx.execute<{ stage: string; n: number }>(drizzleSql`
        SELECT lifecycle_stage::text AS stage, COUNT(*)::int AS n
        FROM ${clients}
        WHERE ${isNull(clients.deletedAt)}
        GROUP BY lifecycle_stage
        ORDER BY n DESC
      `);
    }),
    listCustomFields(ctx, "client"),
  ]);

  const total = distribution.reduce((sum, r) => sum + Number(r.n), 0);
  const stageDistribution =
    distribution.length === 0
      ? "nessun cliente registrato"
      : distribution.map((r) => `${r.stage}: ${r.n}`).join(" · ");

  const searchable = customFields.filter((f) => f.searchable);
  const searchableCustomFields =
    searchable.length === 0
      ? "nessuno"
      : searchable.map((f) => `${f.key} (${f.type}): ${f.label}`).join("\n");

  const temporalContext = `Oggi e' ${new Date().toISOString()} (UTC).`;

  return {
    totalClients: total,
    stageDistribution,
    searchableCustomFields,
    temporalContext,
  };
}
