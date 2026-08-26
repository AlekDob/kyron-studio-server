// Due lucchetti sull'HogQL che scrive l'agente Statistiche.
//
// 1. assertReadOnly — la key PostHog ha scope query:read, quindi una scrittura
//    fallirebbe comunque lato PostHog: questo e' il secondo lucchetto, serve a
//    fermare la query prima di spendere una chiamata e a dare un messaggio
//    chiaro invece di un 403 opaco.
// 2. il budget — la Query API sta a ~120 query/ora per key (vedi
//    analytics/queries.ts) e la stessa key serve /analytics e il report delle
//    09:00. L'agente ne prende al massimo 40: se sparasse a raffica farebbe
//    cadere il cruscotto.

export class HogqlRejected extends Error {}

const FORBIDDEN = [
  "INSERT",
  "ALTER",
  "DROP",
  "DELETE",
  "UPDATE",
  "CREATE",
  "TRUNCATE",
  "ATTACH",
  "DETACH",
  "SYSTEM",
  "GRANT",
  "OPTIMIZE",
  "RENAME",
];

// url()/file() leggono da fonti esterne: fuori scope per una domanda di stats.
const FORBIDDEN_CALLS = /\b(url|file|remote|s3|jdbc|mysql|postgresql)\s*\(/i;

const MAX_ROWS = 200;

/**
 * Ritorna la query da eseguire (con LIMIT forzato) o lancia HogqlRejected.
 * Il messaggio dell'errore lo legge l'agente e lo spiega all'utente.
 */
export function assertReadOnly(raw: string): string {
  const query = raw.trim().replace(/;+\s*$/, "");
  if (!query) throw new HogqlRejected("query vuota");
  if (query.includes(";")) {
    throw new HogqlRejected("una sola istruzione per volta, niente ';'");
  }
  if (!/^(SELECT|WITH)\b/i.test(query)) {
    throw new HogqlRejected("solo query che iniziano con SELECT o WITH");
  }
  const hit = FORBIDDEN.find((kw) => new RegExp(`\\b${kw}\\b`, "i").test(query));
  if (hit) throw new HogqlRejected(`parola non permessa: ${hit}`);
  if (FORBIDDEN_CALLS.test(query)) {
    throw new HogqlRejected("funzioni su fonti esterne non permesse");
  }
  if (/\bINTO\s+OUTFILE\b/i.test(query)) {
    throw new HogqlRejected("INTO OUTFILE non permesso");
  }
  return /\bLIMIT\b/i.test(query) ? query : `${query} LIMIT ${MAX_ROWS}`;
}

export interface QueryBudget {
  take(): void;
}

/** Finestra scorrevole in memoria. Si azzera al restart: va bene, e' un tetto. */
export function makeQueryBudget(max: number, windowMs: number): QueryBudget {
  const hits: number[] = [];
  return {
    take() {
      const now = Date.now();
      while (hits.length && now - hits[0] > windowMs) hits.shift();
      if (hits.length >= max) {
        const waitMin = Math.ceil((windowMs - (now - hits[0])) / 60_000);
        throw new HogqlRejected(
          `budget query PostHog esaurito (${max}/ora), riprova tra ${waitMin} minuti`,
        );
      }
      hits.push(now);
    },
  };
}

// 40 all'agente, gli altri ~80 restano a /analytics e al report giornaliero.
export const statsBudget = makeQueryBudget(40, 60 * 60_000);
