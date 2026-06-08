import { Hono } from "hono";
import { z } from "zod";
import { tenantMiddleware } from "@/core/tenant/middleware.js";
import { studioAuthMiddleware } from "@/middleware/studio-auth.js";
import { requireAdmin } from "@/middleware/require-admin.js";
import {
  createStudioUser,
  deleteStudioUser,
  findStudioUserByEmail,
  listStudioUsers,
  updateStudioUser,
  countActiveAdmins,
} from "@/core/studio-users/store.js";

// Brain: feature-008-organization-users — gestione utenti Studio (admin-only).
// Tutte le route richiedono tenant + login + ruolo admin.
export const studioUsersRoute = new Hono();

studioUsersRoute.use("*", tenantMiddleware);
studioUsersRoute.use("*", studioAuthMiddleware);
studioUsersRoute.use("*", requireAdmin);

const createSchema = z.object({
  email: z.string().email(),
  role: z.enum(["admin", "editor"]),
});

const updateSchema = z.object({
  role: z.enum(["admin", "editor"]).optional(),
  isActive: z.boolean().optional(),
});

studioUsersRoute.get("/", async (c) => {
  const users = await listStudioUsers(c.get("tenant"));
  return c.json({ data: users });
});

studioUsersRoute.post("/", async (c) => {
  const tenant = c.get("tenant");
  const body = await c.req.json().catch(() => null);
  const parsed = createSchema.safeParse(body);
  if (!parsed.success) {
    return c.json({ error: "body invalido", issues: parsed.error.issues }, 400);
  }

  const existing = await findStudioUserByEmail(tenant, parsed.data.email);
  if (existing) {
    return c.json({ error: "email gia' presente" }, 409);
  }

  const created = await createStudioUser(tenant, {
    email: parsed.data.email,
    role: parsed.data.role,
    invitedBy: c.get("studioUser").email,
  });
  return c.json({ data: created }, 201);
});

studioUsersRoute.patch("/:id", async (c) => {
  const tenant = c.get("tenant");
  const id = c.req.param("id");
  const body = await c.req.json().catch(() => null);
  const parsed = updateSchema.safeParse(body);
  if (!parsed.success) {
    return c.json({ error: "body invalido", issues: parsed.error.issues }, 400);
  }

  // Anti-lockout: se sto declassando o disattivando un admin, verifico che
  // resti almeno un altro admin attivo.
  const users = await listStudioUsers(tenant);
  const target = users.find((u) => u.id === id);
  if (!target) return c.json({ error: "utente non trovato" }, 404);

  const demoting = parsed.data.role === "editor" && target.role === "admin";
  const deactivating = parsed.data.isActive === false && target.isActive;
  if ((demoting || deactivating) && target.role === "admin") {
    const otherActiveAdmins = users.filter(
      (u) => u.role === "admin" && u.isActive && u.id !== id,
    ).length;
    if (otherActiveAdmins === 0) {
      return c.json({ error: "deve restare almeno un admin attivo" }, 409);
    }
  }

  const updated = await updateStudioUser(tenant, id, parsed.data);
  return c.json({ data: updated });
});

studioUsersRoute.delete("/:id", async (c) => {
  const tenant = c.get("tenant");
  const id = c.req.param("id");

  const users = await listStudioUsers(tenant);
  const target = users.find((u) => u.id === id);
  if (!target) return c.json({ error: "utente non trovato" }, 404);

  if (target.role === "admin" && target.isActive) {
    const others = await countActiveAdmins(tenant);
    if (others <= 1) {
      return c.json({ error: "deve restare almeno un admin attivo" }, 409);
    }
  }

  await deleteStudioUser(tenant, id);
  return c.json({ ok: true });
});
