import { Agent } from "@mastra/core/agent";
import {
  withRequestContext,
  type EmitApproval,
} from "@/core/approvals/registry.js";
import { runDevAgent } from "./dev-agent.js";
import { resolveForProcess } from "@/core/llm/resolver.js";
import { findUser } from "@/features/org/store.js";
import { buildRegisteredAgent, hasAgent } from "./registry.js";
import type {
  AgentRuntime,
  AgentStreamChunk,
  ChatMessage,
} from "./types.js";

/**
 * Brain: studio-futuro-mono
 * Sole entry point for Mastra. Per-request agent instantiation with model from settings.
 */

interface StreamSink {
  emitText: (delta: string) => void;
  emitApproval: EmitApproval;
}

async function buildAgent(
  agentId: string,
  orgId: string,
): Promise<Agent | null> {
  // Per M2.5 usiamo il modello `_default` del modulo. Il routing per-process
  // sara' davvero applicato in M3 con workflow multi-step.
  const model = await resolveForProcess(orgId, agentId, "_default");
  if (!model) return null; // no LLM configured -> dev fallback is expected

  // Brain: 001-preflight-refactor
  // Unknown agentId throws (not silent null) so Inbox dispatch is safe.
  // "No model" is legitimate (dev env), "unknown agent" is a bug.
  if (!hasAgent(agentId)) {
    throw new Error(
      `Unknown agentId: "${agentId}". Check registerAgent() calls in src/index.ts.`,
    );
  }
  return buildRegisteredAgent(agentId, model);
}

async function runMastraAgent(
  agent: Agent,
  messages: ChatMessage[],
  sink: StreamSink,
): Promise<void> {
  const agentName = (agent as unknown as { name?: string }).name ?? "agent";
  console.log(`[${agentName}] turn start - ${messages.length} messages`);
  const start = Date.now();
  let tokenCount = 0;

  await withRequestContext({ emitApproval: sink.emitApproval }, async () => {
    try {
      const result = await agent.stream(messages, { maxSteps: 6 });
      const fullStream = (
        result as unknown as {
          fullStream?: AsyncIterable<{ type: string; [k: string]: unknown }>;
        }
      ).fullStream;
      if (fullStream) {
        for await (const part of fullStream) {
          switch (part.type) {
            case "text-delta": {
              const delta = (part as { textDelta?: string }).textDelta;
              if (delta) {
                tokenCount += 1;
                sink.emitText(delta);
              }
              break;
            }
            case "tool-call":
              console.log(`[${agentName}] tool-call:`, part.toolName);
              break;
            case "tool-result":
              console.log(`[${agentName}] tool-result for:`, part.toolName);
              break;
            case "error": {
              // Brain: mastra-adapter-llm-stream-error-propagation
              // Propagate LLM stream errors as visible SSE text deltas instead of
              // crashing the generator. Prevents random process-level failures on
              // intermittent provider errors (e.g. OpenAI gpt-4o-mini timeouts).
              const payload = JSON.stringify(part).slice(0, 200);
              console.error(
                `[${agentName}] stream error (llm): ${payload}`,
              );
              sink.emitText(
                `\n\n_[errore stream LLM: ${payload}]_`,
              );
              return;
            }
            case "finish":
              console.log(
                `[${agentName}] finish - reason:`,
                (part as { finishReason?: string }).finishReason,
              );
              break;
          }
        }
      } else {
        for await (const delta of result.textStream) {
          tokenCount += 1;
          sink.emitText(delta);
        }
      }
    } catch (err) {
      // Brain: mastra-adapter-llm-stream-error-propagation
      // Catch both sync throws from agent.stream() and async rejects from the
      // underlying AsyncIterable. Surface the message as a final text delta
      // so the SSE client sees *why* the stream ended, instead of a blank
      // connection close that looks like a hung chat.
      const message = err instanceof Error ? err.message : String(err);
      console.error(`[${agentName}] stream caught error: ${message}`);
      sink.emitText(`\n\n_[errore runtime: ${message}]_`);
    }
  });

  console.log(
    `[${agentName}] turn done - ${tokenCount} tokens in ${Date.now() - start}ms`,
  );
}

async function runDevFallback(
  messages: ChatMessage[],
  sink: StreamSink,
): Promise<void> {
  await withRequestContext({ emitApproval: sink.emitApproval }, async () => {
    await runDevAgent(messages, { emitText: sink.emitText });
  });
}

export const mastraRuntime: AgentRuntime = {
  async *streamChat({ agentId, messages, userId }) {
    const found = userId ? await findUser(userId) : null;
    const orgId = found?.org.id ?? "org-dev";

    const queue: AgentStreamChunk[] = [];
    let resolver: (() => void) | null = null;
    let done = false;
    let error: Error | null = null;

    const push = (chunk: AgentStreamChunk): void => {
      queue.push(chunk);
      if (resolver) {
        const r = resolver;
        resolver = null;
        r();
      }
    };

    const sink: StreamSink = {
      emitText: (delta) => push({ type: "text", delta }),
      emitApproval: (req) =>
        push({
          type: "approval",
          id: req.id,
          title: req.title,
          action: req.action,
          details: req.details,
        }),
    };

    const agent = await buildAgent(agentId, orgId);
    const runner = agent
      ? runMastraAgent(agent, messages, sink)
      : runDevFallback(messages, sink);

    runner
      .catch((err: unknown) => {
        error = err instanceof Error ? err : new Error(String(err));
      })
      .finally(() => {
        done = true;
        if (resolver) {
          const r = resolver;
          resolver = null;
          r();
        }
      });

    while (true) {
      while (queue.length > 0) {
        yield queue.shift()!;
      }
      if (done) {
        if (error) throw error;
        return;
      }
      await new Promise<void>((r) => {
        resolver = r;
      });
    }
  },
};
