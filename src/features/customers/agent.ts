// Bea — agente del modulo Clienti. Legge la vista clienti derivata dagli ordini
// e scrive ai clienti con lo stesso motore mail di Nico (core/email/campaign).
import { streamText } from "ai";
import type { TenantConfig } from "@/config/tenants/index.js";
import { resolveModel } from "@/features/settings/resolve-model.js";
import { CUSTOMERS_SYSTEM_PROMPT } from "./prompt.js";
import { customerTools } from "./tools.js";
import { customerMailTools } from "./mail-tools.js";
import { customerStoreTools } from "./store-tools.js";

interface AgentRunOptions {
  tenant: TenantConfig;
  cookie: string;
  userEmail: string;
  messages: Array<{ role: "user" | "assistant"; content: string }>;
}

export async function* runCustomersAgent(opts: AgentRunOptions) {
  void opts.tenant;
  void opts.cookie;
  const { model } = await resolveModel("customers", "default");

  const result = streamText({
    model,
    system: CUSTOMERS_SYSTEM_PROMPT,
    messages: opts.messages,
    maxSteps: 8,
    tools: {
      ...customerTools,
      ...customerMailTools(opts.userEmail),
      ...customerStoreTools(opts.userEmail),
    },
  });

  for await (const part of result.fullStream) yield part;
}
