import { createHmac, timingSafeEqual } from "node:crypto";
import type { AuthContext, AuthDriver } from "../context.js";

/**
 * Self-contained HS256 JWT verifier. No external deps: lets self-hosted
 * customers avoid pulling a JWT library just to authenticate users from
 * their own IDP. If you need RS256 or JWKS rotation, add a new driver.
 */

function base64urlDecode(input: string): string {
  const padded = input
    .replace(/-/g, "+")
    .replace(/_/g, "/")
    .padEnd(Math.ceil(input.length / 4) * 4, "=");
  return Buffer.from(padded, "base64").toString("utf8");
}

function verifyHS256(
  token: string,
  secret: string,
): Record<string, unknown> | null {
  const parts = token.split(".");
  if (parts.length !== 3) return null;
  const [headerB64, payloadB64, sigB64] = parts;
  const expected = createHmac("sha256", secret)
    .update(`${headerB64}.${payloadB64}`)
    .digest("base64")
    .replace(/=/g, "")
    .replace(/\+/g, "-")
    .replace(/\//g, "_");
  const sigBuf = Buffer.from(sigB64);
  const expBuf = Buffer.from(expected);
  if (sigBuf.length !== expBuf.length) return null;
  if (!timingSafeEqual(sigBuf, expBuf)) return null;

  let payload: Record<string, unknown>;
  try {
    payload = JSON.parse(base64urlDecode(payloadB64)) as Record<
      string,
      unknown
    >;
  } catch {
    return null;
  }
  if (typeof payload.exp === "number" && payload.exp * 1000 < Date.now()) {
    return null;
  }
  return payload;
}

export function createCustomJwtAuthDriver(): AuthDriver {
  const secret = process.env.AUTH_JWT_SECRET;
  if (!secret) throw new Error("AUTH_JWT_SECRET non definito");

  return {
    name: "custom-jwt",
    async verify(token: string): Promise<AuthContext | null> {
      const payload = verifyHS256(token, secret);
      if (!payload) return null;
      const rolesRaw = payload.roles;
      const roles = Array.isArray(rolesRaw) ? (rolesRaw as string[]) : ["member"];
      return {
        userId: String(payload.sub ?? ""),
        orgId: String(payload.org_id ?? ""),
        roles,
        email: String(payload.email ?? ""),
      };
    },
  };
}
