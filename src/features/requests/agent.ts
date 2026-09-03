// Ivo — agente del modulo Richieste. Raccoglie quello che serve ai colleghi e
// apre il ticket su Linear nel progetto Kyron (feature 022).
import { streamText } from "ai";
import type { TenantConfig } from "@/config/tenants/index.js";
import { resolveModel } from "@/features/settings/resolve-model.js";
import { REQUESTS_SYSTEM_PROMPT } from "./prompt.js";
import { requestTools } from "./tools.js";

interface AgentRunOptions {
  tenant: TenantConfig;
  cookie: string;
  userEmail: string;
  messages: Array<{ role: "user" | "assistant"; content: string }>;
}

export async function* runRequestsAgent(opts: AgentRunOptions) {
  void opts.tenant;
  void opts.cookie;
  const { model } = await resolveModel("requests", "default");

  const result = streamText({
    model,
    system: REQUESTS_SYSTEM_PROMPT,
    messages: opts.messages,
    // maxSteps default e' 1: l'agente farebbe il primo tool e si fermerebbe.
    maxSteps: 8,
    tools: requestTools(opts.userEmail),
  });

  for await (const part of result.fullStream) yield part;
}
