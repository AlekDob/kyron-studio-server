import { randomUUID } from "node:crypto";
import { workflowSchema, workflowRunSchema } from "../types.js";
import type { Workflow, WorkflowRun } from "../types.js";
import type { WorkflowStore } from "./interface.js";

// Brain: dev-mode-requires-memory-fallback

export function createMemoryStore(): WorkflowStore {
  const workflows = new Map<string, Workflow>();
  const runs = new Map<string, WorkflowRun>();

  return {
    async list(orgId) {
      return [...workflows.values()].filter((w) => w.orgId === orgId);
    },

    async get(orgId, id) {
      const wf = workflows.get(id);
      return wf && wf.orgId === orgId ? wf : null;
    },

    async save(input) {
      const now = new Date().toISOString();
      const wf = workflowSchema.parse({
        ...input,
        id: randomUUID(),
        version: 1,
        createdAt: now,
        updatedAt: now,
      });
      workflows.set(wf.id, wf);
      return wf;
    },

    async update(orgId, id, patch) {
      const existing = workflows.get(id);
      if (!existing || existing.orgId !== orgId) {
        throw new Error(`Workflow ${id} non trovato`);
      }
      const updated = workflowSchema.parse({
        ...existing,
        ...patch,
        version: existing.version + 1,
        updatedAt: new Date().toISOString(),
      });
      workflows.set(id, updated);
      return updated;
    },

    async delete(orgId, id) {
      const wf = workflows.get(id);
      if (!wf || wf.orgId !== orgId) return false;
      workflows.delete(id);
      return true;
    },

    async listRuns(orgId, workflowId) {
      return [...runs.values()].filter(
        (r) => r.orgId === orgId && r.workflowId === workflowId,
      );
    },

    async getRun(orgId, runId) {
      const run = runs.get(runId);
      return run && run.orgId === orgId ? run : null;
    },

    async saveRun(run) {
      const validated = workflowRunSchema.parse(run);
      runs.set(validated.id, validated);
      return validated;
    },

    async updateRun(orgId, runId, patch) {
      const existing = runs.get(runId);
      if (!existing || existing.orgId !== orgId) {
        throw new Error(`Run ${runId} non trovato`);
      }
      const updated = workflowRunSchema.parse({ ...existing, ...patch });
      runs.set(runId, updated);
      return updated;
    },
  };
}
