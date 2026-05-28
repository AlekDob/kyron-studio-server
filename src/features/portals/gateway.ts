import { makePayloadGateway, type PayloadGateway } from "@/core/payload/gateway.js";
import { kyronTenant } from "@/config/tenants/kyron.js";

// Brain: decision-016 — portali su Payload. Helper lazy che istanzia il
// gateway Payload una volta sola e lo riusa. Oggi tenant = Kyron only.
// Quando avremo multi-tenant nel modulo Portali, rifattorizzare per passare
// il tenant esplicitamente dalle route / agent options.

let cached: PayloadGateway | null = null;

export function getPortalsGateway(): PayloadGateway {
  if (!cached) {
    cached = makePayloadGateway(kyronTenant);
  }
  return cached;
}

export const PORTALS_COLLECTION = "pending-schools";
