import { z } from "zod";

export const productIdSchema = z.string().uuid();
export const mergeWishlistSchema = z.object({ productIds: z.array(z.string().uuid()).max(100) }).strict();
export const moveWishlistSchema = z.object({
  productVariantId: z.string().uuid().optional(),
  quantity: z.number().int().min(1).max(99).optional().default(1),
}).strict();
