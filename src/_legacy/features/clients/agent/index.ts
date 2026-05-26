import { Agent } from "@mastra/core/agent";
import type { LanguageModel } from "ai";
import { searchBrainScopedTool } from "./tools/search-brain-scoped.tool.js";
import { getClientProfileTool } from "./tools/get-client-profile.tool.js";
import { listClientActivitiesTool } from "./tools/list-client-activities.tool.js";
import { listClientContactsTool } from "./tools/list-client-contacts.tool.js";
import { addClientNoteTool } from "./tools/add-client-note.tool.js";
import { addClientActivityTool } from "./tools/add-client-activity.tool.js";
import { updateClientProfileTool } from "./tools/update-client-profile.tool.js";
import { updateClientContactTool } from "./tools/update-client-contact.tool.js";
import { buildSpecialistInstructions } from "./persona.js";
import type { SpecialistContext } from "./context-builder.js";

export function makeClientSpecialistAgent(
  model: LanguageModel,
  clientName: string,
  ctx: SpecialistContext,
): Agent {
  return new Agent({
    name: "client-specialist",
    instructions: buildSpecialistInstructions(clientName, ctx),
    model,
    tools: {
      search_brain_scoped: searchBrainScopedTool,
      get_client_profile: getClientProfileTool,
      list_client_activities: listClientActivitiesTool,
      list_client_contacts: listClientContactsTool,
      add_client_note: addClientNoteTool,
      add_client_activity: addClientActivityTool,
      update_client_profile: updateClientProfileTool,
      update_client_contact: updateClientContactTool,
    },
  });
}
