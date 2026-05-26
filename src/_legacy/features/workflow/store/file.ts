import { readFile, writeFile, mkdir } from "node:fs/promises";
import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { randomUUID } from "node:crypto";
import { workflowSchema, workflowRunSchema } from "../types.js";
import type { Workflow } from "../types.js";
import type { WorkflowStore } from "./interface.js";

const BASE_DIR = resolve(
  process.env.SPACESHIP_DATA_DIR ?? `${process.env.HOME}/.spaceship`,
  "workflows",
);

function orgDir(orgId: string): string {
  return resolve(BASE_DIR, orgId);
}

function wfPath(orgId: string, id: string): string {
  return resolve(orgDir(orgId), `${id}.json`);
}

function runsDir(orgId: string): string {
  return resolve(BASE_DIR, orgId, "runs");
}

function runPath(orgId: string, runId: string): string {
  return resolve(runsDir(orgId), `${runId}.json`);
}

async function ensureDir(dir: string): Promise<void> {
  if (!existsSync(dir)) await mkdir(dir, { recursive: true });
}

async function readJson<T>(path: string): Promise<T | null> {
  if (!existsSync(path)) return null;
  const raw = await readFile(path, "utf8");
  return JSON.parse(raw) as T;
}

async function writeJson(path: string, data: unknown): Promise<void> {
  const dir = resolve(path, "..");
  await ensureDir(dir);
  await writeFile(path, JSON.stringify(data, null, 2) + "\n", "utf8");
}

async function listJsonFiles<T>(dir: string): Promise<T[]> {
  if (!existsSync(dir)) return [];
  const { readdir } = await import("node:fs/promises");
  const files = await readdir(dir);
  const results: T[] = [];
  for (const f of files) {
    if (!f.endsWith(".json")) continue;
    const data = await readJson<T>(resolve(dir, f));
    if (data) results.push(data);
  }
  return results;
}

export function createFileStore(): WorkflowStore {
  return {
    async list(orgId) {
      const raw = await listJsonFiles<unknown>(orgDir(orgId));
      return raw
        .filter((r): r is Record<string, unknown> =>
          typeof r === "object" && r !== null && "nodes" in r)
        .map((r) => workflowSchema.parse(r));
    },

    async get(orgId, id) {
      const raw = await readJson(wfPath(orgId, id));
      return raw ? workflowSchema.parse(raw) : null;
    },

    async save(input) {
      const now = new Date().toISOString();
      const wf: Workflow = workflowSchema.parse({
        ...input,
        id: randomUUID(),
        version: 1,
        createdAt: now,
        updatedAt: now,
      });
      await writeJson(wfPath(wf.orgId, wf.id), wf);
      return wf;
    },

    async update(orgId, id, patch) {
      const existing = await this.get(orgId, id);
      if (!existing) throw new Error(`Workflow ${id} non trovato`);
      const updated = workflowSchema.parse({
        ...existing,
        ...patch,
        version: existing.version + 1,
        updatedAt: new Date().toISOString(),
      });
      await writeJson(wfPath(orgId, id), updated);
      return updated;
    },

    async delete(orgId, id) {
      const path = wfPath(orgId, id);
      if (!existsSync(path)) return false;
      const { unlink } = await import("node:fs/promises");
      await unlink(path);
      return true;
    },

    async listRuns(orgId, workflowId) {
      const all = await listJsonFiles<Record<string, unknown>>(runsDir(orgId));
      return all
        .filter((r) => r.workflowId === workflowId)
        .map((r) => workflowRunSchema.parse(r));
    },

    async getRun(orgId, runId) {
      const raw = await readJson(runPath(orgId, runId));
      return raw ? workflowRunSchema.parse(raw) : null;
    },

    async saveRun(run) {
      const validated = workflowRunSchema.parse(run);
      await writeJson(runPath(validated.orgId, validated.id), validated);
      return validated;
    },

    async updateRun(orgId, runId, patch) {
      const existing = await this.getRun(orgId, runId);
      if (!existing) throw new Error(`Run ${runId} non trovato`);
      const updated = workflowRunSchema.parse({ ...existing, ...patch });
      await writeJson(runPath(orgId, runId), updated);
      return updated;
    },
  };
}
