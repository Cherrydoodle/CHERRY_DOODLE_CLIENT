import { createHmac } from "node:crypto";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { checkoutConfirmationSchema, checkoutStartSchema, checkoutVerifySchema, razorpayWebhookSchema } from "@/features/checkout/schemas";
import { verifyRazorpayPaymentSignature, verifyRazorpayWebhookSignature } from "@/features/checkout/razorpay";

// Mirrors the query-builder mock pattern in tests/offers-pricing.test.ts.
type TableResult = { data: unknown; error: unknown };
type TableHandler = () => TableResult;
const tableHandlers: Partial<Record<string, TableHandler>> = {};

function createQueryBuilder(table: string): Record<string, unknown> {
  const builder: Record<string, unknown> = {};
  for (const method of ["select", "in", "eq", "is", "order"]) builder[method] = () => builder;
  const resolve = (): TableResult => (tableHandlers[table]?.() ?? { data: null, error: null });
  builder.then = (onFulfilled?: (v: TableResult) => unknown, onRejected?: (r: unknown) => unknown) =>
    Promise.resolve(resolve()).then(onFulfilled, onRejected);
  return builder;
}

vi.mock("@/lib/supabase/admin", () => ({
  createAdminSupabaseClient: () => ({ from: (table: string) => createQueryBuilder(table) }),
}));
vi.mock("@/features/offers/pricing", () => ({ resolveOfferPrices: async () => new Map() }));

const { resolveCheckoutLines } = await import("@/features/checkout/service");

const validCheckout = {
  customer: { name: "Asha Kumar", email: "ASHA@example.com", phone: "+91 98765 43210" },
  shippingAddress: {
    line1: "14 Blossom Road",
    city: "Bengaluru",
    state: "Karnataka",
    postalCode: "560001",
    country: "in",
  },
  items: [{ productSlug: "cherry-bunny-gel-pen-set", color: "Cherry", quantity: 2 }],
  termsAccepted: true,
};

describe("checkout validation", () => {
  it("normalizes customer email and country", () => {
    const result = checkoutStartSchema.parse(validCheckout);
    expect(result.customer.email).toBe("asha@example.com");
    expect(result.shippingAddress.country).toBe("IN");
  });

  it("rejects empty carts and unsafe product identifiers", () => {
    expect(checkoutStartSchema.safeParse({ ...validCheckout, items: [] }).success).toBe(false);
    expect(checkoutStartSchema.safeParse({ ...validCheckout, items: [{ productSlug: "../../admin", quantity: 1 }] }).success).toBe(false);
  });

  it("accepts only provider-shaped verification identifiers", () => {
    expect(checkoutVerifySchema.safeParse({
      checkoutId: "07545075-c751-4f2d-bf28-5a137d6f9de8",
      checkoutToken: "a".repeat(43),
      razorpayOrderId: "order_Abc123",
      razorpayPaymentId: "pay_Def456",
      razorpaySignature: "0".repeat(64),
    }).success).toBe(true);
    expect(checkoutVerifySchema.safeParse({
      checkoutId: "07545075-c751-4f2d-bf28-5a137d6f9de8",
      checkoutToken: "short",
      razorpayOrderId: "not-an-order",
      razorpayPaymentId: "pay_Def456",
      razorpaySignature: "0".repeat(64),
    }).success).toBe(false);
  });

  it("caps quantity per line and total lines per checkout", () => {
    expect(checkoutStartSchema.safeParse({ ...validCheckout, items: [{ productSlug: "cherry-bunny-gel-pen-set", quantity: 99 }] }).success).toBe(true);
    expect(checkoutStartSchema.safeParse({ ...validCheckout, items: [{ productSlug: "cherry-bunny-gel-pen-set", quantity: 100 }] }).success).toBe(false);
    expect(checkoutStartSchema.safeParse({ ...validCheckout, items: [{ productSlug: "cherry-bunny-gel-pen-set", quantity: 0 }] }).success).toBe(false);
    expect(checkoutStartSchema.safeParse({
      ...validCheckout,
      items: Array.from({ length: 26 }, (_, i) => ({ productSlug: `product-${i}`, quantity: 1 })),
    }).success).toBe(false);
  });

  it("rejects a phone number containing letters", () => {
    expect(checkoutStartSchema.safeParse({
      ...validCheckout,
      customer: { ...validCheckout.customer, phone: "call-me-maybe" },
    }).success).toBe(false);
  });
});

// RZ-080: this schema is parsed in the checkout-order route BEFORE any checkout
// session, inventory reservation, or Razorpay order is created, so rejecting an
// unaccepted request here is the actual enforcement of "cannot initiate payment
// without accepting terms" -- nothing downstream ever runs.
describe("checkout terms acceptance (RZ-080)", () => {
  it("rejects a checkout request with terms omitted entirely", () => {
    const { termsAccepted: _omit, ...withoutTerms } = validCheckout;
    expect(checkoutStartSchema.safeParse(withoutTerms).success).toBe(false);
  });

  it("rejects termsAccepted: false (not just a missing field)", () => {
    expect(checkoutStartSchema.safeParse({ ...validCheckout, termsAccepted: false }).success).toBe(false);
  });

  it("accepts only termsAccepted: true", () => {
    expect(checkoutStartSchema.safeParse({ ...validCheckout, termsAccepted: true }).success).toBe(true);
  });

  it("accepts an optional billing address matching the shipping address shape", () => {
    const withBilling = {
      ...validCheckout,
      billingAddress: { line1: "1 Blossom Road", city: "Bengaluru", state: "Karnataka", postalCode: "560001", country: "in" },
    };
    const result = checkoutStartSchema.safeParse(withBilling);
    expect(result.success).toBe(true);
    if (result.success) expect(result.data.billingAddress?.country).toBe("IN");
  });

  it("omitting billingAddress entirely is valid (defaults to same-as-shipping)", () => {
    expect(checkoutStartSchema.safeParse(validCheckout).success).toBe(true);
  });
});

describe("checkout confirmation validation", () => {
  it("accepts a well-formed checkoutId/checkoutToken pair", () => {
    expect(checkoutConfirmationSchema.safeParse({
      checkoutId: "07545075-c751-4f2d-bf28-5a137d6f9de8",
      checkoutToken: "a".repeat(43),
    }).success).toBe(true);
  });

  it("rejects a non-UUID checkoutId or an undersized token", () => {
    expect(checkoutConfirmationSchema.safeParse({ checkoutId: "not-a-uuid", checkoutToken: "a".repeat(43) }).success).toBe(false);
    expect(checkoutConfirmationSchema.safeParse({
      checkoutId: "07545075-c751-4f2d-bf28-5a137d6f9de8",
      checkoutToken: "short",
    }).success).toBe(false);
  });
});

describe("Razorpay webhook payload validation", () => {
  const capturedPayment = {
    event: "payment.captured",
    payload: {
      payment: {
        entity: {
          id: "pay_Def456", order_id: "order_Abc123", amount: 1600, currency: "INR", status: "captured", captured: true, method: "card",
        },
      },
    },
  };

  it("accepts a realistic payment.captured event", () => {
    expect(razorpayWebhookSchema.safeParse(capturedPayment).success).toBe(true);
  });

  it("accepts a payment.failed event carrying an error code/description", () => {
    const failed = {
      event: "payment.failed",
      payload: {
        payment: {
          entity: {
            id: "pay_Def456", order_id: "order_Abc123", amount: 1600, currency: "INR", status: "failed", captured: false,
            error_code: "BAD_REQUEST_ERROR", error_description: "Payment failed due to insufficient funds.",
          },
        },
      },
    };
    expect(razorpayWebhookSchema.safeParse(failed).success).toBe(true);
  });

  it("rejects a payment entity id that doesn't match Razorpay's pay_ prefix", () => {
    const tampered = { ...capturedPayment, payload: { payment: { entity: { ...capturedPayment.payload.payment.entity, id: "not-a-payment-id" } } } };
    expect(razorpayWebhookSchema.safeParse(tampered).success).toBe(false);
  });

  it("rejects a non-positive payment amount", () => {
    const zeroAmount = { ...capturedPayment, payload: { payment: { entity: { ...capturedPayment.payload.payment.entity, amount: 0 } } } };
    expect(razorpayWebhookSchema.safeParse(zeroAmount).success).toBe(false);
  });

  it("passes through unrecognized top-level and payload fields defensively", () => {
    const withExtra = { ...capturedPayment, account_id: "acc_123", payload: { ...capturedPayment.payload, extra_field: true } };
    expect(razorpayWebhookSchema.safeParse(withExtra).success).toBe(true);
  });
});

describe("Razorpay signatures", () => {
  const secret = "test_secret_only_for_unit_tests";

  it("verifies the payment signature over the original order id and payment id", () => {
    const signature = createHmac("sha256", secret).update("order_Abc123|pay_Def456").digest("hex");
    expect(verifyRazorpayPaymentSignature("order_Abc123", "pay_Def456", signature, secret)).toBe(true);
    expect(verifyRazorpayPaymentSignature("order_Other", "pay_Def456", signature, secret)).toBe(false);
  });

  it("verifies webhooks against the unmodified raw body", () => {
    const raw = JSON.stringify({ event: "payment.captured", payload: { payment: { entity: { id: "pay_Def456" } } } });
    const signature = createHmac("sha256", secret).update(raw).digest("hex");
    expect(verifyRazorpayWebhookSignature(Buffer.from(raw, "utf8"), signature, secret)).toBe(true);
    expect(verifyRazorpayWebhookSignature(Buffer.from(`${raw}\n`, "utf8"), signature, secret)).toBe(false);
  });

  // RZ-AUDIT L-7: the dashboard change and the deploy cannot be simultaneous, so
  // without an overlap window every delivery signed with the old secret in between is
  // rejected and eventually abandoned by Razorpay.
  describe("webhook secret rotation", () => {
    const CURRENT = "current_webhook_secret_for_unit_tests";
    const PREVIOUS = "previous_webhook_secret_for_unit_tests";
    const body = Buffer.from(JSON.stringify({ event: "payment.captured" }), "utf8");
    const originalEnv = { ...process.env };

    afterEach(() => {
      process.env = { ...originalEnv };
    });

    function sign(secret: string) {
      return createHmac("sha256", secret).update(body).digest("hex");
    }

    it("accepts a body signed with either the current or the previous secret", async () => {
      process.env.RAZORPAY_WEBHOOK_SECRET = CURRENT;
      process.env.RAZORPAY_WEBHOOK_SECRET_PREVIOUS = PREVIOUS;
      const { validateRazorpayWebhook } = await import("@/features/checkout/razorpay");

      expect(validateRazorpayWebhook(body, sign(CURRENT))).toBe(true);
      expect(validateRazorpayWebhook(body, sign(PREVIOUS))).toBe(true);
      expect(validateRazorpayWebhook(body, sign("some_third_secret_entirely"))).toBe(false);
    });

    it("rejects the previous secret once it is removed", async () => {
      process.env.RAZORPAY_WEBHOOK_SECRET = CURRENT;
      delete process.env.RAZORPAY_WEBHOOK_SECRET_PREVIOUS;
      const { validateRazorpayWebhook } = await import("@/features/checkout/razorpay");

      expect(validateRazorpayWebhook(body, sign(CURRENT))).toBe(true);
      expect(validateRazorpayWebhook(body, sign(PREVIOUS))).toBe(false);
    });

    it("refuses a configuration where the two secrets are identical", async () => {
      process.env.RAZORPAY_WEBHOOK_SECRET = CURRENT;
      process.env.RAZORPAY_WEBHOOK_SECRET_PREVIOUS = CURRENT;
      const { validateRazorpayWebhook } = await import("@/features/checkout/razorpay");

      expect(() => validateRazorpayWebhook(body, sign(CURRENT))).toThrow(/RAZORPAY_WEBHOOK_SECRET_PREVIOUS/);
    });
  });

  // The verifier takes bytes, not a string, precisely so this case cannot arise:
  // decoding first would turn an invalid UTF-8 sequence into U+FFFD and hash
  // something the sender never transmitted.
  it("hashes the exact bytes received rather than a lossy UTF-8 decoding", () => {
    const invalidUtf8 = Buffer.from([0x7b, 0x22, 0x61, 0x22, 0x3a, 0x22, 0xff, 0xfe, 0x22, 0x7d]);
    const signature = createHmac("sha256", secret).update(invalidUtf8).digest("hex");
    expect(verifyRazorpayWebhookSignature(invalidUtf8, signature, secret)).toBe(true);

    // What the old string-based path would have hashed instead.
    const lossy = Buffer.from(new TextDecoder().decode(invalidUtf8), "utf8");
    expect(lossy.equals(invalidUtf8)).toBe(false);
    expect(verifyRazorpayWebhookSignature(lossy, signature, secret)).toBe(false);
  });
});

// Regression test for a bug found while implementing 202607260001_variant_labels_and_media.sql:
// resolveCheckoutLines used to match a checkout line by color name/slug only. That was safe
// exactly as long as (product_id, color_id) was unique -- which product_variants_active_color_idx
// guaranteed. Once that constraint was relaxed to (product_id, color_id, lower(label)) so two
// variants can share a color (e.g. three book covers all in "Cherry"), color-only matching became
// ambiguous: it silently resolves to whichever matching variant happens to sort first, which means
// a customer could be charged for and shipped a different item than the one they selected. The fix
// is to resolve by the exact variantId whenever the client supplies one.
describe("resolveCheckoutLines variant resolution (regression: same-color, different-label variants)", () => {
  beforeEach(() => {
    for (const key of Object.keys(tableHandlers)) delete tableHandlers[key];
  });

  const product = {
    id: "prod-1", slug: "dreamy-diary", name: "Dreamy Diary",
    base_price_cents: 50000, sale_price_cents: null, currency: "INR", status: "published", deleted_at: null,
  };
  // Two variants sharing one color, distinguished only by label -- impossible before
  // the migration above, and exactly the case that made color-only matching ambiguous.
  const galaxyVariant = {
    id: "variant-galaxy", product_id: "prod-1", sku: "DIARY-CHERRY-GALAXY", label: "Galaxy Theme",
    stock_quantity: 10, is_active: true, deleted_at: null, sort_order: 0,
    colors: { name: "Cherry", slug: "cherry" },
  };
  const moonVariant = {
    id: "variant-moon", product_id: "prod-1", sku: "DIARY-CHERRY-MOON", label: "Moon Theme",
    stock_quantity: 10, is_active: true, deleted_at: null, sort_order: 1,
    colors: { name: "Cherry", slug: "cherry" },
  };

  it("resolves the exact requested variant by id, even when an earlier-sorted variant shares its color", async () => {
    tableHandlers.products = () => ({ data: [product], error: null });
    tableHandlers.product_variants = () => ({ data: [galaxyVariant, moonVariant], error: null });

    const resolved = await resolveCheckoutLines({
      items: [{ productSlug: "dreamy-diary", variantId: "variant-moon", quantity: 1 }],
    } as never);

    expect(resolved.lines).toHaveLength(1);
    expect(resolved.lines[0].productVariantId).toBe("variant-moon");
    expect(resolved.lines[0].variantLabel).toBe("Moon Theme");
  });

  it("without a variantId, color-only matching is ambiguous and always picks the first sorted match -- exactly the bug this fix closes", async () => {
    tableHandlers.products = () => ({ data: [product], error: null });
    tableHandlers.product_variants = () => ({ data: [galaxyVariant, moonVariant], error: null });

    const resolved = await resolveCheckoutLines({
      items: [{ productSlug: "dreamy-diary", color: "Cherry", quantity: 1 }],
    } as never);

    expect(resolved.lines[0].productVariantId).toBe("variant-galaxy");
  });

  it("rejects a variantId that does not belong to the requested product", async () => {
    tableHandlers.products = () => ({ data: [product], error: null });
    tableHandlers.product_variants = () => ({ data: [galaxyVariant], error: null });

    await expect(resolveCheckoutLines({
      items: [{ productSlug: "dreamy-diary", variantId: "does-not-exist", quantity: 1 }],
    } as never)).rejects.toThrow();
  });
});
