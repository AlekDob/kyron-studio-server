import { Hono } from "hono";
import { zValidator } from "@hono/zod-validator";
import {
  authMiddleware,
  authContextFrom,
  type AuthedVars,
} from "@/core/auth/middleware.js";
import {
  clientCreateSchema,
  clientUpdateSchema,
  clientListQuerySchema,
} from "./contracts.js";
import {
  listClients,
  getClient,
  createClient,
  updateClient,
  softDeleteClient,
  restoreClient,
} from "./store/clients.store.js";
import { notFound, serverError, validationError } from "./errors.js";

type Env = { Variables: AuthedVars };

export const clientsRoute = new Hono<Env>();

clientsRoute.use("*", authMiddleware);

clientsRoute.get(
  "/",
  zValidator("query", clientListQuerySchema, (result, c) => {
    if (!result.success) return validationError(c, result.error.format());
  }),
  async (c) => {
    try {
      const query = c.req.valid("query");
      const result = await listClients(authContextFrom(c), query);
      return c.json(result);
    } catch (err) {
      return serverError(c, err);
    }
  },
);

clientsRoute.post(
  "/",
  zValidator("json", clientCreateSchema, (result, c) => {
    if (!result.success) return validationError(c, result.error.format());
  }),
  async (c) => {
    try {
      const input = c.req.valid("json");
      const created = await createClient(authContextFrom(c), input);
      return c.json(created, 201);
    } catch (err) {
      return serverError(c, err);
    }
  },
);

clientsRoute.get("/:id", async (c) => {
  try {
    const id = c.req.param("id");
    const client = await getClient(authContextFrom(c), id);
    if (!client) return notFound(c, "Cliente", id);
    return c.json(client);
  } catch (err) {
    return serverError(c, err);
  }
});

clientsRoute.patch(
  "/:id",
  zValidator("json", clientUpdateSchema, (result, c) => {
    if (!result.success) return validationError(c, result.error.format());
  }),
  async (c) => {
    try {
      const id = c.req.param("id");
      const input = c.req.valid("json");
      const updated = await updateClient(authContextFrom(c), id, input);
      if (!updated) return notFound(c, "Cliente", id);
      return c.json(updated);
    } catch (err) {
      return serverError(c, err);
    }
  },
);

clientsRoute.delete("/:id", async (c) => {
  try {
    const id = c.req.param("id");
    const ok = await softDeleteClient(authContextFrom(c), id);
    if (!ok) return notFound(c, "Cliente", id);
    return c.body(null, 204);
  } catch (err) {
    return serverError(c, err);
  }
});

clientsRoute.post("/:id/restore", async (c) => {
  try {
    const id = c.req.param("id");
    const restored = await restoreClient(authContextFrom(c), id);
    if (!restored) return notFound(c, "Cliente", id);
    return c.json(restored);
  } catch (err) {
    return serverError(c, err);
  }
});
