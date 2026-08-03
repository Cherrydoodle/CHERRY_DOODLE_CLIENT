import { z } from "zod";

import { normalizeIndianPin } from "@/features/delhivery/normalize";

// Indian addresses must carry a strict 6-digit pincode -- Delhivery's manifest API
// rejects anything else -- so this check runs for every address regardless of which
// fields are present in a given payload (create vs. partial update).
function requireValidPinForIndia(value: { countryCode?: string; postalCode?: string }, context: z.RefinementCtx) {
  if (value.countryCode === "IN" && value.postalCode !== undefined && !normalizeIndianPin(value.postalCode)) {
    context.addIssue({ code: "custom", path: ["postalCode"], message: "Enter a valid 6-digit Indian pincode." });
  }
}

export const addressSchema = z.object({
  label: z.string().trim().min(1).max(50).optional().default("Shipping"),
  recipientName: z.string().trim().min(2).max(120),
  phoneNumber: z.string().trim().min(7).max(20).regex(/^\+?[0-9 ()-]+$/),
  line1: z.string().trim().min(3).max(200),
  line2: z.string().trim().max(200).optional(),
  city: z.string().trim().min(2).max(100),
  state: z.string().trim().min(2).max(100),
  postalCode: z.string().trim().min(3).max(24).regex(/^[A-Za-z0-9 -]+$/),
  countryCode: z.string().trim().length(2).transform((value) => value.toUpperCase()).default("IN"),
  isDefault: z.boolean().optional().default(false),
}).strict().superRefine(requireValidPinForIndia);

export type AddressInput = z.infer<typeof addressSchema>;

// A genuinely partial schema (not addressSchema.partial()): addressSchema's fields
// carry .default(...) for label/countryCode/isDefault, and partial() would still
// substitute those defaults for omitted keys, silently overwriting untouched fields
// on every PATCH.
export const addressUpdateSchema = z.object({
  label: z.string().trim().min(1).max(50).optional(),
  recipientName: z.string().trim().min(2).max(120).optional(),
  phoneNumber: z.string().trim().min(7).max(20).regex(/^\+?[0-9 ()-]+$/).optional(),
  line1: z.string().trim().min(3).max(200).optional(),
  line2: z.string().trim().max(200).nullable().optional(),
  city: z.string().trim().min(2).max(100).optional(),
  state: z.string().trim().min(2).max(100).optional(),
  postalCode: z.string().trim().min(3).max(24).regex(/^[A-Za-z0-9 -]+$/).optional(),
  countryCode: z.string().trim().length(2).transform((value) => value.toUpperCase()).optional(),
  isDefault: z.boolean().optional(),
  expectedVersion: z.number().int().positive(),
}).strict().superRefine(requireValidPinForIndia);

export type AddressUpdateInput = z.infer<typeof addressUpdateSchema>;
