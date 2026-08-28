// Brain: Fase B pipeline onboarding — client GraphQL ADMIN verso le due Saleor
// (staging + prod). Plain fetch (niente graphql-request: pattern di
// core/saleor/client.ts), token JWT cacheato per target con re-login lazy.
// Le credenziali admin vivono in env (SALEOR_ADMIN_EMAIL/PASSWORD), mai nel codice.

export type SaleorTarget = "staging" | "prod";

const DEFAULT_URLS: Record<SaleorTarget, string> = {
  staging: "https://api-staging.kyronedu.it/graphql/",
  prod: "https://api.kyronedu.it/graphql/",
};

export function saleorUrlFor(target: SaleorTarget): string {
  if (target === "staging") {
    return process.env.SALEOR_STAGING_URL ?? DEFAULT_URLS.staging;
  }
  return process.env.SALEOR_PROD_URL ?? DEFAULT_URLS.prod;
}

function adminCredentials(): { email: string; password: string } {
  const email = process.env.SALEOR_ADMIN_EMAIL;
  const password = process.env.SALEOR_ADMIN_PASSWORD;
  if (!email || !password) {
    throw new Error(
      "SALEOR_ADMIN_EMAIL / SALEOR_ADMIN_PASSWORD mancanti: configura le credenziali admin Saleor in env",
    );
  }
  return { email, password };
}

interface GraphQLError {
  message: string;
}

interface GraphQLResponse<T> {
  data?: T;
  errors?: GraphQLError[];
}

// Token per target, cacheato a livello modulo. Il JWT Saleor dura abbastanza
// per un enable (decine di secondi); su 401 si rifa' login una volta.
const tokens = new Map<SaleorTarget, string>();

async function rawRequest<T>(
  target: SaleorTarget,
  query: string,
  variables: Record<string, unknown>,
  token?: string,
): Promise<GraphQLResponse<T>> {
  const res = await fetch(saleorUrlFor(target), {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: JSON.stringify({ query, variables }),
  });
  if (!res.ok) {
    throw new Error(`Saleor ${target} HTTP ${res.status}: ${await res.text()}`);
  }
  return (await res.json()) as GraphQLResponse<T>;
}

async function login(target: SaleorTarget): Promise<string> {
  const { email, password } = adminCredentials();
  const res = await rawRequest<{
    tokenCreate: { token: string | null; errors: GraphQLError[] };
  }>(
    target,
    `mutation ($email: String!, $password: String!) {
      tokenCreate(email: $email, password: $password) { token errors { message } }
    }`,
    { email, password },
  );
  const tc = res.data?.tokenCreate;
  if (!tc?.token) {
    const msg = tc?.errors.map((e) => e.message).join(", ") ?? "no token";
    throw new Error(`Login Saleor ${target} fallito: ${msg}`);
  }
  tokens.set(target, tc.token);
  return tc.token;
}

// Richiesta GraphQL admin con login lazy + un retry su token scaduto.
export async function adminRequest<T>(
  target: SaleorTarget,
  query: string,
  variables: Record<string, unknown> = {},
): Promise<T> {
  const token = tokens.get(target) ?? (await login(target));
  let res = await rawRequest<T>(target, query, variables, token);
  const expired = res.errors?.some((e) => /signature|expired|jwt/i.test(e.message));
  if (expired) {
    res = await rawRequest<T>(target, query, variables, await login(target));
  }
  if (res.errors?.length) {
    throw new Error(
      `Saleor ${target}: ${res.errors.map((e) => e.message).join(", ")}`,
    );
  }
  if (!res.data) throw new Error(`Saleor ${target}: risposta senza data`);
  return res.data;
}

export async function adminToken(target: SaleorTarget): Promise<string> {
  return tokens.get(target) ?? login(target);
}

/** GraphQL multipart (Upload): serve per le foto prodotto, non per le mutation JSON. */
export async function adminMultipart<T>(
  target: SaleorTarget,
  form: FormData,
): Promise<T> {
  const send = async (token: string): Promise<GraphQLResponse<T>> => {
    const res = await fetch(saleorUrlFor(target), {
      method: "POST",
      headers: { Authorization: `Bearer ${token}` },
      body: form,
    });
    if (!res.ok) throw new Error(`Saleor ${target} HTTP ${res.status}: ${await res.text()}`);
    return (await res.json()) as GraphQLResponse<T>;
  };
  let json = await send(await adminToken(target));
  const expired = json.errors?.some((e) => /signature|expired|jwt/i.test(e.message));
  if (expired) json = await send(await login(target));
  if (json.errors?.length) {
    throw new Error(`Saleor ${target}: ${json.errors.map((e) => e.message).join(", ")}`);
  }
  if (!json.data) throw new Error(`Saleor ${target}: risposta senza data`);
  return json.data;
}

// Helper per i payload mutation Saleor che riportano errors[] applicativi.
export function checkErrors(
  errors: Array<{ field?: string | null; message: string }> | undefined,
  stage: string,
): void {
  if (errors && errors.length > 0) {
    throw new Error(
      `${stage}: ${errors.map((e) => `[${e.field ?? "-"}] ${e.message}`).join(", ")}`,
    );
  }
}
