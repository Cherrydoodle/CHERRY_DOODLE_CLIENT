import { beforeEach, describe, expect, it, vi } from "vitest";

import { addressSchema, addressUpdateSchema } from "@/features/addresses/schemas";

// RZ-080: saved-address selection at checkout. Ownership is enforced the same way
// as the rest of this codebase's user-scoped reads/writes -- see the IDOR
// rationale in tests/customer-orders.test.ts.

type TableCall = { method: string; args: unknown[] };
type TableResult = { data: unknown; error: unknown };

const tableResults: Record<string, TableResult> = {};
const calls: Array<{ table: string; method: string; args: unknown[] }> = [];

function createQueryBuilder(table: string): Record<string, unknown> {
  const builder: Record<string, unknown> = {};
  const callLog: TableCall[] = [];
  for (const method of ["select", "eq", "neq", "is", "order", "update", "insert", "single", "maybeSingle"]) {
    builder[method] = (...args: unknown[]) => {
      const call = { method, args };
      callLog.push(call);
      calls.push({ table, ...call });
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
  createAdminSupabaseClient: () => ({ from: (table: string) => createQueryBuilder(table) }),
}));

const { listMyAddresses, createMyAddress, updateMyAddress, deleteMyAddress } = await import("@/features/addresses/service");

beforeEach(() => {
  calls.length = 0;
  for (const key of Object.keys(tableResults)) delete tableResults[key];
  requireUserMock.mockReset();
});

describe("addressSchema", () => {
  it("defaults label to 'Shipping' and countryCode to 'IN'", () => {
    const parsed = addressSchema.parse({
      recipientName: "Asha Kumar", phoneNumber: "+91 98765 43210",
      line1: "14 Blossom Road", city: "Bengaluru", state: "Karnataka", postalCode: "560001",
    });
    expect(parsed.label).toBe("Shipping");
    expect(parsed.countryCode).toBe("IN");
    expect(parsed.isDefault).toBe(false);
  });

  it("rejects an address missing required fields", () => {
    expect(addressSchema.safeParse({ recipientName: "Asha" }).success).toBe(false);
  });

  it("rejects unknown fields (strict)", () => {
    expect(addressSchema.safeParse({
      recipientName: "Asha Kumar", phoneNumber: "+91 98765 43210",
      line1: "14 Blossom Road", city: "Bengaluru", state: "Karnataka", postalCode: "560001",
      extra: "nope",
    }).success).toBe(false);
  });
});

describe("listMyAddresses (ownership)", () => {
  it("scopes the query to the authenticated caller's user id", async () => {
    requireUserMock.mockResolvedValue({ userId: "user-a", role: "customer" });
    tableResults.customer_addresses = { data: [], error: null };
    await listMyAddresses();
    const ownershipFilter = calls.find((c) => c.table === "customer_addresses" && c.method === "eq" && c.args[0] === "user_id");
    expect(ownershipFilter?.args).toEqual(["user_id", "user-a"]);
  });

  it("maps rows to the address DTO shape", async () => {
    requireUserMock.mockResolvedValue({ userId: "user-a", role: "customer" });
    tableResults.customer_addresses = {
      data: [{ id: "addr-1", label: "Home", recipient_name: "Asha Kumar", phone_number: "+91 98765 43210", line1: "14 Blossom Road", line2: null, city: "Bengaluru", state: "Karnataka", postal_code: "560001", country_code: "IN", is_default: true, version: 1 }],
      error: null,
    };
    const addresses = await listMyAddresses();
    expect(addresses).toEqual([{
      id: "addr-1", label: "Home", recipientName: "Asha Kumar", phoneNumber: "+91 98765 43210",
      line1: "14 Blossom Road", line2: null, city: "Bengaluru", state: "Karnataka", postalCode: "560001", countryCode: "IN", isDefault: true, version: 1,
    }]);
  });
});

describe("addressUpdateSchema", () => {
  it("accepts a partial patch without applying addressSchema's defaults", () => {
    const parsed = addressUpdateSchema.parse({ line1: "New line", expectedVersion: 2 });
    expect(parsed).toEqual({ line1: "New line", expectedVersion: 2 });
    expect(parsed).not.toHaveProperty("label");
    expect(parsed).not.toHaveProperty("countryCode");
  });

  it("requires expectedVersion", () => {
    expect(addressUpdateSchema.safeParse({ line1: "New line" }).success).toBe(false);
  });

  it("rejects unknown fields (strict)", () => {
    expect(addressUpdateSchema.safeParse({ line1: "New line", expectedVersion: 1, extra: "nope" }).success).toBe(false);
  });
});

describe("updateMyAddress (ownership + concurrency)", () => {
  it("scopes the update to the authenticated caller and the expected version", async () => {
    requireUserMock.mockResolvedValue({ userId: "user-a", role: "customer" });
    tableResults.customer_addresses = {
      data: { id: "addr-1", label: "Home", recipient_name: "Asha Kumar", phone_number: "+91 98765 43210", line1: "New line", line2: null, city: "Bengaluru", state: "Karnataka", postal_code: "560001", country_code: "IN", is_default: false, version: 2 },
      error: null,
    };
    const updated = await updateMyAddress("addr-1", addressUpdateSchema.parse({ line1: "New line", expectedVersion: 1 }));
    expect(updated.line1).toBe("New line");
    const ownershipFilter = calls.find((c) => c.table === "customer_addresses" && c.method === "eq" && c.args[0] === "user_id");
    const versionFilter = calls.find((c) => c.table === "customer_addresses" && c.method === "eq" && c.args[0] === "version");
    expect(ownershipFilter?.args).toEqual(["user_id", "user-a"]);
    expect(versionFilter?.args).toEqual(["version", 1]);
  });

  it("throws a version conflict when no row matches", async () => {
    requireUserMock.mockResolvedValue({ userId: "user-a", role: "customer" });
    tableResults.customer_addresses = { data: null, error: null };
    await expect(updateMyAddress("addr-1", addressUpdateSchema.parse({ line1: "New line", expectedVersion: 1 }))).rejects.toThrow(/changed elsewhere/);
  });
});

describe("deleteMyAddress (ownership + concurrency)", () => {
  it("scopes the soft-delete to the authenticated caller and the expected version", async () => {
    requireUserMock.mockResolvedValue({ userId: "user-a", role: "customer" });
    tableResults.customer_addresses = { data: { id: "addr-1" }, error: null };
    await deleteMyAddress("addr-1", 3);
    const ownershipFilter = calls.find((c) => c.table === "customer_addresses" && c.method === "eq" && c.args[0] === "user_id");
    const versionFilter = calls.find((c) => c.table === "customer_addresses" && c.method === "eq" && c.args[0] === "version");
    expect(ownershipFilter?.args).toEqual(["user_id", "user-a"]);
    expect(versionFilter?.args).toEqual(["version", 3]);
  });

  it("throws a version conflict when no row matches", async () => {
    requireUserMock.mockResolvedValue({ userId: "user-a", role: "customer" });
    tableResults.customer_addresses = { data: null, error: null };
    await expect(deleteMyAddress("addr-1", 3)).rejects.toThrow(/changed elsewhere/);
  });
});

describe("createMyAddress (ownership + default handling)", () => {
  it("saves the address under the authenticated caller's user id", async () => {
    requireUserMock.mockResolvedValue({ userId: "user-b", role: "customer" });
    tableResults.customer_addresses = {
      data: { id: "addr-2", label: "Shipping", recipient_name: "Asha Kumar", phone_number: "+91 98765 43210", line1: "1 Road", line2: null, city: "Bengaluru", state: "Karnataka", postal_code: "560001", country_code: "IN", is_default: false },
      error: null,
    };
    const input = addressSchema.parse({
      recipientName: "Asha Kumar", phoneNumber: "+91 98765 43210",
      line1: "1 Road", city: "Bengaluru", state: "Karnataka", postalCode: "560001",
    });
    await createMyAddress(input);
    const insertCall = calls.find((c) => c.table === "customer_addresses" && c.method === "insert");
    expect((insertCall?.args[0] as { user_id: string }).user_id).toBe("user-b");
  });

  it("clears the previous default before inserting a new default address", async () => {
    requireUserMock.mockResolvedValue({ userId: "user-b", role: "customer" });
    tableResults.customer_addresses = {
      data: { id: "addr-3", label: "Shipping", recipient_name: "Asha Kumar", phone_number: "+91 98765 43210", line1: "1 Road", line2: null, city: "Bengaluru", state: "Karnataka", postal_code: "560001", country_code: "IN", is_default: true },
      error: null,
    };
    const input = addressSchema.parse({
      recipientName: "Asha Kumar", phoneNumber: "+91 98765 43210",
      line1: "1 Road", city: "Bengaluru", state: "Karnataka", postalCode: "560001", isDefault: true,
    });
    await createMyAddress(input);
    const clearDefaultCall = calls.find((c) => c.table === "customer_addresses" && c.method === "update" && (c.args[0] as { is_default: boolean }).is_default === false);
    expect(clearDefaultCall).toBeDefined();
  });
});
