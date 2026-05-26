import type { McpServerConfig, McpServerCreate, McpServerUpdate } from "../types.js";

export interface McpStore {
  list(orgId: string): Promise<McpServerConfig[]>;
  get(orgId: string, id: string): Promise<McpServerConfig | null>;
  getByName(orgId: string, name: string): Promise<McpServerConfig | null>;
  create(orgId: string, input: McpServerCreate): Promise<McpServerConfig>;
  update(orgId: string, id: string, patch: McpServerUpdate): Promise<McpServerConfig>;
  markVerified(orgId: string, id: string, error?: string): Promise<void>;
  delete(orgId: string, id: string): Promise<boolean>;
}
