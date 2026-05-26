import { getClient } from "@/features/clients/store/clients.store.js";
import { listContactsForClient } from "@/features/clients/store/contacts.store.js";
import { listActivitiesForClient } from "@/features/clients/store/activities.store.js";
import { listCustomFields } from "@/features/clients/store/custom-fields.store.js";
import type { TenantContext } from "@/core/db/client.js";

export interface SpecialistContext {
  clientSnapshot: string;
  customFieldsCatalog: string;
  activitiesSummary: string;
  contactsSummary: string;
  temporalContext: string;
}

export async function buildSpecialistContext(
  tenantCtx: TenantContext,
  clientId: string,
): Promise<SpecialistContext> {
  const [client, contacts, activities, customFields] = await Promise.all([
    getClient(tenantCtx, clientId),
    listContactsForClient(tenantCtx, clientId),
    listActivitiesForClient(tenantCtx, clientId, { limit: 10 }),
    listCustomFields(tenantCtx, "client"),
  ]);

  if (!client) {
    throw new Error(`Cliente ${clientId} non trovato`);
  }

  const clientSnapshot = [
    `- Nome: ${client.name}`,
    client.legalName ? `- Ragione sociale: ${client.legalName}` : "",
    client.vatNumber ? `- P.IVA: ${client.vatNumber}` : "",
    `- Stage: ${client.lifecycleStage}`,
    client.tags.length > 0 ? `- Tag: ${client.tags.join(", ")}` : "",
    client.city
      ? `- Sede: ${client.city}${client.region ? `, ${client.region}` : ""}`
      : "",
    client.industry ? `- Industria: ${client.industry}` : "",
    client.healthScore !== null && client.healthScore !== undefined
      ? `- Health score: ${client.healthScore}/100`
      : "",
    `- Ultima interazione: ${
      client.lastInteractionAt ? client.lastInteractionAt.toISOString() : "mai"
    }`,
  ]
    .filter(Boolean)
    .join("\n");

  const customFieldsCatalog =
    customFields.length === 0
      ? "Nessun campo custom dichiarato per questa organizzazione."
      : customFields
          .map(
            (f) =>
              `- ${f.key} (${f.type}${f.required ? ", required" : ""}): ${f.label}`,
          )
          .join("\n");

  const activitiesSummary =
    activities.items.length === 0
      ? "Nessuna attivita' registrata."
      : activities.items
          .slice(0, 10)
          .map(
            (a) =>
              `- [${a.occurredAt.toISOString().slice(0, 10)}] ${a.kind}: ${
                a.title ?? "(senza titolo)"
              }`,
          )
          .join("\n");

  const contactsSummary =
    contacts.length === 0
      ? "Nessun contatto registrato."
      : contacts
          .map((c) => {
            const name =
              [c.firstName, c.lastName].filter(Boolean).join(" ") ||
              c.email ||
              "contatto";
            const meta = [c.role, c.email].filter(Boolean).join(" · ");
            return `- ${name}${meta ? ` (${meta})` : ""}${
              c.isPrimary ? " PRIMARIO" : ""
            }`;
          })
          .join("\n");

  const now = new Date();
  const temporalContext = `Oggi e' ${now.toISOString()} (UTC). Usa questa data per calcoli temporali.`;

  return {
    clientSnapshot,
    customFieldsCatalog,
    activitiesSummary,
    contactsSummary,
    temporalContext,
  };
}
