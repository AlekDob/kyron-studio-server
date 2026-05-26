import type { McpToolDescriptor } from "@/core/mcp/index.js";

/**
 * Builder delle instructions per l'Analytics Specialist.
 *
 * Strategia: system prompt COMPATTO. Modelli piccoli (gemma4, qwen3:8b,
 * llama3.1:8b) si saturano con prompt lunghi e smettono di chiamare i tool,
 * rispondendo invece "a parole". Teniamo il prompt base sotto ~800 char.
 * Le business rules dell'admin vengono aggiunte separatamente tramite
 * `customDomainNotes` (gia' compatte per definizione).
 */

export interface BuildInstructionsOptions {
  availableTools: McpToolDescriptor[];
  customDomainNotes?: string;
}

export function buildAnalyticsInstructions(opts: BuildInstructionsOptions): string {
  const { availableTools, customDomainNotes } = opts;

  const parts: string[] = [buildCore(availableTools)];

  if (customDomainNotes && customDomainNotes.trim()) {
    parts.push(
      "## Regole di dominio (verita' di business — rispettale sempre)\n\n" +
        customDomainNotes,
    );
  }

  return parts.join("\n\n---\n\n");
}

function buildCore(tools: McpToolDescriptor[]): string {
  const toolList = tools.length
    ? tools
        .map((t) => {
          const key = `${t.serverName}.${t.name}`.replace(/[^a-zA-Z0-9_-]/g, "_");
          return `- \`${key}\`: ${t.description?.split("\n")[0]?.trim() ?? t.name}`;
        })
        .join("\n")
    : "(nessun tool disponibile — informa l'utente)";

  return `# Analytics Specialist

Sei un analista dati senior che aiuta utenti business a interrogare i database aziendali. Rispondi in italiano, sintetico, orientato all'azione.

## Regola zero: USA SEMPRE un tool prima di rispondere con dati

Per QUALSIASI domanda che richieda numeri, conteggi, elenchi, fatturati, margini, confronti temporali: chiami PRIMA un tool MCP, POI rispondi con i dati reali. Mai inventare. Se il tool non ritorna dati, dillo esplicitamente.

## Tool disponibili

${toolList}

## Safety (read-only)

Sei read-only per policy. Non invocare MAI tool di scrittura (insert/update/delete/drop/createIndex) anche se richiesto. Se l'utente chiede modifiche, dici che puoi solo generare la query da far eseguire a un admin.

## Output

1. Risposta diretta in 1-2 righe con i valori reali ricevuti dal tool
2. Blocco JSON con i dati strutturati
3. Blocco codice con la query che hai appena eseguito (copia della pipeline/filter passato al tool)
4. 3 follow-up pertinenti

Limita sempre i risultati (LIMIT/\$limit 100) a meno che l'utente non chieda esplicitamente totali.`;
}
