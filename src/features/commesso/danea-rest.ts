import { Hono } from "hono";
import type { SaleorTarget } from "@/features/portals/enable/saleor-admin.js";
import { listPortals } from "@/features/portals/reader.js";
import { attachAppleImages } from "./danea-apple.js";
import { applyDaneaPlan, type GroupMapping } from "./danea-apply.js";
import { applyImagesBySku } from "./danea-images.js";
import { listDaneaImports } from "./danea-log.js";
import { addProductsToPortals } from "./danea-portals.js";
import { planDaneaImport } from "./danea-service.js";
import {
  getProductsImport,
  putDaneaImport,
  saveCreatedSlugs,
  saveProductMappings,
} from "./danea-uploads.js";
import { unzipImages } from "./danea-zip.js";
import { getCatalogMeta, getProduct } from "./reads.js";
import { publishOnChannel } from "./writes.js";
import { resolveChannelId } from "./price-writes.js";

export const daneaImportRoute = new Hono();

const targetOf = (c: { req: { query: (k: string) => string | undefined } }): SaleorTarget =>
  c.req.query("target") === "staging" ? "staging" : "prod";

function fail(err: unknown, fallback = 400): { error: string; status: number } {
  return { error: err instanceof Error ? err.message : String(err), status: fallback };
}

interface UploadedFile {
  name: string;
  type: string;
  arrayBuffer(): Promise<ArrayBuffer>;
  text(): Promise<string>;
}

function isUploadedFile(v: unknown): v is UploadedFile {
  return typeof v === "object" && v !== null && "arrayBuffer" in v && "name" in v;
}

// Storico degli import: quello che lo store in RAM dimentica dopo un'ora.
// Sta PRIMA delle rotte "/:id/..." per non farsi mangiare "history" come id.
daneaImportRoute.get("/history", async (c) => {
  const limit = Number(c.req.query("limit") ?? 5);
  try {
    return c.json({ imports: await listDaneaImports(Number.isFinite(limit) ? limit : 5) });
  } catch (err) {
    return c.json({ error: fail(err).error }, 400);
  }
});

daneaImportRoute.post("/upload", async (c) => {
  const form = await c.req.formData();
  const file = form.get("file");
  if (!isUploadedFile(file)) return c.json({ error: "no_file" }, 400);
  try {
    const entry = putDaneaImport(file.name, await file.text());
    return c.json({
      id: entry.id,
      filename: entry.filename,
      kind: entry.kind,
      recordCount: entry.recordCount,
      groupCount: entry.kind === "products" ? entry.groups.length : 0,
    });
  } catch (err) {
    return c.json({ error: fail(err).error }, 400);
  }
});

daneaImportRoute.get("/:id/plan", async (c) => {
  const channel = c.req.query("channel") || "default-channel";
  try {
    const plan = await planDaneaImport(targetOf(c), {
      importId: c.req.param("id"),
      channelSlug: channel,
    });
    const entry = getProductsImport(c.req.param("id"));
    const meta = await getCatalogMeta(targetOf(c));
    const portals = (await listPortals()).map((p) => ({ slug: p.slug, nome: p.nome }));
    return c.json({
      plan,
      mappings: entry.mappings ?? [],
      mappingsConfirmed: Boolean(entry.mappingsConfirmed),
      createdSlugs: entry.createdSlugs ?? [],
      meta: { productTypes: meta.productTypes, categories: meta.categories, channels: meta.channels },
      portals,
    });
  } catch (err) {
    const { error } = fail(err);
    return c.json({ error }, 400);
  }
});

daneaImportRoute.put("/:id/mappings", async (c) => {
  try {
    const body = (await c.req.json()) as { mappings?: GroupMapping[] };
    if (!Array.isArray(body.mappings)) return c.json({ error: "mappings required" }, 400);
    const entry = saveProductMappings(c.req.param("id"), body.mappings);
    return c.json({ ok: true, count: entry.mappings?.length ?? 0 });
  } catch (err) {
    return c.json({ error: fail(err).error }, 400);
  }
});

daneaImportRoute.post("/:id/apply", async (c) => {
  try {
    const body = (await c.req.json()) as { channelSlug?: string; confirm?: boolean };
    if (body.confirm !== true) return c.json({ error: "confirm required" }, 400);
    const importId = c.req.param("id");
    const channelSlug = body.channelSlug || "default-channel";
    const entry = getProductsImport(importId);
    if (!entry.mappingsConfirmed || !entry.mappings?.length) {
      return c.json({ error: "Conferma i nomi sulla card prima di applicare." }, 400);
    }
    const plan = await planDaneaImport(targetOf(c), { importId, channelSlug });
    const result = await applyDaneaPlan(targetOf(c), {
      importId,
      channelSlug,
      groups: plan.groups,
      mappings: entry.mappings,
    });
    saveCreatedSlugs(importId, result.createdProducts);
    return c.json(result);
  } catch (err) {
    return c.json({ error: fail(err).error }, 400);
  }
});

daneaImportRoute.post("/:id/images", async (c) => {
  try {
    const form = await c.req.formData();
    const files: Array<{ name: string; bytes: Buffer; mime: string }> = [];
    for (const value of form.values()) {
      if (!isUploadedFile(value)) continue;
      const bytes = Buffer.from(await value.arrayBuffer());
      if (value.name.toLowerCase().endsWith(".zip") || value.type === "application/zip") {
        for (const z of unzipImages(bytes)) {
          files.push({ name: z.name, bytes: z.bytes, mime: "" });
        }
      } else {
        files.push({ name: value.name, bytes, mime: value.type });
      }
    }
    if (files.length === 0) return c.json({ error: "nessuna immagine" }, 400);
    return c.json(await applyImagesBySku(targetOf(c), files));
  } catch (err) {
    return c.json({ error: fail(err).error }, 400);
  }
});

daneaImportRoute.post("/:id/apple", async (c) => {
  try {
    const entry = getProductsImport(c.req.param("id"));
    const slugs = entry.createdSlugs ?? [];
    return c.json(await attachAppleImages(targetOf(c), slugs));
  } catch (err) {
    return c.json({ error: fail(err).error }, 400);
  }
});

daneaImportRoute.post("/:id/publish", async (c) => {
  try {
    const body = (await c.req.json()) as { channelSlug?: string };
    const channelSlug = body.channelSlug || "default-channel";
    const entry = getProductsImport(c.req.param("id"));
    const slugs = entry.createdSlugs ?? [];
    const target = targetOf(c);
    const channelId = await resolveChannelId(target, channelSlug);
    for (const slug of slugs) {
      const product = await getProduct(target, slug);
      if (!product) continue;
      await publishOnChannel(target, {
        productId: product.id,
        channelId,
        visibleInListings: true,
      });
    }
    return c.json({ ok: true, channelSlug, slugs });
  } catch (err) {
    return c.json({ error: fail(err).error }, 400);
  }
});

daneaImportRoute.post("/:id/portals", async (c) => {
  try {
    const body = (await c.req.json()) as { portalSlugs?: string[]; confirm?: boolean };
    if (body.confirm !== true) return c.json({ error: "confirm required" }, 400);
    const portals = (body.portalSlugs ?? []).filter(Boolean);
    if (portals.length === 0) return c.json({ error: "nessun portale" }, 400);
    const entry = getProductsImport(c.req.param("id"));
    const slugs = entry.createdSlugs ?? [];
    if (slugs.length === 0) return c.json({ error: "nessun prodotto creato in questo import" }, 400);
    const result = await addProductsToPortals({
      productSlugs: slugs,
      portalSlugs: portals,
      target: targetOf(c),
    });
    return c.json({ ok: true, result });
  } catch (err) {
    return c.json({ error: fail(err).error }, 400);
  }
});
