import { z } from "zod";

export const mediaIdSchema = z.string().uuid();
export const mediaStatusSchema = z.enum(["pending", "ready", "delete_pending", "failed", "deleted"]);
export const mediaPurposeSchema = z.enum(["product", "category", "hero", "content", "avatar", "brand", "order_customization"]);
export const createUploadSchema = z.object({
  purpose: mediaPurposeSchema,
  filename: z.string().trim().min(1).max(255),
  mimeType: z.enum(["image/jpeg", "image/png", "image/webp"]),
  byteSize: z.number().int().min(1).max(10_000_000),
  altText: z.string().trim().max(300),
}).strict().superRefine((value, context) => {
  if (value.purpose !== "content" && value.purpose !== "order_customization" && value.altText.length === 0) {
    context.addIssue({ code: "custom", path: ["altText"], message: "Alt text is required for non-decorative images." });
  }
});

export const completeUploadSchema = z.object({
  width: z.number().int().positive().max(12_000).optional(),
  height: z.number().int().positive().max(12_000).optional(),
}).strict();
