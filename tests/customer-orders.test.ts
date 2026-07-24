import { beforeEach, describe, expect, it, vi } from "vitest";

// This suite exercises the exact mechanism that prevents one customer from reading
// another customer's order (H10/M37 in the readiness audit flagged the absence of
// any IDOR test in this codebase). Supabase is mocked because there is no existing
// DB-integration test harness here; the assertion that matters is that every query
// is scoped with `.eq("customer_user_id", <the authenticated caller's id>)` — that
// filter is what turns "give me order X" into "give me order X if it is mine".

type QueryResult = { data: unknown; error: unknown; count?: number };
type RecordedCall = { method: string; args: unknown[] };

let nextResult: QueryResult = { data: null, error: null };
const calls: RecordedCall[] = [];

function createQueryBuilder(): Record<string, unknown> {
  const builder: Record<string, unknown> = {};
  for (const method of ["select", "eq", "is", "order", "range"]) {
    builder[method] = (...args: unknown[]) => {
      calls.push({ method, args });
      return builder;
    };
  }
  builder.maybeSingle = () => {
    calls.push({ method: "maybeSingle", args: [] });
    return Promise.resolve(nextResult);
  };
  // Mirrors postgrest-js: the builder itself is awaitable once a terminal filter
  // (like .range()) has been applied, without a separate execute() call.
  builder.then = (onFulfilled?: (value: QueryResult) => unknown, onRejected?: (reason: unknown) => unknown) =>
    Promise.resolve(nextResult).then(onFulfilled, onRejected);
  return builder;
}

const requireUserMock = vi.fn();

vi.mock("@/lib/auth/authorization", () => ({ requireUser: () => requireUserMock() }));
vi.mock("@/lib/supabase/admin", () => ({
  createAdminSupabaseClient: () => ({ from: () => createQueryBuilder() }),
}));

const { getMyOrder, listMyOrders } = await import("@/features/customer-orders/service");
const { mapOrderDetailRow } = await import("@/features/customer-orders/dto");

beforeEach(() => {
  calls.length = 0;
  nextResult = { data: null, error: null };
  requireUserMock.mockReset();
});

function ownershipFilterArgs() {
  return calls.find((call) => call.method === "eq" && call.args[0] === "customer_user_id")?.args;
}

describe("getMyOrder ownership enforcement (IDOR)", () => {
  it("scopes the lookup by the authenticated caller's user id", async () => {
    requireUserMock.mockResolvedValue({ userId: "user-a", role: "customer" });
    nextResult = { data: null, error: null }; // simulates: row exists but belongs to another customer
    await expect(getMyOrder("11111111-1111-4111-8111-111111111111")).rejects.toMatchObject({ status: 404 });
    expect(ownershipFilterArgs()).toEqual(["customer_user_id", "user-a"]);
  });

  it("scopes by the CURRENT caller even when a different id was previously cached", async () => {
    requireUserMock.mockResolvedValue({ userId: "user-b", role: "customer" });
    nextResult = { data: null, error: null };
    await expect(getMyOrder("22222222-2222-4222-8222-222222222222")).rejects.toMatchObject({ status: 404 });
    expect(ownershipFilterArgs()).toEqual(["customer_user_id", "user-b"]);
  });

  it("never distinguishes 'order exists but is not yours' from 'order does not exist'", async () => {
    requireUserMock.mockResolvedValue({ userId: "user-a", role: "customer" });
    nextResult = { data: null, error: null };
    await expect(getMyOrder("33333333-3333-4333-8333-333333333333")).rejects.toMatchObject({
      status: 404,
      code: "NOT_FOUND",
    });
  });

  it("returns the mapped order when the row belongs to the caller", async () => {
    requireUserMock.mockResolvedValue({ userId: "user-a", role: "customer" });
    nextResult = {
      data: {
        id: "order-1",
        order_number: "CD-000001",
        status: "processing",
        payment_status: "paid",
        paid_at: "2026-01-01T00:00:00Z",
        placed_at: "2026-01-01T00:00:00Z",
        total_minor: 5000,
        currency: "INR",
        subtotal_minor: 4500,
        discount_minor: 0,
        shipping_minor: 500,
        tax_minor: 0,
        shipping_address: { line1: "1 Blossom Road" },
        customer_note: null,
        order_items: [],
        order_status_history: [],
      },
      error: null,
    };
    const order = await getMyOrder("order-1");
    expect(order.orderNumber).toBe("CD-000001");
    expect(order.totalMinor).toBe(5000);
  });
});

describe("listMyOrders", () => {
  it("scopes the list query by the authenticated caller's user id", async () => {
    requireUserMock.mockResolvedValue({ userId: "user-c", role: "customer" });
    nextResult = { data: [], error: null, count: 0 };
    await listMyOrders(1, 20);
    expect(ownershipFilterArgs()).toEqual(["customer_user_id", "user-c"]);
  });

  it("maps rows and total count", async () => {
    requireUserMock.mockResolvedValue({ userId: "user-c", role: "customer" });
    nextResult = {
      data: [
        { id: "o1", order_number: "CD-000001", status: "pending", payment_status: "paid", paid_at: null, placed_at: "2026-01-01T00:00:00Z", total_minor: 1000, currency: "INR" },
      ],
      error: null,
      count: 1,
    };
    const result = await listMyOrders(1, 20);
    expect(result.total).toBe(1);
    expect(result.items).toHaveLength(1);
    expect(result.items[0]!.orderNumber).toBe("CD-000001");
  });
});

describe("mapOrderDetailRow", () => {
  it("maps items, shipping address, and a chronologically sorted status history", () => {
    const dto = mapOrderDetailRow({
      id: "order-1",
      order_number: "CD-000002",
      status: "shipped",
      payment_status: "paid",
      paid_at: "2026-01-01T00:00:00Z",
      placed_at: "2026-01-01T00:00:00Z",
      total_minor: 2500,
      currency: "INR",
      subtotal_minor: 2000,
      discount_minor: 0,
      shipping_minor: 500,
      tax_minor: 0,
      shipping_address: { line1: "1 Blossom Road", city: "Bengaluru" },
      customer_note: "Please gift wrap",
      order_items: [
        { id: "item-1", product_name: "Cherry Bunny Gel Pen Set", sku: "CBGP-1", quantity: 2, unit_price_minor: 900, line_total_minor: 1800 },
      ],
      order_status_history: [
        { id: "h2", to_status: "shipped", created_at: "2026-01-02T00:00:00Z" },
        { id: "h1", to_status: "processing", created_at: "2026-01-01T00:00:00Z" },
      ],
    });

    expect(dto.orderNumber).toBe("CD-000002");
    expect(dto.items).toEqual([
      { id: "item-1", name: "Cherry Bunny Gel Pen Set", sku: "CBGP-1", quantity: 2, unitPriceMinor: 900, lineTotalMinor: 1800 },
    ]);
    expect(dto.shippingAddress).toEqual({ line1: "1 Blossom Road", city: "Bengaluru" });
    expect(dto.customerNote).toBe("Please gift wrap");
    // Out-of-order rows are sorted chronologically, oldest first.
    expect(dto.statusHistory.map((event) => event.toStatus)).toEqual(["processing", "shipped"]);
  });
});
