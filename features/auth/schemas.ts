import { z } from "zod";

const email = z.string().trim().toLowerCase().email().max(254);
const password = z.string().min(8, "Password must contain at least 8 characters.").max(128)
  .regex(/[A-Z]/, "Password must contain an uppercase letter.")
  .regex(/[a-z]/, "Password must contain a lowercase letter.")
  .regex(/[0-9]/, "Password must contain a number.");

export const registerSchema = z.object({
  displayName: z.string().trim().min(2).max(80),
  email,
  password,
  marketingConsent: z.boolean().optional().default(false),
}).strict();

export const loginSchema = z.object({
  email,
  password: z.string().min(1).max(128),
  next: z.string().max(500).optional(),
}).strict();

export const forgotPasswordSchema = z.object({ email }).strict();

export const resetPasswordSchema = z.object({ password, confirmPassword: z.string() }).strict()
  .refine((value) => value.password === value.confirmPassword, { path: ["confirmPassword"], message: "Passwords do not match." });

export const updateProfileSchema = z.object({
  displayName: z.string().trim().min(2).max(80).optional(),
  locale: z.string().regex(/^[a-z]{2}(?:-[A-Z]{2})?$/).optional(),
  marketingConsent: z.boolean().optional(),
}).strict().refine((value) => Object.keys(value).length > 0, "At least one profile field is required.");

export function safeNextPath(value: string | undefined, fallback = "/account") {
  if (!value || !value.startsWith("/") || value.startsWith("//") || value.includes("\\")) return fallback;
  try {
    const parsed = new URL(value, "https://cherrydoodle.invalid");
    if (parsed.origin !== "https://cherrydoodle.invalid") return fallback;
    return `${parsed.pathname}${parsed.search}${parsed.hash}`;
  } catch {
    return fallback;
  }
}
