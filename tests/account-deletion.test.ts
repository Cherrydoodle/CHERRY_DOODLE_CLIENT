import { beforeEach, describe, expect, it, vi } from "vitest";

// RZ-026 / RZ-000 decision #25: self-service account deletion, with two
// judgment-call safety guards not explicitly in the decision but necessary to
// avoid real harm: blocking the last admin from self-deleting, and blocking
// deletion while an order is still being fulfilled.

type TableResult = { data: unknown; error: unknown; count?: number };
const tableResults: Record<string, TableResult> = {};
const calls: Array<{ table: string; method: string; args: unknown[] }> = [];
const deleteUserMock = vi.fn();

function createQueryBuilder(table: string): Record<string, unknown> {
  const builder: Record<string, unknown> = {};
  for (const method of ["select", "eq", "is", "not", "insert"]) {
    builder[method] = (...args: unknown[]) => {
      calls.push({ table, method, args });
      return builder;
    };
  }
  builder.then = (onFulfilled?: (v: TableResult) => unknown, onRejected?: (r: unknown) => unknown) =>
    Promise.resolve(tableResults[table] ?? { data: null, error: null }).then(onFulfilled, onRejected);
  return builder;
}

const requireUserMock = vi.fn();
vi.mock("@/lib/auth/authorization", () => ({ requireUser: () => requireUserMock() }));
vi.mock("@/lib/supabase/admin", () => ({
  createAdminSupabaseClient: () => ({
    from: (table: string) => createQueryBuilder(table),
    auth: { admin: { deleteUser: (...args: unknown[]) => deleteUserMock(...args) } },
  }),
}));

const { deleteMyAccount } = await import("@/features/auth/service");

beforeEach(() => {
  calls.length = 0;
  for (const key of Object.keys(tableResults)) delete tableResults[key];
  requireUserMock.mockReset();
  deleteUserMock.mockReset();
  tableResults.orders = { data: null, error: null, count: 0 };
  tableResults.audit_logs = { data: null, error: null };
  deleteUserMock.mockResolvedValue({ error: null });
});

describe("deleteMyAccount", () => {
  it("deletes a customer account with no active orders", async () => {
    requireUserMock.mockResolvedValue({ userId: "user-a", role: "customer" });
    const result = await deleteMyAccount();
    expect(result).toEqual({ deleted: true });
    expect(deleteUserMock).toHaveBeenCalledWith("user-a");
  });

  it("blocks deletion when the customer has a non-terminal order", async () => {
    requireUserMock.mockResolvedValue({ userId: "user-a", role: "customer" });
    tableResults.orders = { data: null, error: null, count: 1 };
    await expect(deleteMyAccount()).rejects.toMatchObject({ status: 409, code: "ACCOUNT_HAS_ACTIVE_ORDERS" });
    expect(deleteUserMock).not.toHaveBeenCalled();
  });

  it("scopes the active-orders check to the caller's own orders only", async () => {
    requireUserMock.mockResolvedValue({ userId: "user-b", role: "customer" });
    await deleteMyAccount();
    const ownershipFilter = calls.find((c) => c.table === "orders" && c.method === "eq" && c.args[0] === "customer_user_id");
    expect(ownershipFilter?.args).toEqual(["customer_user_id", "user-b"]);
  });

  it("blocks the last remaining admin from deleting their own account", async () => {
    requireUserMock.mockResolvedValue({ userId: "admin-1", role: "admin" });
    tableResults.user_roles = { data: null, error: null, count: 1 };
    await expect(deleteMyAccount()).rejects.toMatchObject({ status: 409, code: "LAST_ADMIN" });
    expect(deleteUserMock).not.toHaveBeenCalled();
  });

  it("allows an admin to delete their account when other admins remain", async () => {
    requireUserMock.mockResolvedValue({ userId: "admin-1", role: "admin" });
    tableResults.user_roles = { data: null, error: null, count: 2 };
    const result = await deleteMyAccount();
    expect(result).toEqual({ deleted: true });
  });

  it("aborts without deleting anything if the pre-deletion audit write fails", async () => {
    requireUserMock.mockResolvedValue({ userId: "user-a", role: "customer" });
    tableResults.audit_logs = { data: null, error: { code: "23503" } };
    await expect(deleteMyAccount()).rejects.toMatchObject({ status: 503 });
    expect(deleteUserMock).not.toHaveBeenCalled();
  });

  it("surfaces a clear error if the underlying Supabase deletion fails", async () => {
    requireUserMock.mockResolvedValue({ userId: "user-a", role: "customer" });
    deleteUserMock.mockResolvedValue({ error: { message: "boom" } });
    await expect(deleteMyAccount()).rejects.toMatchObject({ status: 503 });
  });
});
