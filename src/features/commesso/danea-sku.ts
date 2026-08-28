// Match file ↔ Codice Danea. Lo slash Apple nel Code diventa `_` nel filename.
// Esempio: MD3Y4TY/A  ↔  MD3Y4TY_A.jpg  ↔  cartella MD3Y4TY/A/01.jpg

const IMAGE_EXT = /\.(jpe?g|png|webp|gif)$/i;

export function isImageName(name: string): boolean {
  return IMAGE_EXT.test(name) && !name.startsWith("__MACOSX/") && !name.includes("/.");
}

export function isAppleSku(sku: string): boolean {
  return /\/A$/i.test(sku.trim());
}

export function normalizeSku(sku: string): string {
  return sku.trim().toLowerCase().replace(/\//g, "_");
}

function fileStem(path: string): string {
  const base = path.split(/[/\\]/).pop() ?? path;
  return base.replace(/\.[^.]+$/, "");
}

function folderKeys(path: string): string[] {
  const parts = path.split(/[/\\]/).filter((p) => p && p !== "." && p !== "..");
  if (parts.length < 2) return [];
  const parent = parts[parts.length - 2]!.toLowerCase();
  const keys = [parent];
  if (parts.length >= 3) {
    keys.push(`${parts[parts.length - 3]}_${parts[parts.length - 2]}`.toLowerCase());
  }
  return keys;
}

/** SKU che corrisponde a questo path, o null. Non indovina. */
export function matchSkuFromFilename(filename: string, skus: string[]): string | null {
  const stem = fileStem(filename).toLowerCase().replace(/-/g, "_");
  const folders = folderKeys(filename);
  for (const sku of skus) {
    const n = normalizeSku(sku);
    if (stem === n) return sku;
    const rest = stem.startsWith(`${n}_`) ? stem.slice(n.length + 1) : "";
    if (rest && /^\d+$/.test(rest)) return sku;
    if (folders.some((f) => f === n || f.replace(/-/g, "_") === n)) return sku;
  }
  return null;
}
