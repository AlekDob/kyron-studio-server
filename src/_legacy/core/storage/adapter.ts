/**
 * Storage adapter contract. Feature modules (clients, brain, invoices)
 * consume this interface only; concrete drivers (local-fs, supabase-storage,
 * future S3/R2) live under `src/core/storage/drivers/*` and are registered
 * at boot based on the `STORAGE_DRIVER` env var.
 */

export interface StorageDriver {
  name: string;
  upload(key: string, data: Buffer, contentType: string): Promise<void>;
  download(key: string): Promise<Buffer>;
  delete(key: string): Promise<void>;
  signedUrl(key: string, expiresInSeconds?: number): Promise<string>;
}
