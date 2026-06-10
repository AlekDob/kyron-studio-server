// TTL cache in-memory con accesso stale: il valore scaduto resta disponibile
// come fallback se il refresh fallisce (stale-on-error, vedi service.ts).
// Niente Redis: il dato e' un aggregato ricostruibile, un'istanza sola.

interface CacheEntry<T> {
  value: T;
  expiresAt: number;
}

export interface TtlCache<T> {
  get(key: string): T | null;
  getStale(key: string): T | null;
  set(key: string, value: T): void;
}

export function makeTtlCache<T>(ttlMs: number): TtlCache<T> {
  const store = new Map<string, CacheEntry<T>>();
  return {
    get(key) {
      const entry = store.get(key);
      if (!entry || Date.now() > entry.expiresAt) return null;
      return entry.value;
    },
    getStale(key) {
      return store.get(key)?.value ?? null;
    },
    set(key, value) {
      store.set(key, { value, expiresAt: Date.now() + ttlMs });
    },
  };
}
