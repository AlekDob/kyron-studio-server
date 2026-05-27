import { Hono } from "hono";
import { listPortals, getPortal } from "./reader.js";

export const portalsRoute = new Hono();

portalsRoute.get("/", async (c) => {
  const portals = await listPortals();
  return c.json(portals);
});

portalsRoute.get("/:slug", async (c) => {
  const portal = await getPortal(c.req.param("slug"));
  if (!portal) return c.json({ error: "not found" }, 404);
  return c.json(portal);
});
