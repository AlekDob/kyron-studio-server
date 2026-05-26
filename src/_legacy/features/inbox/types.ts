import { z } from "zod";

export const conversationSchema = z.object({
  id: z.string().uuid(),
  userId: z.string(),
  agentId: z.string().nullable(),
  title: z.string(),
  lastMessageAt: z.string(),
  unreadCount: z.number().int(),
  createdAt: z.string(),
});

export const messageSchema = z.object({
  id: z.string().uuid(),
  conversationId: z.string().uuid(),
  role: z.enum(["user", "agent", "system"]),
  content: z.string(),
  toolCalls: z.unknown().nullable(),
  createdAt: z.string(),
});

export const createConversationSchema = z.object({
  agentId: z.string().min(1),
  title: z.string().optional(),
});

export const postMessageSchema = z.object({
  content: z.string().min(1),
});

export type Conversation = z.infer<typeof conversationSchema>;
export type Message = z.infer<typeof messageSchema>;
export type CreateConversationInput = z.infer<typeof createConversationSchema>;
export type PostMessageInput = z.infer<typeof postMessageSchema>;
