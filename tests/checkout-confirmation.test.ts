import { createHmac } from "node:crypto";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// Verifies the anti-IDOR property of the post-payment confirmation lookup: it uses
// the same opaque capability-token pattern as /verify (constant-time HMAC compare
// against a stored hash), so neither a wrong token nor a nonexistent checkoutId can
// be distinguished from one another, and a correct token only ever returns the
// order tied to that specific checkout session.

const originalEnv = { ...process.env };
const HMAC_SECRET = "test-hmac-secret-at-least-32-bytes-long";

type QueryResult = { data: unknown; error: unknown };
const tableResults: Record<string, QueryResult> = {
  checkout_sessions: { data: null, error: null },
  orders: { data: null, error: null },
};
const fromCalls: string[] = [];

function createQueryBuilder(table: string): Record<string, unknown> {
  const builder: Record<string, unknown> = {};
  for (const method of ["select", "eq", "is", "order", "range"]) {
    builder[method] = () => builder;
  }
  builder.maybeSingle = () => Promise.resolve(tableResults[table]);
  builder.then = (onFulfilled?: (value: QueryResult) => unknown, onRejected?: (reason: unknown) => unknown) =>
    Promise.resolve(tableResults[table]).then(onFulfilled, onRejected);
  return builder;
}

vi.mock("@/lib/supabase/admin", () => ({
  createAdminSupabaseClient: () => ({
    from: (table: string) => {
      fromCalls.push(table);
      return createQueryBuilder(table);
    },
  }),
}));

const { getCheckoutConfirmation } = await import("@/features/checkout/service");

function tokenHashFor(token: string) {
  return createHmac("sha256", HMAC_SECRET).update(token).digest("hex");
}

beforeEach(() => {
  process.env.APP_HMAC_SECRET = HMAC_SECRET;
  tableResults.checkout_sessions = { data: null, error: null };
  tableResults.orders = { data: null, error: null };
  fromCalls.length = 0;
});

afterEach(() => {
  process.env = { ...originalEnv };
});

const CHECKOUT_ID = "07545075-c751-4f2d-bf28-5a137d6f9de8";
const REAL_TOKEN = "a".repeat(43);
const WRONG_TOKEN = "b".repeat(43);

describe("getCheckoutConfirmation", () => {
  it("404s with a wrong token, even when the session exists", async () => {
    tableResults.checkout_sessions = {
      data: { id: CHECKOUT_ID, status: "completed", order_id: "order-1", guest_token_hash: tokenHashFor(REAL_TOKEN) },
      error: null,
    };
    await expect(
      getCheckoutConfirmation({ checkoutId: CHECKOUT_ID, checkoutToken: WRONG_TOKEN }),
    ).rejects.toMatchObject({ status: 404, code: "CHECKOUT_NOT_FOUND" });
  });

  it("returns the identical error whether the session is missing or the token is wrong (no enumeration)", async () => {
    tableResults.checkout_sessions = { data: null, error: null };
    const missing = await getCheckoutConfirmation({ checkoutId: CHECKOUT_ID, checkoutToken: WRONG_TOKEN }).catch((e) => e);

    tableResults.checkout_sessions = {
      data: { id: CHECKOUT_ID, status: "completed", order_id: "order-1", guest_token_hash: tokenHashFor(REAL_TOKEN) },
      error: null,
    };
    const wrongToken = await getCheckoutConfirmation({ checkoutId: CHECKOUT_ID, checkoutToken: WRONG_TOKEN }).catch((e) => e);

    expect(missing.status).toBe(wrongToken.status);
    expect(missing.code).toBe(wrongToken.code);
  });

  it("returns the mapped order for a completed session with a matching token", async () => {
    tableResults.checkout_sessions = {
      data: { id: CHECKOUT_ID, status: "completed", order_id: "order-1", guest_token_hash: tokenHashFor(REAL_TOKEN) },
      error: null,
    };
    tableResults.orders = {
      data: {
        id: "order-1", order_number: "CD-000010", status: "processing", payment_status: "paid",
        paid_at: "2026-01-01T00:00:00Z", placed_at: "2026-01-01T00:00:00Z", total_minor: 3000, currency: "INR",
        subtotal_minor: 3000, discount_minor: 0, shipping_minor: 0, tax_minor: 0,
        shipping_address: { line1: "1 Road" }, customer_note: null, order_items: [], order_status_history: [],
      },
      error: null,
    };
    const result = await getCheckoutConfirmation({ checkoutId: CHECKOUT_ID, checkoutToken: REAL_TOKEN });
    expect(result.status).toBe("completed");
    expect(result.order?.orderNumber).toBe("CD-000010");
    expect(fromCalls).toContain("orders");
  });

  it("reports requires_review without an order when capture succeeded but conversion did not", async () => {
    tableResults.checkout_sessions = {
      data: { id: CHECKOUT_ID, status: "requires_review", order_id: null, guest_token_hash: tokenHashFor(REAL_TOKEN) },
      error: null,
    };
    const result = await getCheckoutConfirmation({ checkoutId: CHECKOUT_ID, checkoutToken: REAL_TOKEN });
    expect(result).toEqual({ status: "requires_review", order: null });
  });

  it("reports a pending status without an order while payment is still in flight", async () => {
    tableResults.checkout_sessions = {
      data: { id: CHECKOUT_ID, status: "payment_pending", order_id: null, guest_token_hash: tokenHashFor(REAL_TOKEN) },
      error: null,
    };
    const result = await getCheckoutConfirmation({ checkoutId: CHECKOUT_ID, checkoutToken: REAL_TOKEN });
    expect(result).toEqual({ status: "payment_pending", order: null });
  });
});
