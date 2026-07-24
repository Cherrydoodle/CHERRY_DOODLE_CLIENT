import { z } from "zod";

export const subscribeSchema = z.object({
  email: z.string().trim().toLowerCase().email().max(254),
  source: z.literal("footer").optional().default("footer"),
  company: z.string().max(0).optional(),
}).strict();

export const unsubscribeSchema = z.object({ token: z.string().regex(/^[A-Za-z0-9_-]{32,200}$/) }).strict();
export const newsletterTokenSchema = z.string().regex(/^[A-Za-z0-9_-]{32,200}$/);
