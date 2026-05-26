import { Hono } from "hono";
import { z } from "zod";
import { authMiddleware } from "@/core/auth/middleware.js";
import { resolveForProcess } from "@/core/llm/resolver.js";
import { resolveProcessConfig } from "@/features/settings/store.js";
import { mcpPool, auditFilePath } from "@/core/mcp/index.js";
import { buildAnalyticsSpecialistAgent } from "./agent.js";
import { readRules, writeRules, RULES_TEMPLATE } from "./rules.js";

type AuthedEnv = { Variables: { userId: string } };

export const biRoute = new Hono<AuthedEnv>();
biRoute.use("*", authMiddleware);

const orgId = "org-dev"; // M4: extract from auth token

const askBodySchema = z.object({
  message: z.string().min(1),
  history: z
    .array(
      z.object({
        role: z.enum(["user", "assistant", "system"]),
        content: z.string(),
      }),
    )
    .default([]),
  maxSteps: z.number().int().min(1).max(20).default(10),
  customDomainNotes: z.string().optional(),
});

// ── Status: serve a UI per sapere se ci sono MCP configurati ─────────

biRoute.get("/status", async (c) => {
  const tools = await mcpPool.listToolsForAgent(orgId, "analytics-specialist");
  const servers = new Map<string, { name: string; toolCount: number }>();
  for (const t of tools) {
    const existing = servers.get(t.serverId);
    if (existing) existing.toolCount++;
    else servers.set(t.serverId, { name: t.serverName, toolCount: 1 });
  }
  return c.json({
    ready: tools.length > 0,
    totalTools: tools.length,
    servers: Array.from(servers.values()),
  });
});

// ── Ask sync (semplice, non stream) ──────────────────────────────────

biRoute.post("/ask", async (c) => {
  const parsed = askBodySchema.safeParse(await c.req.json());
  if (!parsed.success) return c.json({ error: parsed.error.flatten() }, 400);
  const { message, history, maxSteps, customDomainNotes } = parsed.data;

  const cfg = await resolveProcessConfig(orgId, "bi", "_default");
  const model = await resolveForProcess(orgId, "bi", "_default");
  if (!model) return c.json({ error: "Nessun LLM configurato per il modulo BI" }, 503);

  // Carica le business rules salvate e merge con eventuali override del caller.
  // Le rules dal file hanno precedenza come "base", il caller puo' appendere
  // note on-the-fly (es. "concentrati su marzo") senza riscrivere il file.
  const stored = await readRules(orgId);
  const mergedNotes = [
    buildTemporalContext(),
    stored.content.trim(),
    customDomainNotes?.trim(),
  ]
    .filter((s) => s && s.length > 0)
    .join("\n\n---\n\n");

  const agent = await buildAnalyticsSpecialistAgent({
    orgId,
    model,
    customDomainNotes: mergedNotes,
  });

  try {
    const messages = [
      ...history.map((h) => ({ role: h.role, content: h.content })),
      { role: "user" as const, content: message },
    ];
    const result = await agent.generate(messages, { maxSteps });
    const toolCalls = extractToolCalls(result);

    // Brain: bi-hallucination-guard-false-positives
    // Guard anti-allucinazione. Triggera solo se TUTTE e tre le condizioni sono vere:
    //  1) nessun tool chiamato
    //  2) la domanda utente e' riconducibile a una query dati (keyword business)
    //  3) la risposta contiene cifre o simboli monetari "sospetti"
    //     (una clarifying question tipo "che paese?" non ha cifre -> skip)
    // In piu' l'upgrade hint filtra il modello attualmente attivo, altrimenti
    // consiglieremmo all'utente di passare al modello che sta gia' usando.
    const hallucinationRisk =
      toolCalls.length === 0 &&
      looksLikeDataQuery(message) &&
      looksLikeHallucinatedAnswer(result.text);
    const finalText = hallucinationRisk
      ? [
          "> **Attenzione**: il modello non ha interrogato il database. I numeri riportati qui sotto sono con molta probabilita' allucinazioni.",
          `> ${buildUpgradeHint(cfg?.provider, cfg?.model)}`,
          "",
          "---",
          "",
          result.text,
        ].join("\n")
      : result.text;

    return c.json({
      text: finalText,
      toolCalls,
      usage: (result as { usage?: unknown }).usage,
      hallucinationGuard: hallucinationRisk,
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Errore sconosciuto";
    console.error("[/bi/ask] generate failed:", err);
    return c.json({ error: msg }, 500);
  }
});

// ── Ask stream (SSE) ─────────────────────────────────────────────────

biRoute.post("/ask/stream", async (c) => {
  const parsed = askBodySchema.safeParse(await c.req.json());
  if (!parsed.success) return c.json({ error: parsed.error.flatten() }, 400);
  const { message, history, maxSteps, customDomainNotes } = parsed.data;

  const model = await resolveForProcess(orgId, "bi", "_default");
  if (!model) return c.json({ error: "Nessun LLM configurato per il modulo BI" }, 503);

  const stored = await readRules(orgId);
  const mergedNotes = [
    buildTemporalContext(),
    stored.content.trim(),
    customDomainNotes?.trim(),
  ]
    .filter((s) => s && s.length > 0)
    .join("\n\n---\n\n");

  const agent = await buildAnalyticsSpecialistAgent({
    orgId,
    model,
    customDomainNotes: mergedNotes,
  });
  const messages = [
    ...history.map((h) => ({ role: h.role, content: h.content })),
    { role: "user" as const, content: message },
  ];

  c.header("Content-Type", "text/event-stream");
  c.header("Cache-Control", "no-cache");
  c.header("Connection", "keep-alive");

  // TODO(bi): il client oggi usa solo /ask (sync). Quando cableremo lo stream
  // serve portare qui l'hallucination guard (toolCalls + looksLikeDataQuery +
  // looksLikeHallucinatedAnswer) riusando gli helper in fondo al file.
  // Mastra v0.4 espone result.steps come Promise dopo che il textStream chiude.

  const stream = new ReadableStream({
    async start(controller) {
      const enc = new TextEncoder();
      const send = (event: string, data: unknown) => {
        controller.enqueue(enc.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`));
      };
      try {
        const result = await agent.stream(messages, { maxSteps });
        const streamResult = result as {
          textStream: AsyncIterable<string>;
          text: Promise<string>;
        };
        let full = "";
        for await (const chunk of streamResult.textStream) {
          full += chunk;
          send("chunk", { text: chunk });
        }
        send("done", { text: full });
      } catch (err) {
        send("error", { message: err instanceof Error ? err.message : "stream error" });
      } finally {
        controller.close();
      }
    },
  });

  return new Response(stream, { headers: c.res.headers });
});

// ── Business Rules (convenzioni di dominio editabili dall'admin) ──

biRoute.get("/rules", async (c) => {
  const rules = await readRules(orgId);
  return c.json({
    content: rules.content,
    updatedAt: rules.updatedAt,
    empty: rules.empty,
    template: rules.empty ? RULES_TEMPLATE : undefined,
  });
});

const putRulesSchema = z.object({
  content: z.string().max(50_000, "Max 50KB per le rules"),
});

biRoute.put("/rules", async (c) => {
  const parsed = putRulesSchema.safeParse(await c.req.json());
  if (!parsed.success) return c.json({ error: parsed.error.flatten() }, 400);
  const rules = await writeRules(orgId, parsed.data.content);
  return c.json({
    content: rules.content,
    updatedAt: rules.updatedAt,
    empty: rules.empty,
  });
});

// Info sintetica usata dall'UI per indicatori ("X caratteri configurati")
biRoute.get("/rules/summary", async (c) => {
  const rules = await readRules(orgId);
  return c.json({
    configured: !rules.empty,
    charCount: rules.content.length,
    updatedAt: rules.updatedAt,
  });
});

// ── Audit log tail ──────────────────────────────────────────────────

biRoute.get("/audit", async (c) => {
  const path = auditFilePath(orgId);
  const { existsSync } = await import("node:fs");
  if (!existsSync(path)) return c.json({ entries: [] });
  const { readFile } = await import("node:fs/promises");
  const raw = await readFile(path, "utf8");
  const limit = Number.parseInt(c.req.query("limit") ?? "50", 10);
  const entries = raw
    .split("\n")
    .filter((l) => l.trim().length > 0)
    .slice(-limit)
    .reverse()
    .map((l) => {
      try {
        const parsed = JSON.parse(l);
        return parsed.agentId === "analytics-specialist" ? parsed : null;
      } catch {
        return null;
      }
    })
    .filter((e) => e != null);
  return c.json({ entries });
});

/**
 * Hint temporale iniettato in ogni richiesta.
 * Necessario perche' i LLM hanno un training cutoff e senza questo blocco
 * tendono ad assumere date di 1-2 anni fa come "oggi". Documentato come
 * gotcha in `documentation/gotchas/llm-date-awareness.md`.
 *
 * CRITICO: i bounds "oggi" / "mese" / "anno" sono calcolati nel TIMEZONE
 * del cliente (default Europe/Rome, override via BI_TIMEZONE env). Usare
 * setUTCHours(0,0,0,0) darebbe risultati sbagliati di qualche ora perche'
 * l'utente italiano intende "oggi" in ora locale, non in UTC. L'algoritmo:
 *  1) Determina YYYY-MM-DD per "now" nel timezone target via Intl
 *  2) Calcola l'offset del timezone in quel preciso istante (gestisce DST)
 *  3) Sottrae l'offset dall'istante UTC "YYYY-MM-DDT00:00:00" per avere
 *     il momento UTC che corrisponde alla mezzanotte locale.
 */
function buildTemporalContext(): string {
  const now = new Date();
  const timezone = process.env.BI_TIMEZONE ?? "Europe/Rome";
  const bounds = zonedBounds(now, timezone);

  return [
    "## Contesto temporale (aggiornato a ogni richiesta)",
    "",
    `- **Ora corrente (UTC)**: ${now.toISOString()}`,
    `- **Timezone utente**: ${timezone} (offset ${formatOffset(bounds.offsetMs)})`,
    `- **Oggi (in ${timezone})**: dal ${bounds.dayStart.toISOString()} al ${bounds.dayEnd.toISOString()}`,
    `- **Inizio mese corrente**: ${bounds.monthStart.toISOString()}`,
    `- **Inizio anno corrente**: ${bounds.yearStart.toISOString()}`,
    "",
    "USA SEMPRE queste date ISO quando l'utente dice 'oggi', 'questo mese', 'quest'anno'.",
    `Le date sono gia' convertite in UTC ma rappresentano i confini del giorno in ${timezone},`,
    "quindi passale direttamente ai filtri Mongo senza ricalcolarle.",
    "Non usare date diverse basate sulla tua conoscenza pre-training.",
  ].join("\n");
}

interface ZonedBounds {
  dayStart: Date;
  dayEnd: Date;
  monthStart: Date;
  yearStart: Date;
  offsetMs: number;
}

function zonedBounds(now: Date, timeZone: string): ZonedBounds {
  const offsetMs = getTimezoneOffsetMs(now, timeZone);
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  })
    .formatToParts(now)
    .reduce<Record<string, string>>((acc, p) => {
      if (p.type !== "literal") acc[p.type] = p.value;
      return acc;
    }, {});
  const y = Number.parseInt(parts.year!, 10);
  const m = Number.parseInt(parts.month!, 10);
  const d = Number.parseInt(parts.day!, 10);

  const dayStart = new Date(Date.UTC(y, m - 1, d, 0, 0, 0, 0) - offsetMs);
  const dayEnd = new Date(Date.UTC(y, m - 1, d, 23, 59, 59, 999) - offsetMs);
  const monthStart = new Date(Date.UTC(y, m - 1, 1, 0, 0, 0, 0) - offsetMs);
  const yearStart = new Date(Date.UTC(y, 0, 1, 0, 0, 0, 0) - offsetMs);

  return { dayStart, dayEnd, monthStart, yearStart, offsetMs };
}

function getTimezoneOffsetMs(date: Date, timeZone: string): number {
  // Trick: stampo la stessa istanza di Date in UTC e nel TZ target come
  // stringhe YYYY-MM-DDTHH:mm:ss, poi le parso come UTC e faccio la differenza.
  // Il delta e' l'offset del timezone (positivo per tz a est di UTC).
  const iso = (tz: string): string => {
    const p = new Intl.DateTimeFormat("en-CA", {
      timeZone: tz,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
      hour12: false,
    })
      .formatToParts(date)
      .reduce<Record<string, string>>((acc, part) => {
        if (part.type !== "literal") acc[part.type] = part.value;
        return acc;
      }, {});
    return `${p.year}-${p.month}-${p.day}T${p.hour === "24" ? "00" : p.hour}:${p.minute}:${p.second}Z`;
  };
  const utcMs = Date.parse(iso("UTC"));
  const tzMs = Date.parse(iso(timeZone));
  return tzMs - utcMs;
}

function formatOffset(ms: number): string {
  const sign = ms >= 0 ? "+" : "-";
  const abs = Math.abs(ms);
  const hh = String(Math.floor(abs / 3_600_000)).padStart(2, "0");
  const mm = String(Math.floor((abs % 3_600_000) / 60_000)).padStart(2, "0");
  return `UTC${sign}${hh}:${mm}`;
}

// Euristica per capire se una domanda utente richiede consultazione DB.
// Se si e il modello non ha chiamato tool, quasi sicuramente ha allucinato.
const DATA_QUERY_KEYWORDS = [
  "fatturato", "vendite", "ordini", "margine", "profitto", "incasso",
  "quanti", "quante", "quant ", "numero di", "totale", "media",
  "top", "classifica", "ranking", "peggior", "miglior",
  "elenco", "lista", "mostra", "mostrami", "quali",
  "ieri", "oggi", "domani", "settimana", "mese", "anno", "trimestre",
  "cliente", "clienti", "negozio", "negozi", "store", "agente", "agenti",
  "prodotto", "prodotti", "categoria", "categorie",
  "fattura", "fatture", "documento", "documenti", "ddt",
  "collezion", "tabell",
  "confronto", "differenza", "vs", "rispetto",
];

function looksLikeDataQuery(message: string): boolean {
  const m = message.toLowerCase();
  return DATA_QUERY_KEYWORDS.some((kw) => m.includes(kw));
}

// Brain: bi-hallucination-guard-false-positives
// Un output "sospetto" contiene numeri significativi o simboli monetari che
// NON siano solo date (il contesto temporale iniettato nelle instructions
// potrebbe rimbalzare nel testo). Esempio:
//   "Il fatturato di oggi 22 aprile 2026 e' di 12.450 EUR" -> sospetto (12.450 + EUR)
//   "Per calcolare il fatturato dimmi il paese"            -> non sospetto (no cifre)
//   "Intendi oggi 22 aprile 2026?"                         -> non sospetto (solo data)
function looksLikeHallucinatedAnswer(text: string): boolean {
  const stripped = text
    .replace(/\b\d{4}-\d{2}-\d{2}(T[\d:.Z+-]*)?/gi, "")
    .replace(/\b\d{1,2}[/-]\d{1,2}[/-]\d{2,4}\b/g, "")
    .replace(
      /\b\d{1,2}\s+(gennaio|febbraio|marzo|aprile|maggio|giugno|luglio|agosto|settembre|ottobre|novembre|dicembre)(\s+\d{4})?\b/gi,
      "",
    )
    .replace(/\b(19|20)\d{2}\b/g, "");
  return /\d{3,}|[€$]|\bEUR\b|\bUSD\b|\bmila\b|\bmilion/i.test(stripped);
}

// Costruisce un suggerimento di upgrade escludendo il modello attualmente attivo.
// Se l'utente sta gia' usando l'unica alternativa top-tier, pivota il messaggio
// verso "verifica MCP" perche' il problema non e' di capacita' del modello.
function buildUpgradeHint(activeProvider?: string, activeModel?: string): string {
  const isActiveGpt4oMini =
    activeProvider === "openai" && /gpt-4o-mini/i.test(activeModel ?? "");
  const isActiveQwen3Large =
    activeProvider === "ollama" && /qwen3[:-]?1[0-9]b/i.test(activeModel ?? "");
  const suggestions: string[] = [];
  if (!isActiveQwen3Large) suggestions.push("`qwen3:14b` (Ollama, 9GB, locale)");
  if (!isActiveGpt4oMini) suggestions.push("`gpt-4o-mini` (OpenAI, pay-per-use)");
  if (suggestions.length === 0) {
    return "Il modello e' gia' tool-capable: verifica che ci sia un MCP server connesso in Settings > MCP Servers e che l'agente BI abbia tool assegnati.";
  }
  return `Upgrade consigliato: Settings > Modelli AI > BI, passa a ${suggestions.join(" o ")}.`;
}

function extractToolCalls(result: unknown): unknown[] {
  // Mastra v0.4 restituisce steps con toolCalls/toolResults
  const r = result as { steps?: Array<{ toolCalls?: unknown[]; toolResults?: unknown[] }> };
  if (!Array.isArray(r.steps)) return [];
  const calls: unknown[] = [];
  for (const step of r.steps) {
    if (Array.isArray(step.toolCalls)) calls.push(...step.toolCalls);
  }
  return calls;
}
