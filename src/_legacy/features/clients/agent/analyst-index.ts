import { Agent } from "@mastra/core/agent";
import type { LanguageModel } from "ai";
import { searchClientsTool } from "./tools/search-clients.tool.js";
import { aggregateClientsTool } from "./tools/aggregate-clients.tool.js";
import { getClientProfileByIdTool } from "./tools/get-client-profile-by-id.tool.js";
import { listRecentActivitiesTool } from "./tools/list-recent-activities.tool.js";
import { searchBrainOrgTool } from "./tools/search-brain-org.tool.js";
import { focusClientTool } from "./tools/focus-client.tool.js";
import { buildAnalystInstructions } from "./analyst-persona.js";
import type { AnalystContext } from "./analyst-context-builder.js";

export function makeAnalystAgent(
  model: LanguageModel,
  ctx: AnalystContext,
): Agent {
  return new Agent({
    name: "portfolio-analyst",
    instructions: buildAnalystInstructions(ctx),
    model,
    tools: {
      search_clients: searchClientsTool,
      aggregate_clients: aggregateClientsTool,
      get_client_profile_by_id: getClientProfileByIdTool,
      list_recent_activities: listRecentActivitiesTool,
      search_brain_org: searchBrainOrgTool,
      focus_client: focusClientTool,
    },
  });
}
