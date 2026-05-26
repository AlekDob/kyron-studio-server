import type {
  Workflow,
  CreateWorkflowInput,
  UpdateWorkflowInput,
  WorkflowRun,
} from "../types.js";

export interface WorkflowStore {
  list(orgId: string): Promise<Workflow[]>;
  get(orgId: string, id: string): Promise<Workflow | null>;
  save(input: CreateWorkflowInput): Promise<Workflow>;
  update(orgId: string, id: string, patch: UpdateWorkflowInput): Promise<Workflow>;
  delete(orgId: string, id: string): Promise<boolean>;

  listRuns(orgId: string, workflowId: string): Promise<WorkflowRun[]>;
  getRun(orgId: string, runId: string): Promise<WorkflowRun | null>;
  saveRun(run: WorkflowRun): Promise<WorkflowRun>;
  updateRun(orgId: string, runId: string, patch: Partial<WorkflowRun>): Promise<WorkflowRun>;
}
