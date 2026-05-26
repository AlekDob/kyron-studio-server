import { Hono } from "hono";
import { authMiddleware } from "@/core/auth/middleware.js";
import { invoicesStore } from "./store.js";

type AuthedEnv = { Variables: { userId: string } };

export const accountingRoute = new Hono<AuthedEnv>();

accountingRoute.use("*", authMiddleware);

accountingRoute.get("/invoices", async (c) => {
  const invoices = await invoicesStore.list();
  return c.json({ invoices });
});
