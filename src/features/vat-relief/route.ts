// Route del modulo Agevolazioni: SSE dell'agente + upload documenti in memoria.
// Stesso protocollo SSE di price-guard/onboard-school (delta / tool / toolResult / [DONE]).
import { Hono } from "hono";
import { streamSSE } from "hono/streaming";
import { tenantMiddleware } from "@/core/tenant/middleware.js";
import { studioAuthMiddleware } from "@/middleware/studio-auth.js";
import { runVatReliefAgent } from "./agent.js";
import { MAX_UPLOAD_FILES, putUpload } from "./uploads.js";

export const vatReliefAgentRoute = new Hono();

vatReliefAgentRoute.use("*", tenantMiddleware);
vatReliefAgentRoute.use("*", studioAuthMiddleware);

vatReliefAgentRoute.post("/", async (c) => {
  const user = c.get("studioUser");
  const body = (await c.req.json()) as {
    messages: Array<{ role: "user" | "assistant"; content: string }>;
  };

  return streamSSE(c, async (stream) => {
    try {
      for await (const chunk of runVatReliefAgent({
        userEmail: user.email,
        messages: body.messages,
      })) {
        if (chunk.type === "text-delta") {
          await stream.writeSSE({ data: JSON.stringify({ delta: chunk.textDelta }) });
        } else if (chunk.type === "tool-call") {
          await stream.writeSSE({ data: JSON.stringify({ tool: chunk.toolName, args: chunk.args }) });
        } else if (chunk.type === "tool-result") {
          await stream.writeSSE({
            data: JSON.stringify({ toolResult: chunk.toolName, ok: true, result: chunk.result }),
          });
        } else if (chunk.type === "error") {
          const err = chunk.error;
          await stream.writeSSE({
            data: JSON.stringify({ error: err instanceof Error ? err.message : String(err) }),
          });
        }
      }
      await stream.writeSSE({ data: "[DONE]" });
    } catch (err) {
      await stream.writeSSE({
        data: JSON.stringify({ error: err instanceof Error ? err.message : String(err) }),
      });
      await stream.writeSSE({ data: "[DONE]" });
    }
  });
});

// Gateway upload: i file restano IN MEMORIA con TTL, mai su disco (dati sanitari).
export const vatReliefRoute = new Hono();

vatReliefRoute.use("*", tenantMiddleware);
vatReliefRoute.use("*", studioAuthMiddleware);

// I tipi File di node:buffer e undici non coincidono: discrimina sulla forma.
interface UploadedFile {
  name: string;
  type: string;
  arrayBuffer(): Promise<ArrayBuffer>;
}

function isUploadedFile(v: unknown): v is UploadedFile {
  return typeof v === "object" && v !== null && "arrayBuffer" in v && "name" in v;
}

vatReliefRoute.post("/upload", async (c) => {
  const form = await c.req.formData();
  const files: UploadedFile[] = form
    .getAll("files")
    .flatMap((v) => (isUploadedFile(v) ? [v] : []));
  if (files.length === 0) return c.json({ error: "no_files" }, 400);
  if (files.length > MAX_UPLOAD_FILES) {
    return c.json({ error: `Massimo ${MAX_UPLOAD_FILES} documenti per volta.` }, 400);
  }
  try {
    const uploads = await Promise.all(
      files.map(async (f) => {
        const bytes = Buffer.from(await f.arrayBuffer());
        const up = putUpload(f.name, f.type, bytes);
        return { id: up.id, name: up.name, size: bytes.length, mimeType: up.mimeType };
      }),
    );
    return c.json({ uploads });
  } catch (err) {
    return c.json({ error: err instanceof Error ? err.message : String(err) }, 400);
  }
});
