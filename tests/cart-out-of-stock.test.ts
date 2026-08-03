import { beforeEach, describe, expect, it, vi } from "vitest";

// Mirrors the query-builder mock pattern in tests/cart-summary.test.ts, plus an rpc
// mock since addCartItem's OUT_OF_STOCK path is entirely rpc-driven (cart_add_item_atomic,
// then log_out_of_stock_attempt).
type TableResult = { data: unknown; error: unknown };
const tableHandlers: Partial<Record<string, () => TableResult>> = {};
const rpcHandlers: Partial<Record<string, () => TableResult>> = {};
const rpcCalls: Array<{ fn: string; args: unknown }> = [];

function createQueryBuilder(table: string): Record<string, unknown> {
  const builder: Record<string, unknown> = {};
  for (const method of ["select", "eq", "is", "order", "maybeSingle", "single"]) builder[method] = () => builder;
  const resolve = (): TableResult => (tableHandlers[table]?.() ?? { data: null, error: null });
  builder.then = (onFulfilled?: (v: TableResult) => unknown, onRejected?: (r: unknown) => unknown) =>
    Promise.resolve(resolve()).then(onFulfilled, onRejected);
  return builder;
}

vi.mock("@/lib/supabase/admin", () => ({
  createAdminSupabaseClient: () => ({
    from: (table: string) => createQueryBuilder(table),
    rpc: async (fn: string, args: unknown) => {
      rpcCalls.push({ fn, args });
      return rpcHandlers[fn]?.() ?? { data: null, error: null };
    },
  }),
}));

vi.mock("@/lib/auth/authorization", () => ({
  optionalAuth: async () => ({ userId: "user-1", role: "customer" }),
  requireUser: async () => ({ userId: "user-1", role: "customer" }),
}));

const { addCartItem } = await import("@/features/cart/service");

const cartRow = { id: "cart-1", user_id: "user-1", guest_token_hash: null, updated_at: "2026-01-01T00:00:00.000Z" };

beforeEach(() => {
  for (const key of Object.keys(tableHandlers)) delete tableHandlers[key];
  for (const key of Object.keys(rpcHandlers)) delete rpcHandlers[key];
  rpcCalls.length = 0;
  // resolveCart(true) finds this cart on the first lookup and returns immediately,
  // so the insert branch is never exercised here.
  tableHandlers.carts = () => ({ data: cartRow, error: null });
});

describe("addCartItem OUT_OF_STOCK handling (features/cart/service.ts)", () => {
  it("maps a sold-out rpc failure to 409 OUT_OF_STOCK and logs the attempt", async () => {
    rpcHandlers.cart_add_item_atomic = () => ({ data: null, error: { message: "OUT_OF_STOCK" } });
    rpcHandlers.log_out_of_stock_attempt = () => ({ data: null, error: null });

    await expect(addCartItem("variant-1", 2)).rejects.toMatchObject({ status: 409, code: "OUT_OF_STOCK" });

    const logCall = rpcCalls.find((call) => call.fn === "log_out_of_stock_attempt");
    expect(logCall).toBeDefined();
    expect(logCall?.args).toMatchObject({ p_variant_id: "variant-1", p_quantity: 2, p_actor_id: "user-1" });
  });

  it("still returns 409 when the attempt-logging rpc itself resolves with an error", async () => {
    rpcHandlers.cart_add_item_atomic = () => ({ data: null, error: { message: "OUT_OF_STOCK" } });
    rpcHandlers.log_out_of_stock_attempt = () => ({ data: null, error: { message: "insert failed" } });

    await expect(addCartItem("variant-1", 1)).rejects.toMatchObject({ status: 409, code: "OUT_OF_STOCK" });
  });

  it("still returns 409 when the attempt-logging rpc rejects outright", async () => {
    rpcHandlers.cart_add_item_atomic = () => ({ data: null, error: { message: "OUT_OF_STOCK" } });
    rpcHandlers.log_out_of_stock_attempt = () => {
      throw new Error("network error");
    };

    await expect(addCartItem("variant-1", 1)).rejects.toMatchObject({ status: 409, code: "OUT_OF_STOCK" });
  });

  it("maps VARIANT_UNAVAILABLE distinctly (unpublished/inactive/deleted) and never logs an attempt", async () => {
    rpcHandlers.cart_add_item_atomic = () => ({ data: null, error: { message: "VARIANT_UNAVAILABLE" } });

    await expect(addCartItem("variant-1", 1)).rejects.toMatchObject({ status: 422, code: "VARIANT_UNAVAILABLE" });
    expect(rpcCalls.some((call) => call.fn === "log_out_of_stock_attempt")).toBe(false);
  });
});
