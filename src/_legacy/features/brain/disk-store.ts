import { readFile, writeFile, mkdir, rename } from "node:fs/promises";
import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

// Brain: 004-brain-module — file-backed persistence per dev senza Supabase.
// Atomic write tramite tmp+rename per evitare corruzione su crash mid-write.
// NOTA: non concurrent-safe (single-user dev). Per multi-user passare a Supabase.

const here = dirname(fileURLToPath(import.meta.url));
const DATA_DIR = resolve(here, "../../../data");

const PATHS = {
  documents: resolve(DATA_DIR, "brain-documents.json"),
  chunks: resolve(DATA_DIR, "brain-chunks.json"),
} as const;

export type BrainFileKey = keyof typeof PATHS;

async function ensureDataDir(): Promise<void> {
  if (!existsSync(DATA_DIR)) {
    await mkdir(DATA_DIR, { recursive: true });
  }
}

export async function loadJsonFile<T>(key: BrainFileKey, fallback: T): Promise<T> {
  await ensureDataDir();
  const path = PATHS[key];
  if (!existsSync(path)) return fallback;
  try {
    const raw = await readFile(path, "utf8");
    return JSON.parse(raw) as T;
  } catch (err) {
    const msg = err instanceof Error ? err.message : "unknown";
    console.warn(`[brain-disk] failed to read ${key}: ${msg} - using fallback`);
    return fallback;
  }
}

export async function saveJsonFile<T>(key: BrainFileKey, data: T): Promise<void> {
  await ensureDataDir();
  const path = PATHS[key];
  const tmpPath = `${path}.tmp`;
  await writeFile(tmpPath, JSON.stringify(data, null, 2) + "\n", "utf8");
  await rename(tmpPath, path);
}
