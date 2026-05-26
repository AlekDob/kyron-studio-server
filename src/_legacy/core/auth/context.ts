/**
 * Auth adapter contract. Feature modules (clients, sales, ...) depend on this
 * interface only — never on a specific provider. Concrete drivers live under
 * `src/core/auth/drivers/*` and are registered at boot from `src/index.ts`
 * based on the `AUTH_DRIVER` env var.
 */

export type AuthContext = {
  userId: string;
  orgId: string;
  roles: string[];
  email: string;
};

export interface AuthDriver {
  name: string;
  verify(token: string): Promise<AuthContext | null>;
}

let activeDriver: AuthDriver | null = null;

export function registerAuthDriver(driver: AuthDriver): void {
  activeDriver = driver;
  console.log(`[auth] active driver: ${driver.name}`);
}

export function resolveAuthDriver(): AuthDriver {
  if (!activeDriver) {
    throw new Error("[auth] nessun driver registrato");
  }
  return activeDriver;
}
