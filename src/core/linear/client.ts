// Client Linear per il modulo Richieste (studio feature 022).
//
// Niente SDK: sono due query e una mutation, il pacchetto ufficiale pesa piu'
// del codice. Stesso schema di ops-client.ts: senza LINEAR_API_KEY non si
// chiama nessuno e l'errore e' parlante, cosi' il modulo si deploya prima che
// la chiave sia in env.
//
// Linear vuole la key NUDA in Authorization, senza "Bearer".

const ENDPOINT = "https://api.linear.app/graphql";

/** Coordinate del progetto Kyron su Linear. Se cambiano, si cambia solo qui. */
export const LINEAR = {
  teamId: "b7e531f8-6f23-4b5c-a1c5-fc267a3d74bd", // Studio Futuro (FUT)
  projectId: "13c37cae-5dec-4047-bd41-7c1f93746d8d", // Kyron
  assigneeId: "d97452bb-532b-47ca-9a15-82fc326595e3", // Alek
  states: {
    todo: "f8b68f83-c7c3-4f96-bff0-bb4a8170bef7",
    backlog: "bca1e6ec-3ece-472e-bf81-72ce2b179e41",
  },
  labels: {
    Bug: "9374be99-19b3-4fd8-9c4b-40f8bc9059a5",
    Feature: "48b594f3-c39a-49e6-b9ce-f1e5c2b18225",
    Improvement: "4cae883b-9074-47fa-9f62-70484c6002fb",
    Article: "d5c04090-b541-4e07-9815-95ddb03070c7",
  },
} as const;

/**
 * L'urgenza. Linear la tiene come numero (0 = nessuna, 1 = Urgent ... 4 = Low)
 * e i suoi nomi sono in inglese: qui si dicono in italiano, una volta sola, e
 * la traduzione vale per l'agente, la scheda e la mail.
 */
export const URGENCY = {
  bloccante: { value: 1, label: "Blocca il lavoro" },
  alta: { value: 2, label: "Alta" },
  media: { value: 3, label: "Media" },
  bassa: { value: 4, label: "Bassa" },
} as const;

export type Urgency = keyof typeof URGENCY;

export const URGENCY_KEYS = Object.keys(URGENCY) as Urgency[];

/** Il numero di Linear torna parola italiana. 0 (nessuna priorita') = "media". */
export function urgencyFromPriority(priority: number): Urgency {
  return URGENCY_KEYS.find((k) => URGENCY[k].value === priority) ?? "media";
}

export type LinearLabel = keyof typeof LINEAR.labels;
export type LinearState = keyof typeof LINEAR.states;

export const LINEAR_LABELS = Object.keys(LINEAR.labels) as LinearLabel[];

export class LinearError extends Error {}

/** Una chiamata GraphQL a Linear. Lancia LinearError: i tool la incartano con safe(). */
export async function linearQuery<T>(
  query: string,
  variables?: Record<string, unknown>,
): Promise<T> {
  const key = process.env.LINEAR_API_KEY;
  if (!key) throw new LinearError("LINEAR_API_KEY non configurata su studio-server");

  const res = await fetch(ENDPOINT, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: key },
    body: JSON.stringify({ query, variables: variables ?? {} }),
  });

  const json = (await res.json().catch(() => null)) as {
    data?: T;
    errors?: Array<{ message?: string }>;
  } | null;

  if (!res.ok) throw new LinearError(`Linear ha risposto ${res.status}`);
  if (json?.errors?.length) throw new LinearError(json.errors[0]?.message ?? "errore Linear");
  if (!json?.data) throw new LinearError("risposta Linear vuota");
  return json.data;
}
