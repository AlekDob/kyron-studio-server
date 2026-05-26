import { Hono } from "hono";
import type { AuthedVars } from "@/core/auth/middleware.js";
import { clientsRoute } from "./clients.route.js";
import { contactsRoute } from "./contacts.route.js";
import { activitiesRoute } from "./activities.route.js";
import { customFieldsRoute } from "./custom-fields.route.js";
import { documentsRoute } from "./documents.route.js";
import { clientChatRoute } from "./chat.route.js";
import { analystChatRoute } from "./analyst.route.js";
import { universalUuidGuard } from "./errors.js";

// Ordine: custom-fields prima dei path con :id, per evitare ambiguita' routing.
// analyst PRIMA di clientChatRoute: /analyst/chat deve matchare prima di
// /:clientId/chat, altrimenti Hono prova a matchare :clientId=analyst e il
// guard UUID rigetta con 404.
// (I singoli sub-router mantengono i loro generics Hono<{Variables: AuthedVars}>
// e applicano authMiddleware autonomamente.)
export const clientsFeatureRoute = new Hono<{ Variables: AuthedVars }>();
clientsFeatureRoute.use("*", universalUuidGuard);
clientsFeatureRoute.route("/custom-fields", customFieldsRoute);
clientsFeatureRoute.route("/", clientsRoute);
clientsFeatureRoute.route("/", contactsRoute);
clientsFeatureRoute.route("/", activitiesRoute);
clientsFeatureRoute.route("/", documentsRoute);
clientsFeatureRoute.route("/", analystChatRoute);
clientsFeatureRoute.route("/", clientChatRoute);

export * from "./contracts.js";
