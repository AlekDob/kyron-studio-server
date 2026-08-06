import { Hono } from "hono";
import { studioAuthMiddleware } from "@/middleware/studio-auth.js";
import { tenantMiddleware } from "@/core/tenant/middleware.js";
import { uploadMedia } from "@/core/payload/media.js";

// Upload generico su Payload Media dal browser (oggi: PDF e copertine delle
// Risorse). Ritorna l'id del media, che il form salva nel record.

const MAX_BYTES = 25 * 1024 * 1024;
const ALLOWED = [
  "application/pdf",
  "application/zip",
  "image/png",
  "image/jpeg",
  "image/webp",
];

const mediaRoute = new Hono();

mediaRoute.use("*", tenantMiddleware);
mediaRoute.use("*", studioAuthMiddleware);

mediaRoute.post("/", async (c) => {
  try {
    const body = await c.req.parseBody();
    const file = body["file"];
    if (!(file instanceof File)) return c.json({ error: "missing file" }, 400);
    if (!ALLOWED.includes(file.type)) {
      return c.json({ error: `tipo non ammesso: ${file.type}` }, 400);
    }
    if (file.size > MAX_BYTES) {
      return c.json({ error: "file troppo grande (max 25 MB)" }, 400);
    }

    const alt = typeof body["alt"] === "string" ? body["alt"] : file.name;
    const buf = Buffer.from(await file.arrayBuffer());
    const result = await uploadMedia(
      c.get("tenant"),
      buf,
      file.name,
      file.type,
      alt,
    );
    return c.json(result);
  } catch (err) {
    const msg = err instanceof Error ? err.message : "upload failed";
    return c.json({ error: msg }, 500);
  }
});

export { mediaRoute };
