import { Hono } from "hono";
import { studioAuthMiddleware } from "@/middleware/studio-auth.js";
import { tenantMiddleware } from "@/core/tenant/middleware.js";
import { makePayloadGateway } from "@/core/payload/gateway.js";
import { COLLECTIONS, findCollection } from "./registry.js";

const collectionsRoute = new Hono();

collectionsRoute.use("*", tenantMiddleware);
collectionsRoute.use("*", studioAuthMiddleware);

collectionsRoute.get("/", async (c) => {
  const tenant = c.get("tenant");
  const gw = makePayloadGateway(tenant);

  const counts = await Promise.all(
    COLLECTIONS.map(async (col) => ({
      ...col,
      count: await gw.count(col.slug),
    })),
  );

  return c.json({ data: counts });
});

collectionsRoute.get("/:slug", async (c) => {
  const slug = c.req.param("slug");
  const entry = findCollection(slug);
  if (!entry) return c.json({ error: `unknown collection: ${slug}` }, 404);

  const tenant = c.get("tenant");
  const gw = makePayloadGateway(tenant);

  const page = Number(c.req.query("page") ?? "1");
  const limit = Number(c.req.query("limit") ?? "50");
  const q = c.req.query("q") || undefined;
  const locale = c.req.query("locale") ?? "it";
  const sort = c.req.query("sort") ?? "-createdAt";

  const result = await gw.list(slug, { page, limit, q, locale, sort });
  return c.json({ ...result, collection: entry });
});

collectionsRoute.get("/:slug/:id", async (c) => {
  const { slug, id } = c.req.param();
  const entry = findCollection(slug);
  if (!entry) return c.json({ error: `unknown collection: ${slug}` }, 404);

  const tenant = c.get("tenant");
  const gw = makePayloadGateway(tenant);
  const locale = c.req.query("locale") ?? "all";

  const result = await gw.get(slug, id, locale);
  return c.json(result);
});

collectionsRoute.post("/:slug", async (c) => {
  const slug = c.req.param("slug");
  const entry = findCollection(slug);
  if (!entry) return c.json({ error: `unknown collection: ${slug}` }, 404);
  if (!entry.editable) return c.json({ error: "collection is read-only" }, 403);

  const tenant = c.get("tenant");
  const gw = makePayloadGateway(tenant);
  const body = (await c.req.json()) as Record<string, unknown>;

  const result = await gw.create(slug, body);
  return c.json(result, 201);
});

collectionsRoute.patch("/:slug/:id", async (c) => {
  const { slug, id } = c.req.param();
  const entry = findCollection(slug);
  if (!entry) return c.json({ error: `unknown collection: ${slug}` }, 404);
  if (!entry.editable) return c.json({ error: "collection is read-only" }, 403);

  const tenant = c.get("tenant");
  const gw = makePayloadGateway(tenant);
  const body = (await c.req.json()) as Record<string, unknown>;

  const result = await gw.update(slug, id, body);
  return c.json(result);
});

collectionsRoute.delete("/:slug/:id", async (c) => {
  const { slug, id } = c.req.param();
  const entry = findCollection(slug);
  if (!entry) return c.json({ error: `unknown collection: ${slug}` }, 404);
  if (!entry.editable) return c.json({ error: "collection is read-only" }, 403);

  const tenant = c.get("tenant");
  const gw = makePayloadGateway(tenant);

  const result = await gw.remove(slug, id);
  return c.json(result);
});

export { collectionsRoute };
