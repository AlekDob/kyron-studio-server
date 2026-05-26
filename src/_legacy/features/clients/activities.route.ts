import { Hono } from "hono";
import { zValidator } from "@hono/zod-validator";
import {
  authMiddleware,
  authContextFrom,
  type AuthedVars,
} from "@/core/auth/middleware.js";
import {
  activityCreateSchema,
  activityListQuerySchema,
} from "./contracts.js";
import {
  listActivitiesForClient,
  createActivity,
} from "./store/activities.store.js";
import { notFound, serverError, validationError } from "./errors.js";

type Env = { Variables: AuthedVars };

export const activitiesRoute = new Hono<Env>();

activitiesRoute.use("*", authMiddleware);

activitiesRoute.get(
  "/:clientId/activities",
  zValidator("query", activityListQuerySchema, (result, c) => {
    if (!result.success) return validationError(c, result.error.format());
  }),
  async (c) => {
    try {
      const clientId = c.req.param("clientId");
      const query = c.req.valid("query");
      const result = await listActivitiesForClient(
        authContextFrom(c),
        clientId,
        query,
      );
      return c.json(result);
    } catch (err) {
      return serverError(c, err);
    }
  },
);

activitiesRoute.post(
  "/:clientId/activities",
  zValidator("json", activityCreateSchema, (result, c) => {
    if (!result.success) return validationError(c, result.error.format());
  }),
  async (c) => {
    try {
      const clientId = c.req.param("clientId");
      const input = c.req.valid("json");
      const created = await createActivity(
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
