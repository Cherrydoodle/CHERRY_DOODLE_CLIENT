import { beforeEach, describe, expect, it, vi } from "vitest";

// Mirrors the mocking harness in tests/webhook-robustness.test.ts: a per-table
// handler keyed off the whole call chain, since a table used for both a lookup and
// a write within one function must be told apart.

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

const enqueueEmailMock = vi.fn();
vi.mock("@/features/email/service", () => ({
  enqueueEmail: (...args: unknown[]) => enqueueEmailMock(...args),
}));

// Not exercised by the push path, but service.ts imports it at module scope.
vi.mock("@/features/delhivery/client", () => ({
  checkPincode: vi.fn(), fetchWaybills: vi.fn(), createManifest: vi.fn(),
  trackWaybills: vi.fn(), fetchPackingSlip: vi.fn(), createPickupRequest: vi.fn(),
}));

const { processDelhiveryPush } = await import("@/features/delhivery/service");

function pushBody(overrides: Partial<{ status: string; statusType: string; awb: string; pickUpDate: string | null }> = {}) {
  return JSON.stringify({
    Shipment: {
      AWB: overrides.awb ?? "WB0001",
      ReferenceNo: "CD-010001",
      PickUpDate: overrides.pickUpDate ?? null,
      Status: {
        Status: overrides.status ?? "Manifested",
        StatusType: overrides.statusType ?? "UD",
        StatusDateTime: "2026-01-05T10:00:00.000Z",
        StatusLocation: "Delhi Hub",
        Instructions: "Manifest uploaded",
      },
    },
  });
}

const SHIPMENT_ROW = { id: "shipment-1", order_id: "order-1" };
const ORDER_ROW = { id: "order-1", status: "pending", version: 3, customer_email: "asha@example.com", customer_name: "Asha", order_number: "CD-010001" };

beforeEach(() => {
  allCalls.length = 0;
  rpcCalls.length = 0;
  for (const key of Object.keys(rpcResults)) delete rpcResults[key];
  for (const key of Object.keys(tableHandlers)) delete tableHandlers[key];
  enqueueEmailMock.mockReset();

  tableHandlers.shipments = (calls) => {
    if (calls.some((c) => c.method === "update")) return { data: null, error: null };
    return { data: SHIPMENT_ROW, error: null };
  };
  tableHandlers.orders = () => ({ data: ORDER_ROW, error: null });
  tableHandlers.shipment_scans = () => ({ data: null, error: null });
  tableHandlers.webhook_events = (calls) => {
    if (calls.some((c) => c.method === "insert")) return { data: null, error: null };
    return { data: null, error: null };
  };
});

describe("processDelhiveryPush dedup", () => {
  it("processes a fresh event once", async () => {
    const result = await processDelhiveryPush(pushBody(), "req-1");
    expect(result).toMatchObject({ received: true, duplicate: false, handled: true });
    const finalUpdate = allCalls.find((c) => c.table === "webhook_events" && c.method === "update");
    expect((finalUpdate?.args[0] as { status: string }).status).toBe("processed");
  });

  it("skips a genuine duplicate (already processed)", async () => {
    tableHandlers.webhook_events = (calls) => {
      if (calls.some((c) => c.method === "insert")) return { data: null, error: { code: "23505" } };
      return { data: { status: "processed" }, error: null };
    };
    const result = await processDelhiveryPush(pushBody(), "req-2");
    expect(result).toMatchObject({ received: true, duplicate: true, handled: true });
    expect(allCalls.some((c) => c.table === "shipment_scans")).toBe(false);
  });

  it("reprocesses a previously-failed delivery", async () => {
    tableHandlers.webhook_events = (calls) => {
      if (calls.some((c) => c.method === "insert")) return { data: null, error: { code: "23505" } };
      return { data: { status: "failed" }, error: null };
    };
    const result = await processDelhiveryPush(pushBody(), "req-3");
    expect(result.duplicate).toBe(false);
    expect(result.handled).toBe(true);
  });
});

describe("processDelhiveryPush malformed/unmodelled payloads", () => {
  it("acknowledges unparsable JSON without touching webhook_events", async () => {
    const result = await processDelhiveryPush("not json", "req-4");
    expect(result).toEqual({ received: true, duplicate: false, handled: false });
    expect(allCalls.some((c) => c.table === "webhook_events")).toBe(false);
  });

  it("acknowledges a schema-unmodelled payload without touching webhook_events", async () => {
    const result = await processDelhiveryPush(JSON.stringify({ nothing: "useful" }), "req-5");
    expect(result).toEqual({ received: true, duplicate: false, handled: false });
    expect(allCalls.some((c) => c.table === "webhook_events")).toBe(false);
  });

  it("acknowledges an unknown waybill as handled:false but still marks the event processed", async () => {
    tableHandlers.shipments = () => ({ data: null, error: null });
    const result = await processDelhiveryPush(pushBody({ awb: "WB-UNKNOWN" }), "req-6");
    expect(result).toMatchObject({ received: true, handled: false });
    const finalUpdate = allCalls.find((c) => c.table === "webhook_events" && c.method === "update");
    expect((finalUpdate?.args[0] as { status: string }).status).toBe("processed");
  });
});

describe("processDelhiveryPush order advancement", () => {
  it("walks pending -> processing -> shipped and sends the order_shipped email once", async () => {
    rpcResults.transition_order_status = { data: { version: 4 }, error: null };
    const result = await processDelhiveryPush(pushBody({ statusType: "UD", status: "In Transit", pickUpDate: "2026-01-05" }), "req-7");
    expect(result.handled).toBe(true);
    const transitions = rpcCalls.filter((c) => c.name === "transition_order_status").map((c) => (c.args as { p_new_status: string }).p_new_status);
    expect(transitions).toEqual(["processing", "shipped"]);
    expect(enqueueEmailMock).toHaveBeenCalledTimes(1);
    expect(enqueueEmailMock).toHaveBeenCalledWith("order_shipped", ORDER_ROW.customer_email, expect.any(Object));
  });

  it("does not advance or email when the scan carries no actionable status", async () => {
    const result = await processDelhiveryPush(pushBody({ statusType: "CN", status: "Cancelled" }), "req-8");
    expect(result.handled).toBe(true);
    expect(rpcCalls.some((c) => c.name === "transition_order_status")).toBe(false);
    expect(enqueueEmailMock).not.toHaveBeenCalled();
  });
});
