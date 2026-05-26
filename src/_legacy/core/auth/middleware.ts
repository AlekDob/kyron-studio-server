import type { Context, Next } from "hono";
import { resolveAuthDriver } from "./context.js";

/**
 * Hono variables set by the auth middleware. Historically only `userId` was
 * exposed (see consumers under `src/features/* /*.route.ts`). `orgId` / `roles`
 * / `email` are NEW — the Clients module relies on them. Old routes that still
 * read only `userId` keep working unchanged.
 */
export type AuthedVars = {
  userId: string;
  orgId: string;
  roles: string[];
  email: string;
};

type AuthedEnv = { Variables: AuthedVars };

const DEV_BYPASS = process.env.AUTH_DEV_BYPASS === "true";
const LEGACY_DEV_ANON = process.env.NODE_ENV !== "production";
const DEV_USER_ID =
  process.env.AUTH_DEV_USER_ID ?? "00000000-0000-0000-0000-000000000001";
const DEV_ORG_ID =
  process.env.AUTH_DEV_ORG_ID ?? "00000000-0000-0000-0000-000000000001";

function setDevBypass(c: Context<AuthedEnv>): void {
  c.set("userId", DEV_USER_ID);
  c.set("orgId", DEV_ORG_ID);
  c.set("roles", ["admin"]);
  c.set("email", "dev@spaceship.local");
}

/**
 * Legacy fallback preserved for backward-compat with the original middleware:
 * before the adapter pattern existed, any request in non-production that was
 * missing a token OR arrived while Supabase was not configured would be
 * accepted as `userId = "dev-anon"`. Existing feature routes (chat, inbox,
 * accounting, ...) still rely on this to keep working without a real token.
 */
function setLegacyDevAnon(c: Context<AuthedEnv>): void {
  c.set("userId", "dev-anon");
  c.set("orgId", DEV_ORG_ID);
  c.set("roles", ["member"]);
  c.set("email", "dev-anon@spaceship.local");
}

export async function authMiddleware(
  c: Context<AuthedEnv>,
  next: Next,
): Promise<void | Response> {
  // Explicit bypass — preferred in dev when working on the Clients module
  // (needs a stable user/org pair for Postgres RLS).
  if (DEV_BYPASS) {
    setDevBypass(c);
    return next();
  }

  const authHeader = c.req.header("Authorization") ?? c.req.header("authorization");
  const token = authHeader?.startsWith("Bearer ")
    ? authHeader.slice(7)
    : undefined;

  if (!token) {
    if (LEGACY_DEV_ANON) {
      setLegacyDevAnon(c);
      return next();
    }
    return c.json({ error: "Unauthorized: Bearer token richiesto" }, 401);
  }

  let ctx: Awaited<ReturnType<ReturnType<typeof resolveAuthDriver>["verify"]>>;
  try {
    ctx = await resolveAuthDriver().verify(token);
  } catch (err) {
    // Driver not configured (e.g. supabase env vars missing in dev). Preserve
    // legacy behaviour instead of hard-failing the whole server.
    if (LEGACY_DEV_ANON) {
      console.warn(
        "[auth] driver threw, falling back to dev-anon:",
        (err as Error).message,
      );
      setLegacyDevAnon(c);
      return next();
    }
    return c.json({ error: "Auth driver error" }, 500);
  }
  if (!ctx) return c.json({ error: "Unauthorized: token invalido o scaduto" }, 401);

  c.set("userId", ctx.userId);
  c.set("orgId", ctx.orgId);
  c.set("roles", ctx.roles);
  c.set("email", ctx.email);
  return next();
}

export function authContextFrom(
  c: Context<AuthedEnv>,
): { orgId: string; userId: string; roles: string[] } {
  return {
    orgId: c.get("orgId"),
    userId: c.get("userId"),
    roles: c.get("roles"),
  };
}
