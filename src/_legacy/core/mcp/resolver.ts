/**
 * Risolve `${env:VAR_NAME}` in stringhe a runtime.
 *
 * Pattern usato nei config MCP per evitare di committare credenziali:
 *   args: ["-y", "mcp-mongo-server", "${env:BI_MONGO_URI}"]
 * diventa:
 *   args: ["-y", "mcp-mongo-server", "mongodb://root:xxx@host/db"]
 *
 * Se la variabile non e' settata, lascia la stringa originale e logga
 * un warning (cosi' l'errore MCP e' auto-evidente nei log).
 */

const ENV_RE = /\$\{env:([A-Z0-9_]+)\}/g;

export function resolveEnvString(input: string): string {
  return input.replace(ENV_RE, (match, varName) => {
    const value = process.env[varName];
    if (value == null) {
      console.warn(`[mcp-resolver] variabile env "${varName}" non definita — lascio placeholder`);
      return match;
    }
    return value;
  });
}

export function resolveEnvArray(arr: string[]): string[] {
  return arr.map(resolveEnvString);
}

export function resolveEnvRecord(
  rec: Record<string, string>,
): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(rec)) {
    out[k] = resolveEnvString(v);
  }
  return out;
}
