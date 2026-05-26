import { Hono } from "hono";
import { authMiddleware } from "@/core/auth/middleware.js";
import { findUser } from "./store.js";

type AuthedEnv = { Variables: { userId: string } };

export const orgRoute = new Hono<AuthedEnv>();

orgRoute.use("*", authMiddleware);

orgRoute.get("/current", async (c) => {
  const userId = c.get("userId");
  const found = await findUser(userId);
  if (!found) {
    return c.json(
      { error: `Utente ${userId} non associato a nessuna organizzazione` },
      404,
    );
  }
  const { org, user } = found;
  return c.json({
    org: {
      id: org.id,
      name: org.name,
      enabled_modules: org.enabled_modules,
    },
    user: {
      id: user.id,
      email: user.email,
      role: user.role,
      allowed_modules: user.allowed_modules,
    },
  });
});
