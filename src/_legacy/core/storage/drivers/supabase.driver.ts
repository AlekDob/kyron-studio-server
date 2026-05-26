import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import type { StorageDriver } from "../adapter.js";

/**
 * Supabase Storage driver. Uses the SERVICE key (not anon) because the
 * server performs tenant isolation itself; bucket policies can stay simple.
 *
 * NB: the project historically uses `SUPABASE_SERVICE_ROLE_KEY` (see
 * `src/core/supabase/client.ts`). We accept both `SUPABASE_SERVICE_KEY`
 * and `SUPABASE_SERVICE_ROLE_KEY` for backward compatibility.
 */
export function createSupabaseStorageDriver(bucket?: string): StorageDriver {
  const url = process.env.SUPABASE_URL;
  const serviceKey =
    process.env.SUPABASE_SERVICE_ROLE_KEY ?? process.env.SUPABASE_SERVICE_KEY;
  const bucketName =
    bucket ?? process.env.SUPABASE_STORAGE_BUCKET ?? "spaceship";
  if (!url || !serviceKey) {
    throw new Error(
      "SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY mancanti per supabase-storage driver",
    );
  }
  const client: SupabaseClient = createClient(url, serviceKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  return {
    name: "supabase-storage",
    async upload(
      key: string,
      data: Buffer,
      contentType: string,
    ): Promise<void> {
      const { error } = await client.storage
        .from(bucketName)
        .upload(key, data, { contentType, upsert: true });
      if (error) throw error;
    },
    async download(key: string): Promise<Buffer> {
      const { data, error } = await client.storage
        .from(bucketName)
        .download(key);
      if (error || !data) throw error ?? new Error("download empty");
      return Buffer.from(await data.arrayBuffer());
    },
    async delete(key: string): Promise<void> {
      const { error } = await client.storage.from(bucketName).remove([key]);
      if (error) throw error;
    },
    async signedUrl(key: string, expiresInSeconds = 3600): Promise<string> {
      const { data, error } = await client.storage
        .from(bucketName)
        .createSignedUrl(key, expiresInSeconds);
      if (error || !data) throw error ?? new Error("signed url empty");
      return data.signedUrl;
    },
  };
}
