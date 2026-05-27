import { Hono } from "hono";
import { listPortals, getPortal } from "./reader.js";
import { fetchSaleorProducts } from "@/core/saleor/client.js";
import {
  updatePortal,
  deletePortal,
  savePortalLogo,
  updatePortalCatalog,
  updateBundleInPortal,
  removeBundleFromPortal,
} from "./writer.js";

export const portalsRoute = new Hono();

portalsRoute.get("/", async (c) => {
  const portals = await listPortals();
  return c.json(portals);
});

portalsRoute.get("/_catalog", async (c) => {
  const products = await fetchSaleorProducts();
  return c.json(products);
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

portalsRoute.put("/:slug/catalog", async (c) => {
  const slug = c.req.param("slug");
  const portal = await getPortal(slug);
  if (!portal) return c.json({ error: "not found" }, 404);
  const body = (await c.req.json()) as { visibleSlugs: string[] };
  if (!Array.isArray(body.visibleSlugs)) {
    return c.json({ error: "visibleSlugs must be an array" }, 400);
  }
  const result = await updatePortalCatalog(slug, body.visibleSlugs);
  return c.json(result);
});

portalsRoute.put("/:slug/bundles/:bundleSlug", async (c) => {
  const slug = c.req.param("slug");
  const bundleSlug = c.req.param("bundleSlug");
  const portal = await getPortal(slug);
  if (!portal) return c.json({ error: "not found" }, 404);
  const patch = await c.req.json();
  try {
    const result = await updateBundleInPortal(slug, bundleSlug, patch);
    return c.json(result);
  } catch (err) {
    return c.json(
      { error: err instanceof Error ? err.message : "update failed" },
      400,
    );
  }
});

portalsRoute.delete("/:slug/bundles/:bundleSlug", async (c) => {
  const slug = c.req.param("slug");
  const bundleSlug = c.req.param("bundleSlug");
  const portal = await getPortal(slug);
  if (!portal) return c.json({ error: "not found" }, 404);
  try {
    const result = await removeBundleFromPortal(slug, bundleSlug);
    return c.json(result);
  } catch (err) {
    return c.json(
      { error: err instanceof Error ? err.message : "remove failed" },
      400,
    );
  }
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
