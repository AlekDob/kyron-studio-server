import type { Agent } from "@mastra/core/agent";
import type { LanguageModel } from "ai";

/**
 * Registry for agent factories. Replaces the hardcoded switch in mastra.adapter.ts
 * that silently returned null for unknown agentIds.
 *
 * Usage:
 *   // at boot (src/index.ts):
 *   registerAgent("accounting", makeAccountingAgent);
 *
 *   // at request time:
 *   const agent = buildRegisteredAgent("accounting", model);
 *
 * Unknown agentId throws an explicit error instead of falling through to
 * the dev fallback silently. This makes Inbox multi-agent dispatch safe.
 *
 * Brain: 001-preflight-refactor
 */

export type AgentFactory = (model: LanguageModel) => Agent;

const factories = new Map<string, AgentFactory>();

export function registerAgent(id: string, factory: AgentFactory): void {
  if (factories.has(id)) {
    console.warn(`[agent-registry] agent "${id}" already registered, overwriting`);
  }
  factories.set(id, factory);
  console.log(`[agent-registry] registered: ${id}`);
}

export function hasAgent(id: string): boolean {
  return factories.has(id);
}

export function listAgents(): string[] {
  return Array.from(factories.keys());
}

export function buildRegisteredAgent(
  id: string,
  model: LanguageModel,
): Agent {
  const factory = factories.get(id);
  if (!factory) {
    throw new Error(
      `Unknown agentId: "${id}". Registered agents: [${listAgents().join(", ")}]. ` +
        `Did you forget to call registerAgent() at boot in src/index.ts?`,
    );
  }
  return factory(model);
}
