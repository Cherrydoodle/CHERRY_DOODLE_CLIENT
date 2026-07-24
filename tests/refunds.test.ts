import { beforeEach, describe, expect, it, vi } from "vitest";

import { permissionRoles } from "@/lib/auth/authorization";
import {
  customerCancelSchema,
  customerReturnRequestSchema,
  issueRefundSchema,
  resolveReturnSchema,
} from "@/features/refunds/schemas";

// Supabase is mocked (no existing DB-integration harness in this repo — see the
// same rationale in tests/customer-orders.test.ts). The RPC call args/results are
// what matter: they prove the service layer reserves the refund amount in the DB
// BEFORE ever calling Razorpay, and rolls the reservation back to 'failed' if the
// Razorpay call itself fails, so a provider outage never blocks a later refund.

type TableResult = { data: unknown; error: unknown };
type RpcResult = { data: unknown; error: { message: string } | null };

const tableResults: Record<string, TableResult> = {};
const tableCalls: Array<{ table: string; method: string; args: unknown[] }> = [];
const rpcResults: Record<string, RpcResult> = {};
const rpcCalls: Array<{ name: string; args: unknown }> = [];

function createQueryBuilder(table: string): Record<string, unknown> {
  const builder: Record<string, unknown> = {};
  for (const method of ["select", "eq", "is", "order", "limit", "update", "insert"]) {
    builder[method] = (...args: unknown[]) => {
      tableCalls.push({ table, method, args });
      return builder;
    };
  }
  builder.maybeSingle = () => Promise.resolve(tableResults[table] ?? { data: null, error: null });
  builder.then = (onFulfilled?: (v: TableResult) => unknown, onRejected?: (r: unknown) => unknown) =>
    Promise.resolve(tableResults[table] ?? { data: null, error: null }).then(onFulfilled, onRejected);
  return builder;
}

const createRazorpayRefundMock = vi.fn();
const requireUserMock = vi.fn();

vi.mock("@/lib/supabase/admin", () => ({
  createAdminSupabaseClient: () => ({
    from: (table: string) => createQueryBuilder(table),
    rpc: (name: string, args: unknown) => {
      rpcCalls.push({ name, args });
      return Promise.resolve(rpcResults[name] ?? { data: null, error: { message: `UNMOCKED_RPC:${name}` } });
    },
  }),
}));
vi.mock("@/features/checkout/razorpay", () => ({
  createRazorpayRefund: (...args: unknown[]) => createRazorpayRefundMock(...args),
}));
vi.mock("@/lib/auth/authorization", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/auth/authorization")>();
  return { ...actual, requireUser: () => requireUserMock() };
});

const { issueRefund, resolveOrderReturn, markOrderReturned, cancelMyOrder, requestMyOrderReturn, processRefundWebhookEvent } =
  await import("@/features/refunds/service");

const ADMIN_ACTOR = { userId: "admin-1", role: "admin" as const };
const PAYMENT_ATTEMPT = { id: "pa-1", provider_payment_id: "pay_Abc123", amount_minor: 1000, currency: "INR" };

beforeEach(() => {
  tableCalls.length = 0;
  rpcCalls.length = 0;
  for (const key of Object.keys(tableResults)) delete tableResults[key];
  for (const key of Object.keys(rpcResults)) delete rpcResults[key];
  createRazorpayRefundMock.mockReset();
  requireUserMock.mockReset();

  tableResults.checkout_sessions = { data: { id: "session-1" }, error: null };
  tableResults.payment_attempts = { data: PAYMENT_ATTEMPT, error: null };
  tableResults.refunds = { data: null, error: null };
  tableResults.audit_logs = { data: null, error: null };
  rpcResults.mark_refund_processed = { data: { id: "refund-1", status: "processed" }, error: null };
});

describe("refund/return schemas", () => {
  it("rejects a zero or negative refund amount", () => {
    expect(issueRefundSchema.safeParse({ amountMinor: 0, reason: "damaged" }).success).toBe(false);
    expect(issueRefundSchema.safeParse({ amountMinor: -100, reason: "damaged" }).success).toBe(false);
    expect(issueRefundSchema.safeParse({ amountMinor: 500, reason: "damaged" }).success).toBe(true);
  });

  it("requires a non-empty reason on refund and return requests", () => {
    expect(issueRefundSchema.safeParse({ amountMinor: 500, reason: "" }).success).toBe(false);
    expect(customerReturnRequestSchema.safeParse({ reason: "" }).success).toBe(false);
    expect(customerReturnRequestSchema.safeParse({ reason: "wrong item" }).success).toBe(true);
  });

  it("only accepts approved/rejected as a return decision", () => {
    expect(resolveReturnSchema.safeParse({ decision: "approved" }).success).toBe(true);
    expect(resolveReturnSchema.safeParse({ decision: "maybe" }).success).toBe(false);
  });

  it("allows an optional cancellation reason", () => {
    expect(customerCancelSchema.safeParse({}).success).toBe(true);
    expect(customerCancelSchema.safeParse({ reason: "changed my mind" }).success).toBe(true);
  });
});

describe("authorization: refund/return issuance is admin-only", () => {
  it("customers do not hold orders.write (cannot issue refunds or resolve returns)", () => {
    expect(permissionRoles["orders.write"]).not.toContain("customer");
    expect(permissionRoles["orders.write"]).toEqual(["admin"]);
  });
});

describe("issueRefund", () => {
  it("reserves the amount in the DB before calling Razorpay, then syncs a processed result", async () => {
    rpcResults.create_refund_record = { data: { id: "refund-1" }, error: null };
    createRazorpayRefundMock.mockResolvedValue({ id: "rfnd_001", status: "processed", amount: 500, currency: "INR", payment_id: "pay_Abc123", entity: "refund" });

    const result = await issueRefund("order-1", { amountMinor: 500, reason: "damaged item" }, ADMIN_ACTOR, "req-1");

    expect(result).toMatchObject({ refundId: "refund-1", razorpayRefundId: "rfnd_001", status: "processed" });
    const reserveCall = rpcCalls.find((c) => c.name === "create_refund_record");
    expect(reserveCall?.args).toMatchObject({ p_order_id: "order-1", p_amount_minor: 500, p_payment_attempt_id: "pa-1" });
    // Razorpay is only called AFTER the DB reservation succeeds.
    expect(createRazorpayRefundMock).toHaveBeenCalledTimes(1);
    expect(rpcCalls.some((c) => c.name === "mark_refund_processed")).toBe(true);
  });

  it("never calls Razorpay when the DB reservation is rejected as exceeding the captured amount", async () => {
    rpcResults.create_refund_record = { data: null, error: { message: "REFUND_EXCEEDS_CAPTURED" } };

    await expect(issueRefund("order-1", { amountMinor: 5000, reason: "damaged item" }, ADMIN_ACTOR, "req-1"))
      .rejects.toMatchObject({ status: 409, code: "REFUND_EXCEEDS_CAPTURED" });
    expect(createRazorpayRefundMock).not.toHaveBeenCalled();
  });

  it("marks the reservation failed (not blocking future refunds) when the Razorpay call itself fails", async () => {
    rpcResults.create_refund_record = { data: { id: "refund-1" }, error: null };
    createRazorpayRefundMock.mockRejectedValue(new Error("network timeout"));

    await expect(issueRefund("order-1", { amountMinor: 500, reason: "damaged item" }, ADMIN_ACTOR, "req-1")).rejects.toThrow();

    const failUpdate = tableCalls.find((c) => c.table === "refunds" && c.method === "update");
    expect(failUpdate).toBeDefined();
    expect((failUpdate?.args[0] as { status: string }).status).toBe("failed");
  });

  it("404s when there is no captured payment attempt for the order", async () => {
    tableResults.payment_attempts = { data: null, error: null };
    await expect(issueRefund("order-1", { amountMinor: 500, reason: "damaged item" }, ADMIN_ACTOR, "req-1"))
      .rejects.toMatchObject({ status: 404 });
    expect(createRazorpayRefundMock).not.toHaveBeenCalled();
  });
});

describe("resolveOrderReturn / markOrderReturned", () => {
  it("maps RETURN_NOT_PENDING to a 409", async () => {
    rpcResults.resolve_order_return = { data: null, error: { message: "RETURN_NOT_PENDING" } };
    await expect(resolveOrderReturn("order-1", { decision: "approved" }, ADMIN_ACTOR, "req-1"))
      .rejects.toMatchObject({ status: 409, code: "RETURN_NOT_PENDING" });
  });

  it("resolves a pending return and audits the decision", async () => {
    rpcResults.resolve_order_return = { data: { id: "order-1", return_status: "approved" }, error: null };
    const result = await resolveOrderReturn("order-1", { decision: "approved", note: "ok" }, ADMIN_ACTOR, "req-1");
    expect(result).toMatchObject({ return_status: "approved" });
  });

  it("RZ-090: fails the operation (not a silent log) when the audit write itself fails", async () => {
    rpcResults.resolve_order_return = { data: { id: "order-1", return_status: "approved" }, error: null };
    tableResults.audit_logs = { data: null, error: { code: "23503" } };
    await expect(resolveOrderReturn("order-1", { decision: "approved", note: "ok" }, ADMIN_ACTOR, "req-1"))
      .rejects.toMatchObject({ status: 503, code: "AUDIT_LOG_FAILED" });
  });

  it("maps RETURN_NOT_APPROVED to a 409 when marking received out of order", async () => {
    rpcResults.mark_order_returned = { data: null, error: { message: "RETURN_NOT_APPROVED" } };
    await expect(markOrderReturned("order-1", ADMIN_ACTOR, "req-1")).rejects.toMatchObject({ status: 409, code: "RETURN_NOT_APPROVED" });
  });
});

describe("cancelMyOrder (customer-facing, ownership enforced)", () => {
  it("404s when the order does not belong to the caller", async () => {
    requireUserMock.mockResolvedValue({ userId: "customer-a", role: "customer" });
    tableResults.orders = { data: null, error: null }; // filtered out by customer_user_id ownership
    await expect(cancelMyOrder("order-1", {})).rejects.toMatchObject({ status: 404 });
    const ownershipFilter = tableCalls.find((c) => c.table === "orders" && c.method === "eq" && c.args[0] === "customer_user_id");
    expect(ownershipFilter?.args).toEqual(["customer_user_id", "customer-a"]);
  });

  it("calls the shared transition_order_status RPC targeting 'cancelled' for the caller's own order", async () => {
    requireUserMock.mockResolvedValue({ userId: "customer-a", role: "customer" });
    tableResults.orders = { data: { id: "order-1", version: 3, status: "pending", customer_user_id: "customer-a" }, error: null };
    rpcResults.transition_order_status = { data: { id: "order-1", status: "cancelled" }, error: null };

    await cancelMyOrder("order-1", { reason: "changed my mind" });

    const call = rpcCalls.find((c) => c.name === "transition_order_status");
    expect(call?.args).toMatchObject({ p_order_id: "order-1", p_expected_version: 3, p_new_status: "cancelled", p_actor_id: "customer-a" });
  });
});

describe("requestMyOrderReturn (customer-facing)", () => {
  it("maps ORDER_NOT_DELIVERED to a 409", async () => {
    requireUserMock.mockResolvedValue({ userId: "customer-a", role: "customer" });
    rpcResults.request_order_return = { data: null, error: { message: "ORDER_NOT_DELIVERED" } };
    await expect(requestMyOrderReturn("order-1", { reason: "wrong item" })).rejects.toMatchObject({ status: 409, code: "ORDER_NOT_DELIVERED" });
  });
});

describe("processRefundWebhookEvent", () => {
  it("syncs a processed refund via the RPC", async () => {
    await processRefundWebhookEvent({ id: "rfnd_001", status: "processed" });
    expect(rpcCalls.some((c) => c.name === "mark_refund_processed" && (c.args as { p_status: string }).p_status === "processed")).toBe(true);
  });

  it("does nothing for a pending refund event (not yet a terminal outcome)", async () => {
    await processRefundWebhookEvent({ id: "rfnd_002", status: "pending" });
    expect(rpcCalls.some((c) => c.name === "mark_refund_processed")).toBe(false);
  });

  it("does not throw when the webhook references a refund we have no record of", async () => {
    rpcResults.mark_refund_processed = { data: null, error: { message: "REFUND_NOT_FOUND" } };
    await expect(processRefundWebhookEvent({ id: "rfnd_unknown", status: "processed" })).resolves.toBeUndefined();
  });
});
