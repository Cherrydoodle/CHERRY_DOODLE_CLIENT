import { beforeEach, describe, expect, it, vi } from "vitest";

// RZ-070: verifies the webhook-robustness fixes without touching the existing,
// audited signature-verification/dedup skeleton. Supabase is mocked (see the same
// rationale in tests/refunds.test.ts) with a per-table handler keyed off the whole
// call chain for a request, so a table used for both a lookup and a write within
// one function (e.g. payment_attempts: select-then-upsert) can be told apart.

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
  for (const method of ["select", "eq", "is", "order", "limit", "update", "insert", "upsert"]) {
    builder[method] = (...args: unknown[]) => {
      const call = { method, args };
      callLog.push(call);
      allCalls.push({ table, ...call });
      return builder;
    };
  }
  const resolve = (): TableResult => (tableHandlers[table]?.(callLog) ?? { data: null, error: null });
  builder.maybeSingle = () => Promise.resolve(resolve());
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
vi.mock("@/features/checkout/razorpay", () => ({
  createRazorpayOrder: vi.fn(),
  fetchRazorpayPayment: (...args: unknown[]) => fetchRazorpayPaymentMock(...args),
  getRazorpayPublicConfig: vi.fn(),
  getRazorpaySecret: vi.fn(),
  verifyRazorpayPaymentSignature: vi.fn(),
}));

const processRefundWebhookEventMock = vi.fn();
vi.mock("@/features/refunds/service", () => ({
  processRefundWebhookEvent: (...args: unknown[]) => processRefundWebhookEventMock(...args),
}));

const { processRazorpayWebhook } = await import("@/features/checkout/service");

const SESSION_ROW = { id: "session-1", razorpay_order_id: "order_Abc123", status: "payment_pending" };

function paymentFailedBody() {
  return JSON.stringify({
    event: "payment.failed",
    payload: {
      payment: {
        entity: {
          id: "pay_Failed001", order_id: "order_Abc123", amount: 1600, currency: "INR",
          status: "failed", captured: false, method: "card",
          error_code: "BAD_REQUEST_ERROR", error_description: "Insufficient funds",
        },
      },
    },
  });
}

function refundProcessedBody() {
  return JSON.stringify({
    event: "refund.processed",
    payload: { refund: { entity: { id: "rfnd_001", payment_id: "pay_Abc123", amount: 500, currency: "INR", status: "processed" } } },
  });
}

beforeEach(() => {
  allCalls.length = 0;
  rpcCalls.length = 0;
  for (const key of Object.keys(rpcResults)) delete rpcResults[key];
  for (const key of Object.keys(tableHandlers)) delete tableHandlers[key];
  fetchRazorpayPaymentMock.mockReset();
  processRefundWebhookEventMock.mockReset();

  tableHandlers.checkout_sessions = () => ({ data: SESSION_ROW, error: null });
  tableHandlers.payment_attempts = (calls) => {
    if (calls.some((c) => c.method === "upsert")) return { data: null, error: null };
    return { data: null, error: null }; // no pre-existing payment_attempts row by default
  };
  tableHandlers.audit_logs = () => ({ data: null, error: null });
});

describe("webhook dedup vs. reprocessing", () => {
  it("a fresh event (no prior row) processes once with attempts=1", async () => {
    tableHandlers.webhook_events = (calls) => {
      if (calls.some((c) => c.method === "insert")) return { data: null, error: null };
      return { data: null, error: null };
    };
    const result = await processRazorpayWebhook(refundProcessedBody(), "evt-1", "req-1");
    expect(result).toEqual({ received: true, duplicate: false });
    expect(processRefundWebhookEventMock).toHaveBeenCalledTimes(1);
    const finalUpdate = allCalls.find((c) => c.table === "webhook_events" && c.method === "update");
    expect((finalUpdate?.args[0] as { attempts: number; status: string })).toMatchObject({ attempts: 1, status: "processed" });
  });

  it("a genuine duplicate (already processed) is skipped without reprocessing", async () => {
    tableHandlers.webhook_events = (calls) => {
      if (calls.some((c) => c.method === "insert")) return { data: null, error: { code: "23505" } };
      return { data: { status: "processed", attempts: 1 }, error: null }; // the conflict-resolution lookup
    };
    const result = await processRazorpayWebhook(refundProcessedBody(), "evt-2", "req-2");
    expect(result).toEqual({ received: true, duplicate: true });
    expect(processRefundWebhookEventMock).not.toHaveBeenCalled();
    expect(allCalls.some((c) => c.table === "webhook_events" && c.method === "update")).toBe(false);
  });

  it("a retried delivery of a previously-failed event reprocesses and increments attempts (H7)", async () => {
    tableHandlers.webhook_events = (calls) => {
      if (calls.some((c) => c.method === "insert")) return { data: null, error: { code: "23505" } };
      return { data: { status: "failed", attempts: 1 }, error: null };
    };
    const result = await processRazorpayWebhook(refundProcessedBody(), "evt-3", "req-3");
    expect(result).toEqual({ received: true, duplicate: false });
    expect(processRefundWebhookEventMock).toHaveBeenCalledTimes(1);
    const finalUpdate = allCalls.find((c) => c.table === "webhook_events" && c.method === "update");
    expect((finalUpdate?.args[0] as { attempts: number; status: string })).toMatchObject({ attempts: 2, status: "processed" });
  });

  it("a retried delivery of a 'received' (crashed mid-flight) event also reprocesses", async () => {
    tableHandlers.webhook_events = (calls) => {
      if (calls.some((c) => c.method === "insert")) return { data: null, error: { code: "23505" } };
      return { data: { status: "received", attempts: 1 }, error: null };
    };
    const result = await processRazorpayWebhook(refundProcessedBody(), "evt-4", "req-4");
    expect(result.duplicate).toBe(false);
    expect(processRefundWebhookEventMock).toHaveBeenCalledTimes(1);
  });
});

describe("payment.failed releases reserved inventory (H7)", () => {
  it("releases the checkout session's reservation", async () => {
    tableHandlers.webhook_events = () => ({ data: null, error: null });
    await processRazorpayWebhook(paymentFailedBody(), "evt-5", "req-5");
    const release = rpcCalls.find((c) => c.name === "release_checkout_inventory");
    expect(release?.args).toEqual({ p_checkout_session_id: "session-1", p_target_status: "failed" });
  });

  it("does not downgrade a payment_attempts row already recorded as captured (out-of-order webhook)", async () => {
    tableHandlers.webhook_events = () => ({ data: null, error: null });
    tableHandlers.payment_attempts = (calls) => {
      if (calls.some((c) => c.method === "upsert")) throw new Error("must not upsert over a captured payment");
      return { data: { status: "captured" }, error: null };
    };
    await processRazorpayWebhook(paymentFailedBody(), "evt-6", "req-6");
    expect(allCalls.some((c) => c.table === "payment_attempts" && c.method === "upsert")).toBe(false);
    expect(rpcCalls.some((c) => c.name === "release_checkout_inventory")).toBe(false);
  });

  it("still records the failure when no prior payment_attempts row exists", async () => {
    tableHandlers.webhook_events = () => ({ data: null, error: null });
    await processRazorpayWebhook(paymentFailedBody(), "evt-7", "req-7");
    const upsert = allCalls.find((c) => c.table === "payment_attempts" && c.method === "upsert");
    expect(upsert).toBeDefined();
    expect((upsert?.args[0] as { status: string }).status).toBe("failed");
  });
});

describe("webhook audit trail", () => {
  it("writes an audit_logs entry after successfully processing an event", async () => {
    tableHandlers.webhook_events = () => ({ data: null, error: null });
    await processRazorpayWebhook(paymentFailedBody(), "evt-8", "req-8");
    const audit = allCalls.find((c) => c.table === "audit_logs" && c.method === "insert");
    expect(audit).toBeDefined();
    expect((audit?.args[0] as { action: string }).action).toBe("webhook.payment.failed");
  });

  it("does not write an audit entry for a skipped duplicate", async () => {
    tableHandlers.webhook_events = (calls) => {
      if (calls.some((c) => c.method === "insert")) return { data: null, error: { code: "23505" } };
      return { data: { status: "processed", attempts: 1 }, error: null };
    };
    await processRazorpayWebhook(paymentFailedBody(), "evt-9", "req-9");
    expect(allCalls.some((c) => c.table === "audit_logs" && c.method === "insert")).toBe(false);
  });
});

describe("webhook failure handling", () => {
  it("records the failure with the correct attempt count and surfaces a 503", async () => {
    tableHandlers.webhook_events = (calls) => {
      if (calls.some((c) => c.method === "insert")) return { data: null, error: { code: "23505" } };
      return { data: { status: "failed", attempts: 2 }, error: null };
    };
    processRefundWebhookEventMock.mockRejectedValue(new Error("downstream failure"));
    await expect(processRazorpayWebhook(refundProcessedBody(), "evt-10", "req-10")).rejects.toMatchObject({ status: 503 });
    const finalUpdate = allCalls.find((c) => c.table === "webhook_events" && c.method === "update");
    expect((finalUpdate?.args[0] as { attempts: number; status: string })).toMatchObject({ attempts: 3, status: "failed" });
  });
});
