import { readFile, writeFile, mkdir } from "node:fs/promises";
import { existsSync } from "node:fs";
import { resolve } from "node:path";

/**
 * Business Rules del modulo BI.
 *
 * Sono le "convenzioni di dominio" specifiche dell'installazione cliente:
 * - Quali collection/tabella usare per "fatturato"
 * - Quali campi interpretare come revenue / margin / date
 * - Quali filtri applicare di default (tenant, document_type, ecc.)
 * - Qualsiasi altra regola che l'Analytics Specialist deve conoscere per
 *   produrre query corrette e non inventare convenzioni a caso.
 *
 * Persistite come markdown per-org su:
 *   ~/.spaceship/bi/{orgId}/rules.md
 *
 * Markdown perche':
 *  - L'admin lo legge/modifica in chiaro senza form complicati
 *  - L'agente lo riceve come testo e lo interpreta nativamente
 *  - Zero schema rigido — il cliente puo' aggiungere qualsiasi nota
 *
 * Viene passato come `customDomainNotes` al builder dell'agente. Se e' vuoto
 * l'agente usa solo le instructions generiche (e tende ad allucinare le
 * convenzioni di business, come visto nei test pilot).
 */

const BASE_DIR = resolve(
  process.env.SPACESHIP_DATA_DIR ?? `${process.env.HOME}/.spaceship`,
  "bi",
);

function rulesPath(orgId: string): string {
  return resolve(BASE_DIR, orgId, "rules.md");
}

async function ensureDir(dir: string): Promise<void> {
  if (!existsSync(dir)) await mkdir(dir, { recursive: true });
}

export interface BiRules {
  content: string;
  updatedAt: string | null;
  empty: boolean;
}

export async function readRules(orgId: string): Promise<BiRules> {
  const path = rulesPath(orgId);
  if (!existsSync(path)) {
    return { content: "", updatedAt: null, empty: true };
  }
  const [content, stat] = await Promise.all([
    readFile(path, "utf8"),
    (async () => {
      const { stat: fstat } = await import("node:fs/promises");
      return fstat(path);
    })(),
  ]);
  return {
    content,
    updatedAt: stat.mtime.toISOString(),
    empty: content.trim().length === 0,
  };
}

export async function writeRules(orgId: string, content: string): Promise<BiRules> {
  const path = rulesPath(orgId);
  await ensureDir(resolve(path, ".."));
  await writeFile(path, content, "utf8");
  return readRules(orgId);
}

/**
 * Template esempio. Serve come placeholder iniziale nella UI admin quando
 * non ci sono ancora regole configurate. Illustra il formato consigliato
 * ma non e' mai caricato automaticamente come rules attive.
 */
export const RULES_TEMPLATE = `# Regole di dominio BI — \${nomeCliente}

Questo documento viene iniettato nelle instructions dell'Analytics Specialist
prima di ogni query. Scrivi qui le convenzioni di business del tuo database.

## Collezioni principali

| Collezione | Cosa contiene | Campo data | Campo revenue |
|------------|---------------|------------|---------------|
| documents  | Vendite, fatture, DDT, note credito | document_date | total_before_tax |

## Definizione di "fatturato"

Il fatturato del periodo X si calcola con:
- Collezione: \`documents\`
- Filtri obbligatori:
  - \`tenant: "it"\` (per Italia — varia per paese)
  - \`document_type: { $in: ["waybills", "invoices", "credit_notes", "debit_notes", "advance_invoices", "desk_sales"] }\`
  - \`document_date: { $gte: "<inizio>", $lte: "<fine>" }\`
- Aggregazione:
  - \`totalRevenue = $sum: "$total_before_tax"\`
  - \`totalGain = $sum: "$total_gain"\` (margine)

## Convenzioni tenant

- \`it\` = Italia
- \`fr\` = Francia
- \`se\` = Svezia
- \`dk\` = Danimarca
- (altri paesi)

## Date

Le date sono ISO 8601 stringhe: \`"2026-01-09T00:00:00.000Z"\`.
Il campo di business e' \`document_date\`, NON \`date\` (che e' timestamp interno).

## Note aggiuntive

Aggiungi qui qualsiasi altra convenzione che l'agente deve conoscere.
`;
