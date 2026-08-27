// I tool di Nico non lanciano mai: un errore torna come dato, cosi' l'agente lo
// spiega invece di far cadere lo stream SSE.
export function readable(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

export function safe<A, R>(fn: (args: A) => Promise<R>) {
  return async (args: A): Promise<R | { error: string }> => {
    try {
      return await fn(args);
    } catch (err) {
      return { error: readable(err) };
    }
  };
}
