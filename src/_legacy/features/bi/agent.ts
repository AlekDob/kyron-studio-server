import { Agent } from "@mastra/core/agent";
import type { LanguageModel } from "ai";
import { buildMcpToolsForAgent } from "@/core/mcp/index.js";
import { mcpPool } from "@/core/mcp/index.js";
import { buildAnalyticsInstructions } from "./instructions.js";

/**
 * Analytics Specialist — agente che interroga i database via tool MCP.
 *
 * Design "build-on-demand": l'agente NON viene registrato come singleton nel
 * registry globale, perche' i suoi tool cambiano a runtime (quando l'admin
 * aggiunge/modifica un MCP server, i tool disponibili cambiano).
 * Ogni request del modulo BI chiama `buildAnalyticsSpecialistAgent(...)` e
 * costruisce un'istanza fresca con i tool MCP attuali. Il costo e'
 * trascurabile (~10ms) e garantisce coerenza con la configurazione corrente.
 *
 * Pattern alternativo (rigettato): un singleton con tool list mutable.
 *   - Pro: meno costruzioni
 *   - Contro: Mastra Agent non ha API pubblica per mutare i tool post-creazione,
 *     cambierebbe comportamento con upgrade di @mastra/core.
 */

export interface BuildAnalyticsSpecialistOptions {
  orgId: string;
  model: LanguageModel;
  customDomainNotes?: string;
}

export async function buildAnalyticsSpecialistAgent(
  opts: BuildAnalyticsSpecialistOptions,
): Promise<Agent> {
  const { orgId, model, customDomainNotes } = opts;

  // 1. Lista dei tool MCP effettivamente disponibili per questo agente
  const availableTools = await mcpPool.listToolsForAgent(orgId, "analytics-specialist");

  // 2. Build dei tool Mastra che wrappano le chiamate MCP (con audit log)
  const mcpTools = await buildMcpToolsForAgent({
    orgId,
    agentId: "analytics-specialist",
    audit: true,
  });

  // 3. Instructions dinamiche che riflettono i tool disponibili
  const instructions = buildAnalyticsInstructions({
    availableTools,
    customDomainNotes,
  });

  return new Agent({
    name: "analytics-specialist",
    instructions,
    model,
    tools: mcpTools,
  });
}
