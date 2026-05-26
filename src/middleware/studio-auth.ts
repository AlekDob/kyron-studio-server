import crypto from "node:crypto";
import type { MiddlewareHandler } from "hono";
import { getCookie } from "hono/cookie";

const COOKIE_NAME = "kyron-rev";

declare module "hono" {
  interface ContextVariableMap {
    studioUser: { email: string };
  }
}

function getSecret(): string {
  return (
    process.env.KYRON_REVIEW_SECRET ||
    process.env.PAYLOAD_SECRET ||
    "kyron-review-insecure-dev"
  );
}

function hmac(data: string): string {
  return crypto
    .createHmac("sha256", getSecret())
    .update(data)
    .digest("base64url");
}

function verifyCookie(raw: string | undefined): { email: string } | null {
  if (!raw) return null;
  const dot = raw.lastIndexOf(".");
  if (dot < 0) return null;

  const data = raw.slice(0, dot);
  const sig = raw.slice(dot + 1);
  const expected = hmac(data);

  if (
    sig.length !== expected.length ||
    !crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(expected))
  ) {
    return null;
  }

  try {
    const parsed = JSON.parse(
      Buffer.from(data, "base64url").toString("utf8"),
    ) as { email?: string; exp?: number };
    if (!parsed.email || typeof parsed.exp !== "number") return null;
    if (parsed.exp < Date.now()) return null;
    return { email: parsed.email };
  } catch {
    return null;
  }
}

export const studioAuthMiddleware: MiddlewareHandler = async (c, next) => {
  const raw = getCookie(c, COOKIE_NAME);
  const user = verifyCookie(raw);

  if (!user) {
    return c.json({ error: "unauthorized" }, 401);
  }

  c.set("studioUser", user);
  await next();
};
