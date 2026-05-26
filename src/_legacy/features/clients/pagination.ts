export type Cursor = { ts: string; id: string };

export function encodeCursor(cursor: Cursor): string {
  const raw = `${cursor.ts}|${cursor.id}`;
  return Buffer.from(raw, "utf8").toString("base64url");
}

export function decodeCursor(s: string): Cursor | null {
  try {
    const raw = Buffer.from(s, "base64url").toString("utf8");
    const [ts, id] = raw.split("|");
    if (!ts || !id) return null;
    // validate ISO timestamp
    if (Number.isNaN(Date.parse(ts))) return null;
    return { ts, id };
  } catch {
    return null;
  }
}

export const DEFAULT_LIMIT = 50;
export const MAX_LIMIT = 200;

export function clampLimit(limit: number | undefined): number {
  if (!limit || limit < 1) return DEFAULT_LIMIT;
  return Math.min(limit, MAX_LIMIT);
}
