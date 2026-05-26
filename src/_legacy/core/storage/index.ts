import type { StorageDriver } from "./adapter.js";
import { createLocalFsStorageDriver } from "./drivers/local-fs.driver.js";

let activeDriver: StorageDriver | null = null;

export function registerStorageDriver(driver: StorageDriver): void {
  activeDriver = driver;
  console.log(`[storage] active driver: ${driver.name}`);
}

export function resolveStorage(): StorageDriver {
  if (!activeDriver) {
    throw new Error("[storage] nessun driver registrato");
  }
  return activeDriver;
}

export type { StorageDriver };
export { createLocalFsStorageDriver };
export { createSupabaseStorageDriver } from "./drivers/supabase.driver.js";
