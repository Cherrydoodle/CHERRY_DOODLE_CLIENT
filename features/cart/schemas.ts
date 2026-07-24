import { z } from "zod";

export const addCartItemSchema = z.object({
  productVariantId: z.string().uuid(),
  quantity: z.number().int().min(1).max(99),
}).strict();

export const updateCartItemSchema = z.object({ quantity: z.number().int().min(1).max(99) }).strict();
export const cartItemIdSchema = z.string().uuid();
