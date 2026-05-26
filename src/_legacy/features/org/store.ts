import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import type { ModuleId } from "@/core/types/modules.js";

const here = dirname(fileURLToPath(import.meta.url));
const ORGS_PATH = resolve(here, "../../../data/orgs.json");

export interface User {
  id: string;
  email: string;
  role: "admin" | "employee";
  allowed_modules: ModuleId[];
}

export interface Organization {
  id: string;
  name: string;
  enabled_modules: ModuleId[];
  users: User[];
}

export async function loadOrgs(): Promise<Organization[]> {
  const raw = await readFile(ORGS_PATH, "utf8");
  return JSON.parse(raw) as Organization[];
}

export async function findUser(
  userId: string,
): Promise<{ org: Organization; user: User } | null> {
  const orgs = await loadOrgs();
  for (const org of orgs) {
    const user = org.users.find((u) => u.id === userId);
    if (user) return { org, user };
  }
  return null;
}
