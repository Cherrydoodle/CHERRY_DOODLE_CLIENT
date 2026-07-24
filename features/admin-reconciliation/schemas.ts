import { z } from "zod";

export const acknowledgeReviewSchema = z.object({
  note: z.string().trim().min(1).max(1000),
}).strict();

export type AcknowledgeReviewInput = z.infer<typeof acknowledgeReviewSchema>;
