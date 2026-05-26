import { z } from "zod";

export const categorySchema = z.enum([
  "office_supplies",
  "travel",
  "software",
  "consulting",
  "utilities",
  "other",
]);

export const invoiceStatusSchema = z.enum([
  "pending",
  "approved",
  "paid",
  "needs_review",
]);

export const invoiceSchema = z.object({
  id: z.string(),
  supplier: z.string(),
  amount: z.number(),
  currency: z.literal("EUR"),
  issued_at: z.string(),
  due_at: z.string(),
  status: invoiceStatusSchema,
  category: categorySchema.optional(),
  notes: z.string().optional(),
});

export type Category = z.infer<typeof categorySchema>;
export type InvoiceStatus = z.infer<typeof invoiceStatusSchema>;
export type Invoice = z.infer<typeof invoiceSchema>;
