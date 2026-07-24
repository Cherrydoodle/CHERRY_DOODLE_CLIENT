import { beforeEach, describe, expect, it, vi } from "vitest";

import { permissionRoles } from "@/lib/auth/authorization";

// RZ-050: admin payment visibility, requires_review resolution, and reconciliation
// reporting. Supabase is mocked (see tests/refunds.test.ts for the rationale); a
// per-table handler keyed off the full call chain distinguishes reads from writes
// on the same table within one function.

type TableCall = { method: string; args: unknown[] };
type TableResult = { data: unknown; error: unknown; count?: number };
type TableHandler = (calls: TableCall[]) => TableResult;

const tableHandlers: Partial<Record<string, TableHandler>> = {};
const allCalls: Array<{ table: string; method: string; args: unknown[] }> = [];

function createQueryBuilder(table: string): Record<string, unknown> {
  const builder: Record<string, unknown> = {};
  const callLog: TableCall[] = [];
  for (const method of ["select", "eq", "neq", "in", "not", "is", "order", "limit", "range", "gte", "lt", "update", "insert", "or"]) {
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
  createAdminSupabaseClient: () => ({ from: (table: string) => createQueryBuilder(table) }),
}));

const finalizeCapturedPaymentMock = vi.fn();
vi.mock("@/features/checkout/service", () => ({
  finalizeCapturedPayment: (...args: unknown[]) => finalizeCapturedPaymentMock(...args),
}));

const fetchRazorpayPaymentMock = vi.fn();
const fetchRazorpayOrderPaymentsMock = vi.fn();
vi.mock("@/features/checkout/razorpay", () => ({
  fetchRazorpayPayment: (...args: unknown[]) => fetchRazorpayPaymentMock(...args),
  fetchRazorpayOrderPayments: (...args: unknown[]) => fetchRazorpayOrderPaymentsMock(...args),
}));

vi.mock("@/features/media/delivery", () => ({
  mediaImageDto: vi.fn(),
  privateMediaUrl: vi.fn(),
}));

const {
  listRequiresReviewQueue, retryRequiresReviewCompletion, acknowledgeRequiresReview, getReconciliationReport, runPaymentReconciliationSync,
} = await import("@/features/admin-reconciliation/service");
const { getOrder, listOrders } = await import("@/features/admin-operations/service");

const ADMIN_ACTOR = { userId: "admin-1", role: "admin" as const };

beforeEach(() => {
  allCalls.length = 0;
  for (const key of Object.keys(tableHandlers)) delete tableHandlers[key];
  finalizeCapturedPaymentMock.mockReset();
  fetchRazorpayPaymentMock.mockReset();
  fetchRazorpayOrderPaymentsMock.mockReset();
  tableHandlers.audit_logs = () => ({ data: null, error: null });
});

describe("authorization: reconciliation endpoints are admin-only", () => {
  it("customers and catalog_manager do not hold orders.read/orders.write", () => {
    expect(permissionRoles["orders.read"]).toEqual(["admin"]);
    expect(permissionRoles["orders.write"]).toEqual(["admin"]);
  });
});

describe("admin order detail includes the payment timeline", () => {
  it("joins payment_attempts (provider ids, method, status, errors) into getOrder", async () => {
    tableHandlers.orders = () => ({
      data: {
        id: "order-1", order_number: "CD-000001", status: "processing", payment_status: "paid", paid_at: "2026-01-01T00:00:00Z",
        customer_user_id: "cust-1", customer_name: "Asha", customer_email: "asha@example.com", customer_phone: "+911234567890",
        total_minor: 5000, currency: "INR", placed_at: "2026-01-01T00:00:00Z", version: 1,
        shipping_address: {}, customer_note: null, subtotal_minor: 5000, discount_minor: 0, shipping_minor: 0, tax_minor: 0,
        return_status: "none", return_reason: null, return_resolution_note: null,
        order_items: [], order_status_history: [], order_internal_notes: [], refunds: [],
      },
      error: null,
    });
    tableHandlers.checkout_sessions = () => ({ data: { id: "session-1", razorpay_order_id: "order_Abc123" }, error: null });
    tableHandlers.payment_attempts = () => ({
      data: [{
        id: "pa-1", provider_order_id: "order_Abc123", provider_payment_id: "pay_Def456", status: "captured",
        amount_minor: 5000, currency: "INR", method: "card", error_code: null, error_description: null,
        created_at: "2026-01-01T00:00:00Z", updated_at: "2026-01-01T00:00:00Z",
      }],
      error: null,
    });

    const order = await getOrder("order-1");
    expect(order.paymentAttempts).toHaveLength(1);
    expect(order.paymentAttempts[0]).toMatchObject({ razorpayOrderId: "order_Abc123", razorpayPaymentId: "pay_Def456", status: "captured", method: "card" });
  });

  it("returns an empty payment timeline when no checkout session is linked (manual/imported order)", async () => {
    tableHandlers.orders = () => ({
      data: {
        id: "order-2", order_number: "CD-000002", status: "pending", payment_status: "pending", paid_at: null,
        customer_user_id: null, customer_name: "Manual", customer_email: "m@example.com", customer_phone: "+911234567890",
        total_minor: 1000, currency: "INR", placed_at: "2026-01-01T00:00:00Z", version: 1,
        shipping_address: {}, customer_note: null, subtotal_minor: 1000, discount_minor: 0, shipping_minor: 0, tax_minor: 0,
        return_status: "none", return_reason: null, return_resolution_note: null,
        order_items: [], order_status_history: [], order_internal_notes: [], refunds: [],
      },
      error: null,
    });
    tableHandlers.checkout_sessions = () => ({ data: null, error: null });

    const order = await getOrder("order-2");
    expect(order.paymentAttempts).toEqual([]);
  });
});

describe("admin order search by Razorpay payment id", () => {
  it("returns an empty result set for a payment id with no matching order", async () => {
    tableHandlers.payment_attempts = () => ({ data: [], error: null });
    const result = await listOrders({ paymentId: "pay_Unknown123", page: 1, limit: 20 });
    expect(result).toEqual({ items: [], total: 0, page: 1, limit: 20 });
    // The query builder is constructed but never executed (no .range() call, the
    // terminal step) once no session matched the payment id -- no wasted round trip.
    expect(allCalls.some((c) => c.table === "orders" && c.method === "range")).toBe(false);
  });

  it("resolves a payment id to its order via the payment_attempts -> checkout_sessions chain", async () => {
    tableHandlers.payment_attempts = () => ({ data: [{ checkout_session_id: "session-1" }], error: null });
    tableHandlers.checkout_sessions = () => ({ data: [{ order_id: "order-1" }], error: null });
    tableHandlers.orders = () => ({ data: [{ id: "order-1", order_number: "CD-000001", status: "pending", total_minor: 5000, currency: "INR", placed_at: "2026-01-01T00:00:00Z", version: 1, customer_name: "Asha", customer_email: "a@example.com", customer_phone: "+91" }], error: null, count: 1 });

    const result = await listOrders({ paymentId: "pay_Def456", page: 1, limit: 20 });
    expect(result.total).toBe(1);
    const inFilter = allCalls.find((c) => c.table === "orders" && c.method === "in");
    expect(inFilter?.args).toEqual(["id", ["order-1"]]);
  });
});

describe("requires_review queue", () => {
  it("lists unresolved requires_review sessions", async () => {
    tableHandlers.checkout_sessions = () => ({
      data: [{ id: "session-1", customer_name: "Asha", customer_email: "a@example.com", customer_phone: "+91", total_minor: 5000, currency: "INR", razorpay_order_id: "order_Abc", razorpay_payment_id: "pay_Def", created_at: "2026-01-01T00:00:00Z", updated_at: "2026-01-01T00:00:00Z" }],
      error: null, count: 1,
    });
    const result = await listRequiresReviewQueue(1, 20);
    expect(result.total).toBe(1);
    expect(result.items[0]).toMatchObject({ checkoutSessionId: "session-1", razorpayPaymentId: "pay_Def" });
  });
});

describe("retryRequiresReviewCompletion", () => {
  it("404s when the checkout session does not exist", async () => {
    tableHandlers.checkout_sessions = () => ({ data: null, error: null });
    await expect(retryRequiresReviewCompletion("session-1", ADMIN_ACTOR, "req-1")).rejects.toMatchObject({ status: 404 });
    expect(finalizeCapturedPaymentMock).not.toHaveBeenCalled();
  });

  it("409s when the session is not actually in requires_review", async () => {
    tableHandlers.checkout_sessions = () => ({ data: { id: "session-1", status: "completed", razorpay_payment_id: "pay_Def" }, error: null });
    await expect(retryRequiresReviewCompletion("session-1", ADMIN_ACTOR, "req-1")).rejects.toMatchObject({ status: 409, code: "NOT_REQUIRES_REVIEW" });
  });

  it("re-fetches the payment from Razorpay and re-runs order completion on success", async () => {
    tableHandlers.checkout_sessions = () => ({ data: { id: "session-1", status: "requires_review", razorpay_payment_id: "pay_Def456" }, error: null });
    fetchRazorpayPaymentMock.mockResolvedValue({ id: "pay_Def456", status: "captured", captured: true });
    finalizeCapturedPaymentMock.mockResolvedValue({ id: "order-1", orderNumber: "CD-000001" });

    const order = await retryRequiresReviewCompletion("session-1", ADMIN_ACTOR, "req-1");
    expect(fetchRazorpayPaymentMock).toHaveBeenCalledWith("pay_Def456");
    expect(finalizeCapturedPaymentMock).toHaveBeenCalledTimes(1);
    expect(order).toMatchObject({ id: "order-1" });
    const audit = allCalls.find((c) => c.table === "audit_logs" && c.method === "insert");
    expect((audit?.args[0] as { action: string }).action).toBe("requires_review.retried");
  });
});

describe("acknowledgeRequiresReview", () => {
  it("404s when there is no unresolved review item for this session", async () => {
    tableHandlers.checkout_sessions = () => ({ data: null, error: null });
    await expect(acknowledgeRequiresReview("session-1", { note: "refunded manually" }, ADMIN_ACTOR, "req-1")).rejects.toMatchObject({ status: 404 });
  });

  it("records the resolution note and audits it", async () => {
    tableHandlers.checkout_sessions = () => ({ data: { id: "session-1" }, error: null });
    const result = await acknowledgeRequiresReview("session-1", { note: "refunded manually" }, ADMIN_ACTOR, "req-1");
    expect(result).toEqual({ acknowledged: true });
    const audit = allCalls.find((c) => c.table === "audit_logs" && c.method === "insert");
    expect((audit?.args[0] as { action: string }).action).toBe("requires_review.acknowledged");
  });

  it("RZ-090: fails the operation (not a silent log) when the audit write itself fails", async () => {
    tableHandlers.checkout_sessions = () => ({ data: { id: "session-1" }, error: null });
    tableHandlers.audit_logs = () => ({ data: null, error: { code: "23503" } });
    await expect(acknowledgeRequiresReview("session-1", { note: "refunded manually" }, ADMIN_ACTOR, "req-1"))
      .rejects.toMatchObject({ status: 503, code: "AUDIT_LOG_FAILED" });
  });
});

describe("reconciliation report detects a stranded capture", () => {
  it("flags a captured payment whose checkout session never completed", async () => {
    tableHandlers.payment_attempts = () => ({
      data: [{ id: "pa-1", checkout_session_id: "session-1", provider_payment_id: "pay_Def456", amount_minor: 5000, currency: "INR", created_at: "2026-01-01T00:00:00Z" }],
      error: null,
    });
    tableHandlers.checkout_sessions = () => ({
      data: [{ id: "session-1", status: "requires_review", customer_email: "a@example.com" }],
      error: null,
    });

    const report = await getReconciliationReport();
    expect(report.staleCaptures).toHaveLength(1);
    expect(report.staleCaptures[0]).toMatchObject({ checkoutSessionId: "session-1", checkoutSessionStatus: "requires_review", razorpayPaymentId: "pay_Def456" });
  });

  it("reports no mismatches when every captured payment's session completed", async () => {
    tableHandlers.payment_attempts = () => ({
      data: [{ id: "pa-1", checkout_session_id: "session-1", provider_payment_id: "pay_Def456", amount_minor: 5000, currency: "INR", created_at: "2026-01-01T00:00:00Z" }],
      error: null,
    });
    tableHandlers.checkout_sessions = () => ({ data: [{ id: "session-1", status: "completed", customer_email: "a@example.com" }], error: null });

    const report = await getReconciliationReport();
    expect(report.staleCaptures).toEqual([]);
    expect(report.checkedCount).toBe(1);
  });
});

describe("runPaymentReconciliationSync", () => {
  it("recovers a stuck session when Razorpay reports a captured payment", async () => {
    tableHandlers.checkout_sessions = () => ({
      data: [{ id: "session-1", razorpay_order_id: "order_Abc123", status: "payment_pending" }],
      error: null,
    });
    fetchRazorpayOrderPaymentsMock.mockResolvedValue({ count: 1, items: [{ id: "pay_Def456", status: "captured", captured: true }] });
    finalizeCapturedPaymentMock.mockResolvedValue({ id: "order-1" });

    const result = await runPaymentReconciliationSync(10);
    expect(result).toMatchObject({ examined: 1, recovered: 1, stillPending: 0 });
    expect(finalizeCapturedPaymentMock).toHaveBeenCalledTimes(1);
  });

  it("leaves a session alone when Razorpay reports no captured payment yet", async () => {
    tableHandlers.checkout_sessions = () => ({ data: [{ id: "session-1", razorpay_order_id: "order_Abc123", status: "payment_pending" }], error: null });
    fetchRazorpayOrderPaymentsMock.mockResolvedValue({ count: 0, items: [] });

    const result = await runPaymentReconciliationSync(10);
    expect(result).toMatchObject({ examined: 1, recovered: 0, stillPending: 1 });
    expect(finalizeCapturedPaymentMock).not.toHaveBeenCalled();
  });

  it("counts a PAYMENT_REQUIRES_REVIEW outcome as recovered (flagged, not lost)", async () => {
    tableHandlers.checkout_sessions = () => ({ data: [{ id: "session-1", razorpay_order_id: "order_Abc123", status: "payment_pending" }], error: null });
    fetchRazorpayOrderPaymentsMock.mockResolvedValue({ count: 1, items: [{ id: "pay_Def456", status: "captured", captured: true }] });
    const { ApiError } = await import("@/lib/http/problem");
    finalizeCapturedPaymentMock.mockRejectedValue(new ApiError(409, "PAYMENT_REQUIRES_REVIEW", "needs review"));

    const result = await runPaymentReconciliationSync(10);
    expect(result).toMatchObject({ recovered: 1, stillPending: 0, errors: [] });
  });
});
