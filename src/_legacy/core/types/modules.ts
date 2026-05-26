/**
 * Mirror of `spaceship/src/core/types/modules.ts`.
 *
 * IMPORTANT: This union MUST stay in sync with the client-side definition.
 * Sync is verified at build time by `scripts/check-module-ids.ts` (client repo).
 *
 * Adding a new module = update BOTH files, then run `npm run check:module-ids`
 * from the client repo.
 *
 * Brain: 001-preflight-refactor — client/server contract without monorepo.
 */
export type ModuleId =
  | "accounting"
  | "sales"
  | "marketing"
  | "admin"
  | "clients"
  | "settings"
  | "inbox"
  | "brain"
  | "workflow"
  | "bi";

export const ALL_MODULE_IDS: ModuleId[] = [
  "accounting",
  "sales",
  "marketing",
  "admin",
  "clients",
  "settings",
  "inbox",
  "brain",
  "workflow",
  "bi",
];
