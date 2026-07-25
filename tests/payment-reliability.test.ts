import { beforeEach, describe, expect, it, vi } from "vitest";

// RZ-AUDIT: the three paths where Razorpay captured a customer's money but no order
// was ever created (H-1 retry after a decline, H-2 auto-capture disabled, H-3 late
// payment after the reservation lapsed), plus the webhook replay key (H-4).
//
// Supabase is mocked with the same per-table, call-chain-aware harness used by
// tests/webhook-robustness.test.ts.

type TableCall = { method: string; args: unknown[] };
type TableResult = { data: unknown; error: unknown };
type TableHandler = (calls: TableCall[]) => TableResult;

const tableHandlers: Partial<Record<string, TableHandler>> = {};
const allCalls: Array<{ table: string; method: string; args: unknown[] }> = [];
const rpcCalls: Array<{ name: string; args: unknown }> = [];
const rpcResults: Record<string, { data: unknown; error: unknown }> = {};

function createQueryBuilder(table: string): Record<string, unknown> {
  const builder: Record<string, unknown> = {};
  const callLog: TableCall[] = [];
  for (const method of ["select", "eq", "neq", "is", "in", "lt", "lte", "order", "limit", "update", "insert", "upsert", "delete"]) {
    builder[method] = (...args: unknown[]) => {
      const call = { method, args };
      callLog.push(call);
      allCalls.push({ table, ...call });
      return builder;
    };
  }
  const resolve = (): TableResult => tableHandlers[table]?.(callLog) ?? { data: null, error: null };
  builder.maybeSingle = () => Promise.resolve(resolve());
  builder.single = () => Promise.resolve(resolve());
  builder.then = (onFulfilled?: (v: TableResult) => unknown, onRejected?: (r: unknown) => unknown) =>
    Promise.resolve(resolve()).then(onFulfilled, onRejected);
  return builder;
}

vi.mock("@/lib/supabase/admin", () => ({
  createAdminSupabaseClient: () => ({
    from: (table: string) => createQueryBuilder(table),
    rpc: (name: string, args: unknown) => {
      rpcCalls.push({ name, args });
      return Promise.resolve(rpcResults[name] ?? { data: null, error: null });
    },
  }),
}));

const fetchRazorpayPaymentMock = vi.fn();
const captureRazorpayPaymentMock = vi.fn();
const createRazorpayRefundMock = vi.fn();

vi.mock("@/features/checkout/razorpay", () => ({
  captureRazorpayPayment: (...args: unknown[]) => captureRazorpayPaymentMock(...args),
  createRazorpayOrder: vi.fn(),
  createRazorpayRefund: (...args: unknown[]) => createRazorpayRefundMock(...args),
  fetchRazorpayPayment: (...args: unknown[]) => fetchRazorpayPaymentMock(...args),
  getRazorpayPublicConfig: vi.fn(),
  getRazorpaySecret: vi.fn(),
  verifyRazorpayPaymentSignature: vi.fn(),
  WEBHOOK_TIMEOUT_MS: 3_500,
}));

vi.mock("@/features/refunds/service", () => ({ processRefundWebhookEvent: vi.fn() }));

const { finalizeCapturedPayment, processRazorpayWebhook } = await import("@/features/checkout/service");
type CheckoutRecord = Parameters<typeof finalizeCapturedPayment>[0];

const OPEN_UNTIL = new Date(Date.now() + 10 * 60_000).toISOString();

function session(overrides: Partial<CheckoutRecord> = {}): CheckoutRecord {
  return {
    id: "session-1",
    status: "payment_pending",
    guest_token_hash: "0".repeat(64),
    currency: "INR",
    total_minor: 249900,
    razorpay_order_id: "order_Abc123",
    razorpay_payment_id: null,
    order_id: null,
    customer_name: "Asha",
    customer_email: "asha@example.com",
    customer_phone: "+919876543210",
    reservation_expires_at: OPEN_UNTIL,
    ...overrides,
  } as CheckoutRecord;
}

function payment(overrides: Record<string, unknown> = {}) {
  return {
    id: "pay_Abc123",
    order_id: "order_Abc123",
    amount: 249900,
    currency: "INR",
    status: "captured",
    captured: true,
    method: "upi",
    created_at: 1_800_000_000,
    ...overrides,
  } as never;
}

const ORDER_ROW = {
  id: "order-uuid",
  order_number: "CD-010001",
  status: "pending",
  payment_status: "paid",
  total_minor: 249900,
  currency: "INR",
  placed_at: "2026-07-24T00:00:00.000Z",
};

beforeEach(() => {
  allCalls.length = 0;
  rpcCalls.length = 0;
  for (const key of Object.keys(rpcResults)) delete rpcResults[key];
  for (const key of Object.keys(tableHandlers)) delete tableHandlers[key];
  fetchRazorpayPaymentMock.mockReset();
  captureRazorpayPaymentMock.mockReset();
  createRazorpayRefundMock.mockReset();

  tableHandlers.orders = () => ({ data: ORDER_ROW, error: null });
  tableHandlers.payment_attempts = () => ({ data: null, error: null });
  tableHandlers.checkout_sessions = () => ({ data: null, error: null });
  tableHandlers.email_outbox = () => ({ data: null, error: null });
  tableHandlers.audit_logs = () => ({ data: null, error: null });
  rpcResults.complete_razorpay_checkout = { data: "order-uuid", error: null };
});

// H-2: auto-capture is a Dashboard setting the Orders API cannot force. An
// authorized payment must be captured by us, or Razorpay auto-refunds it days later
// and no order is ever created.
describe("H-2 authorized payments are captured explicitly", () => {
  it("captures an authorized payment and then creates the order", async () => {
    captureRazorpayPaymentMock.mockResolvedValue(payment());

    const order = await finalizeCapturedPayment(session(), payment({ status: "authorized", captured: false }));

    expect(captureRazorpayPaymentMock).toHaveBeenCalledWith("pay_Abc123", 249900, "INR");
    expect(rpcCalls.some((c) => c.name === "complete_razorpay_checkout")).toBe(true);
    expect(order.orderNumber).toBe("CD-010001");
  });

  it("falls back to the provider's own record when the capture call errors (auto-capture won the race)", async () => {
    captureRazorpayPaymentMock.mockRejectedValue(new Error("already captured"));
    fetchRazorpayPaymentMock.mockResolvedValue(payment());

    const order = await finalizeCapturedPayment(session(), payment({ status: "authorized", captured: false }));

    expect(fetchRazorpayPaymentMock).toHaveBeenCalledWith("pay_Abc123");
    expect(order.orderNumber).toBe("CD-010001");
  });

  it("refuses to create an order for a payment that is still not captured", async () => {
    captureRazorpayPaymentMock.mockRejectedValue(new Error("nope"));
    fetchRazorpayPaymentMock.mockResolvedValue(payment({ status: "authorized", captured: false }));

    await expect(finalizeCapturedPayment(session(), payment({ status: "authorized", captured: false })))
      .rejects.toMatchObject({ code: "PAYMENT_NOT_CAPTURED" });
    expect(rpcCalls.some((c) => c.name === "complete_razorpay_checkout")).toBe(false);
  });
});

// H-1 / H-3: a session that a failed-payment webhook or the expiry sweep took out of
// 'payment_pending' must not strand a real capture.
describe("H-1/H-3 a capture against a non-pending checkout is reclaimed or refunded", () => {
  it("reclaims a 'failed' checkout and completes the order (retry after a decline)", async () => {
    rpcResults.reclaim_checkout_for_capture = { data: true, error: null };

    const order = await finalizeCapturedPayment(session({ status: "failed" }), payment());

    expect(rpcCalls.find((c) => c.name === "reclaim_checkout_for_capture")?.args).toEqual({ p_checkout_session_id: "session-1" });
    expect(rpcCalls.some((c) => c.name === "complete_razorpay_checkout")).toBe(true);
    expect(order.orderNumber).toBe("CD-010001");
  });

  it("auto-refunds a capture whose expired checkout cannot be re-reserved", async () => {
    rpcResults.reclaim_checkout_for_capture = { data: false, error: null };
    createRazorpayRefundMock.mockResolvedValue({ id: "rfnd_1", status: "processed" });

    await expect(finalizeCapturedPayment(session({ status: "expired" }), payment()))
      .rejects.toMatchObject({ code: "PAYMENT_AUTO_REFUNDED" });

    expect(createRazorpayRefundMock).toHaveBeenCalledWith(
      expect.objectContaining({ paymentId: "pay_Abc123", amount: 249900, idempotencyKey: "checkout-unfulfillable:session-1" }),
    );
    expect(rpcCalls.some((c) => c.name === "complete_razorpay_checkout")).toBe(false);
    // The shopper is told their money came back, rather than left guessing.
    const queued = allCalls.find((c) => c.table === "email_outbox" && c.method === "insert");
    expect((queued?.args[0] as { message_type: string }).message_type).toBe("payment_auto_refunded");
  });

  it("falls back to the manual review queue when the refund itself fails", async () => {
    rpcResults.reclaim_checkout_for_capture = { data: false, error: null };
    createRazorpayRefundMock.mockRejectedValue(new Error("razorpay down"));

    await expect(finalizeCapturedPayment(session({ status: "expired" }), payment()))
      .rejects.toMatchObject({ code: "PAYMENT_REQUIRES_REVIEW" });

    const queued = allCalls.find((c) => c.table === "email_outbox" && c.method === "insert");
    expect((queued?.args[0] as { message_type: string }).message_type).toBe("payment_requires_review");
  });

  it("does not attempt a reclaim for a checkout that is already pending", async () => {
    await finalizeCapturedPayment(session(), payment());
    expect(rpcCalls.some((c) => c.name === "reclaim_checkout_for_capture")).toBe(false);
  });
});

// H-4: x-razorpay-event-id is outside the HMAC, so a header-keyed dedupe could be
// bypassed by replaying a captured, validly-signed body with a fresh random id.
describe("H-4 webhook deduplication keys on the signed body", () => {
  function seenEventKeys() {
    const keys = new Set<string>();
    tableHandlers.webhook_events = (calls) => {
      const insert = calls.find((c) => c.method === "insert");
      if (insert) {
        const key = (insert.args[0] as { event_key: string }).event_key;
        if (keys.has(key)) return { data: null, error: { code: "23505" } };
        keys.add(key);
        return { data: null, error: null };
      }
      return { data: { status: "processed", attempts: 1 }, error: null };
    };
    return keys;
  }

  const capturedBody = JSON.stringify({
    event: "payment.captured",
    payload: { payment: { entity: { id: "pay_Abc123", order_id: "order_Abc123", amount: 249900, currency: "INR", status: "captured", captured: true } } },
  });

  it("treats a replay of the same signed body as a duplicate even with a new event id", async () => {
    seenEventKeys();
    fetchRazorpayPaymentMock.mockResolvedValue(payment({ order_id: null }));

    const first = await processRazorpayWebhook(capturedBody, "evt-original", "req-1");
    const replay = await processRazorpayWebhook(capturedBody, "evt-attacker-supplied", "req-2");

    expect(first.duplicate).toBe(false);
    expect(replay.duplicate).toBe(true);
    // The replay must not have cost another outbound Razorpay call.
    expect(fetchRazorpayPaymentMock).toHaveBeenCalledTimes(1);
  });

  it("derives the dedupe key from the payload hash, not the header", async () => {
    const keys = seenEventKeys();
    fetchRazorpayPaymentMock.mockResolvedValue(payment({ order_id: null }));
    await processRazorpayWebhook(capturedBody, "evt-original", "req-3");
    expect([...keys][0]).toMatch(/^razorpay:[a-f0-9]{64}$/);
  });
});

// M-6: a non-2xx makes Razorpay retry forever and eventually disable the endpoint.
describe("M-6 signature-valid but unmodelled events are acknowledged", () => {
  it("acknowledges an event type the schema cannot model without recording it", async () => {
    tableHandlers.webhook_events = () => {
      throw new Error("must not touch webhook_events for an unmodelled event");
    };

    const result = await processRazorpayWebhook(
      JSON.stringify({ event: "subscription.charged", payload: { subscription: { entity: { id: "sub_1" } }, payment: { entity: { id: "not-a-payment-id" } } } }),
      "evt-x",
      "req-x",
    );

    expect(result).toMatchObject({ received: true, handled: false });
  });

  it("acknowledges a body that is not JSON at all", async () => {
    const result = await processRazorpayWebhook("<html>gateway error</html>", "evt-y", "req-y");
    expect(result).toMatchObject({ received: true, handled: false });
  });

  it("marks a known-but-unhandled event as processed rather than retryable", async () => {
    tableHandlers.webhook_events = () => ({ data: null, error: null });
    const result = await processRazorpayWebhook(
      JSON.stringify({ event: "order.notified", payload: {} }),
      "evt-z",
      "req-z",
    );
    expect(result).toMatchObject({ received: true, duplicate: false, handled: false });
    const update = allCalls.find((c) => c.table === "webhook_events" && c.method === "update");
    expect((update?.args[0] as { status: string }).status).toBe("processed");
  });
});
