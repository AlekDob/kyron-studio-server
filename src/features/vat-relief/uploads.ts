// Store IN MEMORIA dei documenti 104 caricati per la validazione.
// Scelta esplicita (piano modulo Agevolazioni): i documenti sono dati sanitari
// (GDPR art. 9) e NON vengono archiviati da nessuna parte — restano nella
// casella mail del team. Qui vivono solo il tempo di essere letti dal modello,
// poi spariscono. Niente disco, niente log del contenuto.
const TTL_MS = 30 * 60 * 1000; // 30 minuti: il tempo di lavorare la pratica.
const MAX_BYTES = 10 * 1024 * 1024; // come l'upload lato checkout
const MAX_FILES = 8;

export const ALLOWED_MIME = [
  "application/pdf",
  "image/jpeg",
  "image/png",
  "image/webp",
] as const;

export interface StoredUpload {
  id: string;
  name: string;
  mimeType: string;
  bytes: Buffer;
  expiresAt: number;
}

const store = new Map<string, StoredUpload>();

function purgeExpired(): void {
  const now = Date.now();
  for (const [id, up] of store) {
    if (up.expiresAt <= now) store.delete(id);
  }
}

export function putUpload(
  name: string,
  mimeType: string,
  bytes: Buffer,
): StoredUpload {
  purgeExpired();
  if (!ALLOWED_MIME.includes(mimeType as (typeof ALLOWED_MIME)[number])) {
    throw new Error(`Formato non supportato: ${mimeType}. Usa PDF, JPG, PNG o WebP.`);
  }
  if (bytes.length > MAX_BYTES) {
    throw new Error("File troppo grande (max 10 MB).");
  }
  if (store.size >= MAX_FILES * 20) {
    throw new Error("Troppi documenti in memoria, riprova tra qualche minuto.");
  }
  const id = `up_${Math.random().toString(36).slice(2, 10)}${Date.now().toString(36)}`;
  const up: StoredUpload = {
    id,
    name,
    mimeType,
    bytes,
    expiresAt: Date.now() + TTL_MS,
  };
  store.set(id, up);
  return up;
}

// Legge senza consumare: l'operatore puo' rilanciare l'analisi sugli stessi
// documenti (es. dopo aver corretto il numero d'ordine) finche' non scade il TTL.
export function getUploads(ids: string[]): StoredUpload[] {
  purgeExpired();
  return ids.map((id) => store.get(id)).filter((u): u is StoredUpload => Boolean(u));
}

export function dropUploads(ids: string[]): void {
  for (const id of ids) store.delete(id);
}

export const MAX_UPLOAD_FILES = MAX_FILES;
