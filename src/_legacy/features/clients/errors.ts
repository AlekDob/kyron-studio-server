import type { Context, Next } from "hono";

export type ApiError = {
  code: string;
  message: string;
  details?: Record<string, unknown>;
};

const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function isValidUuid(value: string | undefined): boolean {
  return typeof value === "string" && UUID_REGEX.test(value);
}

// Middleware che valida parametri UUID dell'URL. Se invalidi → 404 pulito
// invece di 500 causato dal cast Postgres fallito.
export function uuidParamGuard(...paramNames: string[]) {
  return async (c: Context, next: Next) => {
    for (const name of paramNames) {
      const value = c.req.param(name);
      if (!isValidUuid(value)) {
        return c.json<ApiError>(
          { code: "not_found", message: `Parametro '${name}' non e' un UUID valido` },
          404,
        );
      }
    }
    return next();
  };
}

// Guard "universale" applicato a livello barrel: se il path matchato include
// uno dei param UUID noti, lo valida. I param assenti vengono ignorati.
const KNOWN_UUID_PARAMS = ["clientId", "contactId", "fieldId", "docId", "id"];

export async function universalUuidGuard(c: Context, next: Next) {
  for (const name of KNOWN_UUID_PARAMS) {
    const value = c.req.param(name);
    if (value !== undefined && !isValidUuid(value)) {
      return c.json<ApiError>(
        { code: "not_found", message: `Parametro '${name}' non e' un UUID valido` },
        404,
      );
    }
  }
  return next();
}

export function notFound(c: Context, resource: string, id?: string) {
  return c.json<ApiError>(
    { code: "not_found", message: `${resource}${id ? ` ${id}` : ""} non trovato` },
    404,
  );
}

export function badRequest(c: Context, message: string, details?: Record<string, unknown>) {
  return c.json<ApiError>({ code: "bad_request", message, details }, 400);
}

export function validationError(c: Context, issues: unknown) {
  return c.json<ApiError>(
    { code: "validation_error", message: "Input non valido", details: { issues } },
    422,
  );
}

export function serverError(c: Context, err: unknown) {
  const message = err instanceof Error ? err.message : "Errore interno";
  return c.json<ApiError>({ code: "server_error", message }, 500);
}
