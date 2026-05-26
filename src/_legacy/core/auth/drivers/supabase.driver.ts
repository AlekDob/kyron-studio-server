import { createClient } from "@supabase/supabase-js";
import type { AuthContext, AuthDriver } from "../context.js";

/**
 * Supabase auth driver — verifies the bearer token against Supabase GoTrue.
 * orgId / roles are resolved from user metadata (user_metadata or app_metadata).
 */
export function createSupabaseAuthDriver(): AuthDriver {
  const url = process.env.SUPABASE_URL;
  const anonKey = process.env.SUPABASE_ANON_KEY;
  if (!url || !anonKey) {
    throw new Error("SUPABASE_URL / SUPABASE_ANON_KEY mancanti");
  }
  const supabase = createClient(url, anonKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  return {
    name: "supabase-auth",
    async verify(token: string): Promise<AuthContext | null> {
      const { data, error } = await supabase.auth.getUser(token);
      if (error || !data.user) return null;
      const user = data.user;
      const orgId =
        (user.user_metadata?.org_id as string | undefined) ??
        (user.app_metadata?.org_id as string | undefined) ??
        "demo-org";
      const roles = Array.isArray(user.app_metadata?.roles)
        ? (user.app_metadata.roles as string[])
        : ["member"];
      return {
        userId: user.id,
        orgId,
        roles,
        email: user.email ?? "",
      };
    },
  };
}
