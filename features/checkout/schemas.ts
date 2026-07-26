import { z } from "zod";

const slugSchema = z.string().trim().min(1).max(160).regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/);

export const checkoutAddressSchema = z.object({
  line1: z.string().trim().min(3).max(200),
  line2: z.string().trim().max(200).optional(),
  city: z.string().trim().min(2).max(100),
  state: z.string().trim().min(2).max(100),
  postalCode: z.string().trim().min(3).max(20).regex(/^[A-Za-z0-9 -]+$/),
  country: z.string().trim().length(2).transform((value) => value.toUpperCase()),
}).strict();

export const checkoutStartSchema = z.object({
  customer: z.object({
    name: z.string().trim().min(2).max(120),
    email: z.string().trim().email().max(320).transform((value) => value.toLowerCase()),
    phone: z.string().trim().min(7).max(20).regex(/^\+?[0-9 ()-]+$/),
  }).strict(),
  shippingAddress: checkoutAddressSchema,
  // Optional; when provided, collected only for dispute/chargeback record-keeping
  // (this business does not use billing address for tax or invoicing — no GST).
  billingAddress: checkoutAddressSchema.optional(),
  customerNote: z.string().trim().max(2000).optional(),
  items: z.array(z.object({
    productSlug: slugSchema,
    // variantId is preferred when present -- it is the only unambiguous way to pick a
    // variant once two variants can share a color (see 202607260001). color is kept for
    // backward compatibility with any in-flight session built by an older client.
    variantId: z.string().uuid().optional(),
    color: z.string().trim().min(1).max(80).optional(),
    quantity: z.number().int().min(1).max(99),
  }).strict()).min(1).max(25),
  // Must be exactly `true` -- a missing, false, or omitted value is rejected here,
  // before any checkout session, inventory reservation, or Razorpay order exists.
  termsAccepted: z.literal(true),
}).strict();

export const checkoutVerifySchema = z.object({
  checkoutId: z.string().uuid(),
  checkoutToken: z.string().min(32).max(128).regex(/^[A-Za-z0-9_-]+$/),
  razorpayOrderId: z.string().regex(/^order_[A-Za-z0-9]+$/),
  razorpayPaymentId: z.string().regex(/^pay_[A-Za-z0-9]+$/),
  razorpaySignature: z.string().length(64).regex(/^[a-f0-9]+$/i),
}).strict();

export const checkoutConfirmationSchema = z.object({
  checkoutId: z.string().uuid(),
  checkoutToken: z.string().min(32).max(128).regex(/^[A-Za-z0-9_-]+$/),
}).strict();

export const razorpayWebhookSchema = z.object({
  event: z.string().min(1).max(100),
  payload: z.object({
    payment: z.object({
      entity: z.object({
        id: z.string().regex(/^pay_[A-Za-z0-9]+$/),
        order_id: z.string().regex(/^order_[A-Za-z0-9]+$/).nullable(),
        amount: z.number().int().positive(),
        currency: z.string().length(3),
        status: z.string(),
        captured: z.boolean().optional(),
        method: z.string().nullable().optional(),
        error_code: z.string().nullable().optional(),
        error_description: z.string().nullable().optional(),
      }).passthrough(),
    }).optional(),
    order: z.object({ entity: z.object({ id: z.string().regex(/^order_[A-Za-z0-9]+$/) }).passthrough() }).optional(),
    refund: z.object({
      entity: z.object({
        id: z.string().regex(/^rfnd_[A-Za-z0-9]+$/),
        payment_id: z.string().regex(/^pay_[A-Za-z0-9]+$/),
        amount: z.number().int().positive(),
        currency: z.string().length(3),
        status: z.string(),
      }).passthrough(),
    }).optional(),
  }).passthrough(),
}).passthrough();

export type CheckoutStartInput = z.infer<typeof checkoutStartSchema>;
export type CheckoutVerifyInput = z.infer<typeof checkoutVerifySchema>;
export type CheckoutConfirmationInput = z.infer<typeof checkoutConfirmationSchema>;
