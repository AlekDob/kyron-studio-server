import { EventEmitter } from "node:events";

/**
 * Brain: 024-workflow-module — global in-process event bus.
 * Used to notify SSE subscribers when inbox messages are appended.
 * In-memory only. If serve with multiple processes, swap with Redis pub/sub.
 */

export interface InboxEvent {
  type: "message-appended" | "conversation-touched";
  userId: string;
  conversationId: string;
  agentId: string | null;
  preview: string;
  timestamp: string;
}

class TypedBus extends EventEmitter {
  emitInbox(event: InboxEvent): void {
    this.emit("inbox", event);
  }

  onInbox(listener: (event: InboxEvent) => void): () => void {
    this.on("inbox", listener);
    return () => this.off("inbox", listener);
  }
}

export const eventBus = new TypedBus();

// Cap alto: ogni SSE subscriber aggiunge un listener.
eventBus.setMaxListeners(200);
