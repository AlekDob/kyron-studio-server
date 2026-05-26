/**
 * Agent runtime interface — framework-agnostic contract.
 *
 * Brain: 003-embeddings-policy — any Mastra/Vercel-AI/custom backend must implement this.
 * No `@mastra/*` import outside `./mastra.adapter.ts`.
 */

export interface ChatMessage {
  role: "user" | "assistant" | "system";
  content: string;
}

export interface TextChunk {
  type: "text";
  delta: string;
}

export interface ApprovalChunk {
  type: "approval";
  id: string;
  title: string;
  action: string;
  details: Record<string, unknown>;
}

export type AgentStreamChunk = TextChunk | ApprovalChunk;

export interface AgentRuntime {
  /**
   * Stream a chat completion for the given conversation history.
   * The returned async iterable yields incremental text deltas.
   */
  streamChat(input: {
    agentId: string;
    messages: ChatMessage[];
    userId?: string;
  }): AsyncIterable<AgentStreamChunk>;
}
