// Client minimale verso la PostHog Query API (HogQL).
// Brain: decision-017 — la personal API key (scope query:read) e' un segreto
// server-side: vive solo qui, mai esposta al frontend Studio.

export class PosthogConfigError extends Error {
  constructor() {
    super("PostHog non configurato: servono POSTHOG_API_KEY e POSTHOG_PROJECT_ID");
  }
}

export class PosthogQueryError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(`posthog query failed (${status}): ${message}`);
  }
}

interface PosthogConfig {
  host: string;
  projectId: string;
  apiKey: string;
}

function getConfig(): PosthogConfig {
  const apiKey = process.env.POSTHOG_API_KEY;
  const projectId = process.env.POSTHOG_PROJECT_ID;
  if (!apiKey || !projectId) throw new PosthogConfigError();
  return {
    host: process.env.POSTHOG_HOST ?? "https://eu.posthog.com",
    projectId,
    apiKey,
  };
}

// Esegue una HogQLQuery e ritorna le righe grezze (array di array).
export async function runHogql(query: string): Promise<unknown[][]> {
  const cfg = getConfig();
  const res = await fetch(`${cfg.host}/api/projects/${cfg.projectId}/query`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${cfg.apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ query: { kind: "HogQLQuery", query } }),
  });
  if (!res.ok) {
    throw new PosthogQueryError(res.status, (await res.text()).slice(0, 500));
  }
  const body = (await res.json()) as { results?: unknown[][] };
  return body.results ?? [];
}
