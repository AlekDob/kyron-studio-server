// Brain: decision-020 — client per kyron-ops, il servizio interno che esegue
// recalc Saleor + Stripe config DENTRO i container (operazioni che l'enable, in
// rete isolata, non puo' fare da se'). Best-effort: senza KYRON_OPS_URL/TOKEN e'
// un no-op (cosi' l'integrazione si deploya in sicurezza PRIMA che kyron-ops
// esista) e un errore NON rompe l'enable: il portale e' comunque seedato.

interface OpsResult {
  ok: boolean;
  skipped?: boolean;
  [key: string]: unknown;
}

async function callOps(path: string, body?: unknown): Promise<OpsResult> {
  const url = process.env.KYRON_OPS_URL;
  const token = process.env.KYRON_OPS_TOKEN;
  if (!url || !token) return { ok: false, skipped: true, reason: "kyron-ops non configurato" };
  try {
    const res = await fetch(`${url}${path}`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify(body ?? {}),
    });
    const json = (await res.json().catch(() => ({}))) as Record<string, unknown>;
    return { ok: res.ok && json.ok !== false, status: res.status, ...json };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : "ops call failed" };
  }
}

/** Ricalcola gli sconti Saleor (materializza le Promotion sul pricing). */
export function opsRecalc(): Promise<OpsResult> {
  return callOps("/recalc");
}

/** Assegna la Stripe config "Kyron live" al channel (DynamoDB app Stripe). */
export function opsAssignStripe(channelId: string): Promise<OpsResult> {
  return callOps("/stripe-config", { channelId });
}
