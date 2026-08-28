import { Hono } from "hono";
import { studioAuthMiddleware } from "@/middleware/studio-auth.js";
import { tenantMiddleware } from "@/core/tenant/middleware.js";
import { getCatalogMeta, getChannelDirectory, getProduct, listProducts } from "./reads.js";
import { getCatalogSales } from "./sales.js";
import { daneaImportRoute } from "./danea-rest.js";
import { addProductImageFile } from "./writes.js";
import type { SaleorTarget } from "@/features/portals/enable/saleor-admin.js";

// REST del modulo Commesso: lista + import Danea + foto. I prezzi restano
// sui tool dell'agente (money-path).
const commessoRestRoute = new Hono();

commessoRestRoute.use("*", tenantMiddleware);
commessoRestRoute.use("*", studioAuthMiddleware);

commessoRestRoute.route("/import", daneaImportRoute);

// Default prod: e' il catalogo che vendiamo davvero.
const targetOf = (c: { req: { query: (k: string) => string | undefined } }): SaleorTarget =>
  c.req.query("target") === "staging" ? "staging" : "prod";

commessoRestRoute.get("/", async (c) => {
  try {
    const products = await listProducts(targetOf(c), { search: c.req.query("search") });
    return c.json({ count: products.length, products });
  } catch (err) {
    return c.json({ error: String(err) }, 502);
  }
});

commessoRestRoute.get("/meta", async (c) => {
  try {
    return c.json(await getCatalogMeta(targetOf(c)));
  } catch (err) {
    return c.json({ error: String(err) }, 502);
  }
});

// Contorno del pannello Catalogo: nomi leggibili dei portali + vendite per SKU.
// Un solo giro per il client, e le vendite sono cachate 15' lato server.
commessoRestRoute.get("/insights", async (c) => {
  try {
    const [channels, sales] = await Promise.all([
      getChannelDirectory(targetOf(c)),
      getCatalogSales(),
    ]);
    return c.json({ channels, sales });
  } catch (err) {
    return c.json({ error: String(err) }, 502);
  }
});

commessoRestRoute.post("/:slug/media", async (c) => {
  const form = await c.req.formData();
  const file = form.get("file");
  if (typeof file !== "object" || file === null || !("arrayBuffer" in file) || !("name" in file)) {
    return c.json({ error: "no_file" }, 400);
  }
  const uploaded = file as File;
  try {
    const product = await getProduct(targetOf(c), c.req.param("slug"));
    if (!product) return c.json({ error: "not found" }, 404);
    await addProductImageFile(targetOf(c), {
      productId: product.id,
      bytes: Buffer.from(await uploaded.arrayBuffer()),
      filename: uploaded.name,
      mime: uploaded.type || "image/jpeg",
      alt: product.name,
    });
    return c.json({ ok: true, slug: product.slug });
  } catch (err) {
    return c.json({ error: err instanceof Error ? err.message : String(err) }, 400);
  }
});

commessoRestRoute.get("/:slug", async (c) => {
  try {
    const product = await getProduct(targetOf(c), c.req.param("slug"));
    return product ? c.json(product) : c.json({ error: "not found" }, 404);
  } catch (err) {
    return c.json({ error: String(err) }, 502);
  }
});

export { commessoRestRoute };
