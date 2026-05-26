import { appendFile, mkdir } from "node:fs/promises";
import { existsSync } from "node:fs";
import { resolve } from "node:path";

/**
 * Audit log delle invocazioni tool MCP.
 *
 * Formato: JSON Lines (1 entry per riga). Facile da streamare, filtrare via
 * grep/jq, importare in un SIEM. Un file per org sotto:
 *   ~/.spaceship/mcp-audit/{orgId}.jsonl
 *
 * Scrittura fire-and-forget (non blocca il tool execution). Errori di I/O
 * loggati in console ma non propagati.
 */

const BASE_DIR = resolve(
  process.env.SPACESHIP_DATA_DIR ?? `${process.env.HOME}/.spaceship`,
  "mcp-audit",
);

export interface McpAuditEntry {
  timestamp: string;
  orgId: string;
  agentId: string;
  mcpServer: string;
  toolName: string;
  args: unknown;
  durationMs: number;
  status: "ok" | "error";
  errorMessage?: string;
  userId?: string;
}

async function ensureDir(): Promise<void> {
  if (!existsSync(BASE_DIR)) await mkdir(BASE_DIR, { recursive: true });
}

export async function writeAuditEntry(entry: McpAuditEntry): Promise<void> {
  try {
    await ensureDir();
    const path = resolve(BASE_DIR, `${entry.orgId}.jsonl`);
    await appendFile(path, JSON.stringify(entry) + "\n", "utf8");
  } catch (err) {
    console.warn("[mcp-audit] write failed:", err);
  }
}

export function auditFilePath(orgId: string): string {
  return resolve(BASE_DIR, `${orgId}.jsonl`);
}
