import { Hono } from "hono";
import { listPortals, getPortal } from "./reader.js";
import { updatePortal, deletePortal, savePortalLogo } from "./writer.js";

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

portalsRoute.put("/:slug", async (c) => {
  const slug = c.req.param("slug");
  const portal = await getPortal(slug);
  if (!portal) return c.json({ error: "not found" }, 404);
  const updates = await c.req.json();
  const result = await updatePortal(slug, updates);
  return c.json(result);
});

portalsRoute.delete("/:slug", async (c) => {
  const slug = c.req.param("slug");
  const portal = await getPortal(slug);
  if (!portal) return c.json({ error: "not found" }, 404);
  const result = await deletePortal(slug);
  return c.json(result);
});

portalsRoute.post("/:slug/logo", async (c) => {
  try {
    const slug = c.req.param("slug");
    const body = await c.req.parseBody();
    const file = body["file"];
    if (!(file instanceof File)) {
      return c.json({ error: "missing file" }, 400);
    }
    const allowed = ["image/png", "image/jpeg", "image/webp"];
    if (!allowed.includes(file.type)) {
      return c.json({ error: "only PNG, JPEG, or WebP allowed" }, 400);
    }
    const ext = file.type.split("/")[1] === "jpeg" ? "jpg" : file.type.split("/")[1];
    const buf = Buffer.from(await file.arrayBuffer());
    const result = await savePortalLogo(slug, buf, ext);
    return c.json(result);
  } catch (err) {
    const msg = err instanceof Error ? err.message : "upload failed";
    return c.json({ error: msg }, 500);
  }
});
