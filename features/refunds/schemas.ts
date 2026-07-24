import { z } from "zod";

export const issueRefundSchema = z.object({
  amountMinor: z.number().int().positive(),
  reason: z.string().trim().min(1).max(500),
}).strict();

export const resolveReturnSchema = z.object({
  decision: z.enum(["approved", "rejected"]),
  note: z.string().trim().max(500).optional(),
}).strict();

export const customerReturnRequestSchema = z.object({
  reason: z.string().trim().min(1).max(500),
}).strict();

export const customerCancelSchema = z.object({
  reason: z.string().trim().max(500).optional(),
}).strict();

export type IssueRefundInput = z.infer<typeof issueRefundSchema>;
export type ResolveReturnInput = z.infer<typeof resolveReturnSchema>;
export type CustomerReturnRequestInput = z.infer<typeof customerReturnRequestSchema>;
export type CustomerCancelInput = z.infer<typeof customerCancelSchema>;
