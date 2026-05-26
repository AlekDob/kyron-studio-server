import { supabaseService } from "@/core/supabase/client.js";
import { workflowSchema, workflowRunSchema } from "../types.js";
import type { Workflow, WorkflowRun } from "../types.js";
import type { WorkflowStore } from "./interface.js";

function mapWorkflow(row: Record<string, unknown>): Workflow {
  return workflowSchema.parse({
    id: row.id,
    orgId: row.org_id,
    name: row.name,
    description: row.description ?? "",
    status: row.status,
    tags: row.tags ?? [],
    nodes: row.nodes,
    edges: row.edges,
    version: row.version,
    createdBy: row.created_by,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  });
}

function mapRun(row: Record<string, unknown>): WorkflowRun {
  return workflowRunSchema.parse({
    id: row.id,
    workflowId: row.workflow_id,
    orgId: row.org_id,
    status: row.status,
    triggerData: row.trigger_data ?? {},
    steps: row.steps ?? [],
    startedAt: row.started_at,
    completedAt: row.completed_at,
    conversationId: row.conversation_id ?? null,
    triggerSource: row.trigger_source ?? "manual",
  });
}

export function createSupabaseStore(): WorkflowStore {
  if (!supabaseService) {
    throw new Error("Supabase non configurato — usa SPACESHIP_STORE=file o memory");
  }
  const sb = supabaseService;

  return {
    async list(orgId) {
      const { data, error } = await sb
        .from("workflows")
        .select("*")
        .eq("org_id", orgId)
        .order("updated_at", { ascending: false });
      if (error) throw new Error(`list workflows: ${error.message}`);
      return (data ?? []).map(mapWorkflow);
    },

    async get(orgId, id) {
      const { data, error } = await sb
        .from("workflows")
        .select("*")
        .eq("org_id", orgId)
        .eq("id", id)
        .single();
      if (error) return null;
      return data ? mapWorkflow(data) : null;
    },

    async save(input) {
      const now = new Date().toISOString();
      const { data, error } = await sb
        .from("workflows")
        .insert({
          org_id: input.orgId,
          name: input.name,
          description: input.description,
          status: input.status ?? "draft",
          tags: input.tags ?? [],
          nodes: input.nodes,
          edges: input.edges,
          created_by: input.createdBy,
          version: 1,
          created_at: now,
          updated_at: now,
        })
        .select()
        .single();
      if (error) throw new Error(`save workflow: ${error.message}`);
      return mapWorkflow(data);
    },

    async update(orgId, id, patch) {
      const current = await this.get(orgId, id);
      if (!current) throw new Error(`Workflow ${id} non trovato`);
      const { data, error } = await sb
        .from("workflows")
        .update({
          ...(patch.name !== undefined && { name: patch.name }),
          ...(patch.description !== undefined && { description: patch.description }),
          ...(patch.status !== undefined && { status: patch.status }),
          ...(patch.tags !== undefined && { tags: patch.tags }),
          ...(patch.nodes !== undefined && { nodes: patch.nodes }),
          ...(patch.edges !== undefined && { edges: patch.edges }),
          version: current.version + 1,
          updated_at: new Date().toISOString(),
        })
        .eq("org_id", orgId)
        .eq("id", id)
        .select()
        .single();
      if (error) throw new Error(`update workflow: ${error.message}`);
      return mapWorkflow(data);
    },

    async delete(orgId, id) {
      const { error } = await sb
        .from("workflows")
        .delete()
        .eq("org_id", orgId)
        .eq("id", id);
      return !error;
    },

    async listRuns(orgId, workflowId) {
      const { data, error } = await sb
        .from("workflow_runs")
        .select("*")
        .eq("org_id", orgId)
        .eq("workflow_id", workflowId)
        .order("started_at", { ascending: false });
      if (error) throw new Error(`list runs: ${error.message}`);
      return (data ?? []).map(mapRun);
    },

    async getRun(orgId, runId) {
      const { data, error } = await sb
        .from("workflow_runs")
        .select("*")
        .eq("org_id", orgId)
        .eq("id", runId)
        .single();
      if (error) return null;
      return data ? mapRun(data) : null;
    },

    async saveRun(run) {
      const { data, error } = await sb
        .from("workflow_runs")
        .insert({
          id: run.id,
          workflow_id: run.workflowId,
          org_id: run.orgId,
          status: run.status,
          trigger_data: run.triggerData,
          steps: run.steps,
          started_at: run.startedAt,
          completed_at: run.completedAt,
          conversation_id: run.conversationId,
          trigger_source: run.triggerSource,
        })
        .select()
        .single();
      if (error) throw new Error(`save run: ${error.message}`);
      return mapRun(data);
    },

    async updateRun(orgId, runId, patch) {
      const { data, error } = await sb
        .from("workflow_runs")
        .update({
          ...(patch.status !== undefined && { status: patch.status }),
          ...(patch.steps !== undefined && { steps: patch.steps }),
          ...(patch.completedAt !== undefined && { completed_at: patch.completedAt }),
        })
        .eq("org_id", orgId)
        .eq("id", runId)
        .select()
        .single();
      if (error) throw new Error(`update run: ${error.message}`);
      return mapRun(data);
    },
  };
}
