import { Hono } from "hono";
import { zValidator } from "@hono/zod-validator";
import {
  authMiddleware,
  authContextFrom,
  type AuthedVars,
} from "@/core/auth/middleware.js";
import { contactCreateSchema, contactUpdateSchema } from "./contracts.js";
import {
  listContactsForClient,
  createContact,
  updateContact,
  softDeleteContact,
} from "./store/contacts.store.js";
import { notFound, serverError, validationError } from "./errors.js";

type Env = { Variables: AuthedVars };

export const contactsRoute = new Hono<Env>();

contactsRoute.use("*", authMiddleware);

// Nested sotto /clients/:clientId/contacts
contactsRoute.get("/:clientId/contacts", async (c) => {
  try {
    const clientId = c.req.param("clientId");
    const items = await listContactsForClient(authContextFrom(c), clientId);
    return c.json({ items });
  } catch (err) {
    return serverError(c, err);
  }
});

contactsRoute.post(
  "/:clientId/contacts",
  zValidator("json", contactCreateSchema, (result, c) => {
    if (!result.success) return validationError(c, result.error.format());
  }),
  async (c) => {
    try {
      const clientId = c.req.param("clientId");
      const input = c.req.valid("json");
      const created = await createContact(
        authContextFrom(c),
        clientId,
        input,
      );
      if (!created) return notFound(c, "Cliente", clientId);
      return c.json(created, 201);
    } catch (err) {
      return serverError(c, err);
    }
  },
);

// Flat sotto /clients/contacts/:contactId — UUID globale
contactsRoute.patch(
  "/contacts/:contactId",
  zValidator("json", contactUpdateSchema, (result, c) => {
    if (!result.success) return validationError(c, result.error.format());
  }),
  async (c) => {
    try {
      const contactId = c.req.param("contactId");
      const input = c.req.valid("json");
      const updated = await updateContact(
        authContextFrom(c),
        contactId,
        input,
      );
      if (!updated) return notFound(c, "Contatto", contactId);
      return c.json(updated);
    } catch (err) {
      return serverError(c, err);
    }
  },
);

contactsRoute.delete("/contacts/:contactId", async (c) => {
  try {
    const contactId = c.req.param("contactId");
    const ok = await softDeleteContact(authContextFrom(c), contactId);
    if (!ok) return notFound(c, "Contatto", contactId);
    return c.body(null, 204);
  } catch (err) {
    return serverError(c, err);
  }
});
