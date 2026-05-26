import { mkdir, readFile, unlink, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import type { StorageDriver } from "../adapter.js";

/**
 * Local filesystem storage driver. Useful for dev and for self-hosted
 * single-node deployments where an object store is overkill. `signedUrl`
 * returns a `file://` URI — callers that need real HTTP(S) signed URLs
 * should use the supabase driver (or a future S3 one).
 */
export function createLocalFsStorageDriver(baseDir?: string): StorageDriver {
  const root = resolve(
    baseDir ?? process.env.STORAGE_LOCAL_ROOT ?? "./.storage",
  );

  return {
    name: "local-fs",
    async upload(key: string, data: Buffer): Promise<void> {
      const filePath = join(root, key);
      await mkdir(dirname(filePath), { recursive: true });
      await writeFile(filePath, data);
    },
    async download(key: string): Promise<Buffer> {
      return readFile(join(root, key));
    },
    async delete(key: string): Promise<void> {
      await unlink(join(root, key)).catch((err: NodeJS.ErrnoException) => {
        if (err.code !== "ENOENT") throw err;
      });
    },
    async signedUrl(key: string): Promise<string> {
      return `file://${join(root, key)}`;
    },
  };
}
