#!/usr/bin/env tsx
/**
 * Brain: 004-brain-module — Re-embed script (day-one, vincolo ADR-003)
 *
 * Identifica chunk con model_id diverso dal provider corrente,
 * ri-genera embedding e aggiorna atomicamente.
 *
 * Usage: npx tsx scripts/reembed.ts [--batch-size=50] [--dry-run]
 */

import "dotenv/config";

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const dryRun = args.includes("--dry-run");
  const batchArg = args.find((a) => a.startsWith("--batch-size="));
  const batchSize = batchArg ? Number(batchArg.split("=")[1]) : 50;

  console.log(`[reembed] batch=${batchSize} dryRun=${dryRun}`);

  const { resolveEmbeddingProvider } = await import(
    "../src/core/embeddings/index.js"
  );
  const embedder = resolveEmbeddingProvider();
  console.log(`[reembed] target model: ${embedder.modelId}`);

  const { supabaseService } = await import(
    "../src/core/supabase/client.js"
  );
  if (!supabaseService) {
    console.error("[reembed] Supabase required. Set SUPABASE_URL + SUPABASE_SERVICE_KEY.");
    process.exit(1);
  }

  const { data: stale, error } = await supabaseService
    .from("brain_chunks")
    .select("id, content, model_id")
    .neq("model_id", embedder.modelId)
    .limit(batchSize);

  if (error) {
    console.error("[reembed] query error:", error.message);
    process.exit(1);
  }

  console.log(`[reembed] found ${stale?.length ?? 0} stale chunks`);
  if (!stale?.length) {
    console.log("[reembed] nothing to do");
    return;
  }

  if (dryRun) {
    console.log("[reembed] dry run — skipping actual reembedding");
    return;
  }

  const texts = stale.map((c) => String(c.content));
  const embeddings = await embedder.embedBatch(texts);

  for (let i = 0; i < stale.length; i++) {
    const vectorStr = `[${embeddings[i].join(",")}]`;
    const { error: updateErr } = await supabaseService
      .from("brain_chunks")
      .update({
        embedding: vectorStr,
        model_id: embedder.modelId,
        model_version: embedder.modelVersion,
        dimensions: embedder.dimensions,
      })
      .eq("id", stale[i].id);
    if (updateErr) {
      console.error(`[reembed] update failed for ${stale[i].id}:`, updateErr.message);
    }
  }

  console.log(`[reembed] updated ${stale.length} chunks to ${embedder.modelId}`);
}

main().catch((err) => {
  console.error("[reembed] fatal:", err);
  process.exit(1);
});
