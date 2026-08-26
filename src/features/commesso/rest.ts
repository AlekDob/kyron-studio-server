import { Hono } from "hono";
import { studioAuthMiddleware } from "@/middleware/studio-auth.js";
import { tenantMiddleware } from "@/core/tenant/middleware.js";
import { getCatalogMeta, getProduct, listProducts } from "./reads.js";
import { putDaneaImport } from "./danea-uploads.js";
import type { SaleorTarget } from "@/features/portals/enable/saleor-admin.js";

// REST del modulo Commesso: serve il pannello prodotti di Studio. Solo letture
// (le scritture passano dall'agente, che ha le guardie sul money-path).
const commessoRestRoute = new Hono();

commessoRestRoute.use("*", tenantMiddleware);
commessoRestRoute.use("*", studioAuthMiddleware);

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

commessoRestRoute.get("/:slug", async (c) => {
  try {
    const product = await getProduct(targetOf(c), c.req.param("slug"));
    return product ? c.json(product) : c.json({ error: "not found" }, 404);
  } catch (err) {
    return c.json({ error: String(err) }, 502);
  }
});

// Upload dell'export Danea: il file resta in memoria (parsato) con TTL, non
// tocca il disco — che si azzera a ogni redeploy comunque.
interface UploadedFile {
  name: string;
  text(): Promise<string>;
}

function isUploadedFile(v: unknown): v is UploadedFile {
  return typeof v === "object" && v !== null && "text" in v && "name" in v;
}

commessoRestRoute.post("/import/upload", async (c) => {
  const form = await c.req.formData();
  const file = form.get("file");
  if (!isUploadedFile(file)) return c.json({ error: "no_file" }, 400);
  try {
    const entry = putDaneaImport(file.name, await file.text());
    return c.json({
      id: entry.id,
      filename: entry.filename,
      recordCount: entry.recordCount,
      groupCount: entry.groups.length,
    });
  } catch (err) {
    return c.json({ error: err instanceof Error ? err.message : String(err) }, 400);
  }
});

export { commessoRestRoute };
