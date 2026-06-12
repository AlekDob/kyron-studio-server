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
import { enablePortal } from "./enable/enable.js";
import { notifyPortalLive } from "./enable/notify.js";

export const portalsRoute = new Hono();

function errorResponse(err: unknown): { status: 400 | 404; body: { error: string } } {
  const msg = err instanceof Error ? err.message : "request failed";
  const isNotFound = msg.includes("not found");
  return { status: isNotFound ? 404 : 400, body: { error: msg } };
}

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

// Fase B pipeline onboarding: seed Saleor server-side (staging+prod di default).
// Idempotente, rilanciabile. Al termine aggiorna Payload (onboarded+channelId)
// e invia la mail "portale live" (best-effort, non blocca l'enable).
portalsRoute.post("/:slug/enable", async (c) => {
  try {
    const body = (await c.req.json().catch(() => ({}))) as {
      targets?: Array<"staging" | "prod">;
    };
    const targets =
      body.targets && body.targets.length > 0 ? body.targets : undefined;
    const report = await enablePortal(c.req.param("slug"), targets);
    const emailSent = await notifyPortalLive(c.req.param("slug"), report);
    return c.json({ ...report, emailSent });
  } catch (err) {
    const { status, body } = errorResponse(err);
    return c.json(body, status);
  }
});

portalsRoute.put("/:slug", async (c) => {
  try {
    const updates = await c.req.json();
    const result = await updatePortal(c.req.param("slug"), updates);
    return c.json(result);
  } catch (err) {
    const { status, body } = errorResponse(err);
    return c.json(body, status);
  }
});

portalsRoute.delete("/:slug", async (c) => {
  try {
    const result = await deletePortal(c.req.param("slug"));
    return c.json(result);
  } catch (err) {
    const { status, body } = errorResponse(err);
    return c.json(body, status);
  }
});

portalsRoute.put("/:slug/catalog", async (c) => {
  try {
    const body = (await c.req.json()) as { visibleSlugs: string[] };
    if (!Array.isArray(body.visibleSlugs)) {
      return c.json({ error: "visibleSlugs must be an array" }, 400);
    }
    const result = await updatePortalCatalog(c.req.param("slug"), body.visibleSlugs);
    return c.json(result);
  } catch (err) {
    const { status, body } = errorResponse(err);
    return c.json(body, status);
  }
});

portalsRoute.put("/:slug/bundles/:bundleSlug", async (c) => {
  try {
    const patch = await c.req.json();
    const result = await updateBundleInPortal(
      c.req.param("slug"),
      c.req.param("bundleSlug"),
      patch,
    );
    return c.json(result);
  } catch (err) {
    const { status, body } = errorResponse(err);
    return c.json(body, status);
  }
});

portalsRoute.delete("/:slug/bundles/:bundleSlug", async (c) => {
  try {
    const result = await removeBundleFromPortal(
      c.req.param("slug"),
      c.req.param("bundleSlug"),
    );
    return c.json(result);
  } catch (err) {
    const { status, body } = errorResponse(err);
    return c.json(body, status);
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
