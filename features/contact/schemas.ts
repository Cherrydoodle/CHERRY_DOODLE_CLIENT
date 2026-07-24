import { z } from "zod";

// Public contact form. `company` is a honeypot: it is hidden from real users and
// must stay empty; any value indicates a bot and the request is silently accepted.
export const contactSchema = z
  .object({
    name: z.string().trim().min(1).max(120),
    email: z.string().trim().toLowerCase().email().max(254),
    subject: z.string().trim().min(1).max(160),
    message: z.string().trim().min(10).max(5000),
    company: z.string().max(0).optional(),
  })
  .strict();

export type ContactInput = z.output<typeof contactSchema>;
