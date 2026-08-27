import { Hono } from "hono";
import { studioAuthMiddleware } from "@/middleware/studio-auth.js";
import { tenantMiddleware } from "@/core/tenant/middleware.js";
import { listPortals, getPortal } from "./reader.js";
import { fetchSaleorProducts } from "@/core/saleor/client.js";
import {
  updatePortal,
  deletePortal,
  duplicatePortal,
  savePortalLogo,
  updatePortalCatalog,
  patchPortalCatalog,
  updateBundleInPortal,
  removeBundleFromPortal,
} from "./writer.js";
import type { CatalogPatch } from "./writer.js";
import { enablePortal } from "./enable/enable.js";
import { notifyPortalLive } from "./enable/notify.js";

export const portalsRoute = new Hono();

// SECURITY (2026-06-12): la route era montata SENZA middleware — list, update,
// delete, logo upload e enable erano pubblici. Stesso pattern di collections:
// X-Tenant + cookie kyron-rev HMAC. Il frontend Studio passa entrambi via
// gateway server-side, niente cambia per i client legittimi.
portalsRoute.use("*", tenantMiddleware);
portalsRoute.use("*", studioAuthMiddleware);

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

// Duplica un portale come nuova Bozza (struttura clonata, identita' resettata).
// requestedBy = utente Studio loggato. Non tocca Saleor: la copia va abilitata
// a parte. Vedi feature 007 (sezione Duplica portale).
portalsRoute.post("/:slug/duplicate", async (c) => {
  try {
    const body = (await c.req.json()) as { newSlug?: string; newNome?: string };
    const newSlug = (body.newSlug ?? "").trim();
    const newNome = (body.newNome ?? "").trim();
    if (!newSlug || !newNome) {
      return c.json({ error: "newSlug and newNome are required" }, 400);
    }
    const result = await duplicatePortal(c.req.param("slug"), {
      newSlug,
      newNome,
      requestedBy: c.get("studioUser").email,
    });
    return c.json(result);
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
    // Due chiavi indipendenti: la lista prodotti e gli sconti per prodotto.
    // Il pannello Studio manda una sola delle due per volta.
    const body = (await c.req.json()) as Partial<CatalogPatch>;
    if (body.visibleSlugs === undefined && body.productDiscounts === undefined) {
      return c.json({ error: "visibleSlugs or productDiscounts required" }, 400);
    }
    if (body.visibleSlugs !== undefined && !Array.isArray(body.visibleSlugs)) {
      return c.json({ error: "visibleSlugs must be an array" }, 400);
    }
    if (body.productDiscounts !== undefined && !Array.isArray(body.productDiscounts)) {
      return c.json({ error: "productDiscounts must be an array" }, 400);
    }
    const slug = c.req.param("slug");
    const result = body.productDiscounts
      ? await patchPortalCatalog(slug, { productDiscounts: body.productDiscounts })
      : await updatePortalCatalog(slug, body.visibleSlugs ?? []);
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
