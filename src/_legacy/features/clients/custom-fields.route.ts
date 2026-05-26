import { Hono } from "hono";
import { zValidator } from "@hono/zod-validator";
import { z } from "zod";
import {
  authMiddleware,
  authContextFrom,
  type AuthedVars,
} from "@/core/auth/middleware.js";
import {
  customFieldCreateSchema,
  customFieldUpdateSchema,
  customFieldEntitySchema,
} from "./contracts.js";
import {
  listCustomFields,
  createCustomField,
  updateCustomField,
  softDeleteCustomField,
} from "./store/custom-fields.store.js";
import { notFound, serverError, validationError } from "./errors.js";

type Env = { Variables: AuthedVars };

export const customFieldsRoute = new Hono<Env>();

customFieldsRoute.use("*", authMiddleware);

const listQuerySchema = z.object({
  entity: customFieldEntitySchema.optional(),
});

customFieldsRoute.get(
  "/",
  zValidator("query", listQuerySchema, (result, c) => {
    if (!result.success) return validationError(c, result.error.format());
  }),
  async (c) => {
    try {
      const { entity } = c.req.valid("query");
      const items = await listCustomFields(authContextFrom(c), entity);
      return c.json({ items });
    } catch (err) {
      return serverError(c, err);
    }
  },
);

customFieldsRoute.post(
  "/",
  zValidator("json", customFieldCreateSchema, (result, c) => {
    if (!result.success) return validationError(c, result.error.format());
  }),
  async (c) => {
    try {
      const input = c.req.valid("json");
      const created = await createCustomField(authContextFrom(c), input);
      return c.json(created, 201);
    } catch (err) {
      return serverError(c, err);
    }
  },
);

customFieldsRoute.patch(
  "/:fieldId",
  zValidator("json", customFieldUpdateSchema, (result, c) => {
    if (!result.success) return validationError(c, result.error.format());
  }),
  async (c) => {
    try {
      const fieldId = c.req.param("fieldId");
      const input = c.req.valid("json");
      const updated = await updateCustomField(
        authContextFrom(c),
        fieldId,
        input,
      );
      if (!updated) return notFound(c, "Custom field", fieldId);
      return c.json(updated);
    } catch (err) {
      return serverError(c, err);
    }
  },
);

customFieldsRoute.delete("/:fieldId", async (c) => {
  try {
    const fieldId = c.req.param("fieldId");
    const ok = await softDeleteCustomField(authContextFrom(c), fieldId);
    if (!ok) return notFound(c, "Custom field", fieldId);
    return c.body(null, 204);
  } catch (err) {
    return serverError(c, err);
  }
});
