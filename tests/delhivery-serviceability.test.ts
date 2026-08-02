import { beforeEach, describe, expect, it, vi } from "vitest";

type TableCall = { method: string; args: unknown[] };
type TableResult = { data: unknown; error: unknown };
type TableHandler = (calls: TableCall[]) => TableResult;

const tableHandlers: Partial<Record<string, TableHandler>> = {};
const allCalls: Array<{ table: string; method: string; args: unknown[] }> = [];

function createQueryBuilder(table: string): Record<string, unknown> {
  const builder: Record<string, unknown> = {};
  const callLog: TableCall[] = [];
  for (const method of ["select", "eq", "upsert"]) {
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

const checkPincodeMock = vi.fn();
vi.mock("@/features/delhivery/client", () => ({
  checkPincode: (...args: unknown[]) => checkPincodeMock(...args),
  fetchWaybills: vi.fn(), createManifest: vi.fn(), trackWaybills: vi.fn(), fetchPackingSlip: vi.fn(), createPickupRequest: vi.fn(),
}));

const { getServiceability, assertPincodeServiceableForCheckout } = await import("@/features/delhivery/service");

beforeEach(() => {
  allCalls.length = 0;
  for (const key of Object.keys(tableHandlers)) delete tableHandlers[key];
  checkPincodeMock.mockReset();
  tableHandlers.pincode_serviceability = () => ({ data: null, error: null });
});

describe("getServiceability", () => {
  it("calls Delhivery and caches a serviceable result on a cold cache", async () => {
    checkPincodeMock.mockResolvedValue({ delivery_codes: [{ postal_code: { pin: "110001", pre_paid: "Y", cod: "N", city: "Delhi", state_code: "DL" } }] });
    const result = await getServiceability("110001");
    expect(result).toMatchObject({ serviceable: true, prepaid: true, cod: false, city: "Delhi", state: "DL" });
    const upsert = allCalls.find((c) => c.table === "pincode_serviceability" && c.method === "upsert");
    expect(upsert).toBeDefined();
    expect((upsert!.args[0] as { is_serviceable: boolean }).is_serviceable).toBe(true);
  });

  it("treats an empty delivery_codes response as not serviceable", async () => {
    checkPincodeMock.mockResolvedValue({ delivery_codes: [] });
    const result = await getServiceability("999999");
    expect(result).toMatchObject({ serviceable: false });
  });

  it("returns the fresh cached row without calling Delhivery again", async () => {
    tableHandlers.pincode_serviceability = () => ({
      data: { postal_code: "110001", is_serviceable: true, prepaid: true, cod: false, city: "Delhi", state_code: "DL", checked_at: new Date().toISOString() },
      error: null,
    });
    const result = await getServiceability("110001");
    expect(result).toMatchObject({ serviceable: true });
    expect(checkPincodeMock).not.toHaveBeenCalled();
  });

  it("falls back to a stale cache when Delhivery is unreachable", async () => {
    const staleDate = new Date(Date.now() - 10 * 24 * 60 * 60_000).toISOString(); // 10 days old
    tableHandlers.pincode_serviceability = () => ({
      data: { postal_code: "110001", is_serviceable: true, prepaid: true, cod: false, city: "Delhi", state_code: "DL", checked_at: staleDate },
      error: null,
    });
    checkPincodeMock.mockRejectedValue(new Error("network down"));
    const result = await getServiceability("110001");
    expect(result).toMatchObject({ serviceable: true });
  });

  it("returns null when Delhivery is unreachable and there is no cache at all", async () => {
    checkPincodeMock.mockRejectedValue(new Error("network down"));
    const result = await getServiceability("110001");
    expect(result).toBeNull();
  });
});

describe("assertPincodeServiceableForCheckout", () => {
  it("allows non-Indian addresses through unchecked", async () => {
    await expect(assertPincodeServiceableForCheckout({ postalCode: "90210", country: "US" })).resolves.toBeUndefined();
    expect(checkPincodeMock).not.toHaveBeenCalled();
  });

  it("throws 422 for a confirmed non-serviceable Indian pincode", async () => {
    checkPincodeMock.mockResolvedValue({ delivery_codes: [] });
    await expect(assertPincodeServiceableForCheckout({ postalCode: "999999", country: "IN" })).rejects.toMatchObject({ status: 422, code: "PINCODE_NOT_SERVICEABLE" });
  });

  it("fails OPEN (does not throw) when Delhivery is unreachable and there is no cache", async () => {
    checkPincodeMock.mockRejectedValue(new Error("network down"));
    await expect(assertPincodeServiceableForCheckout({ postalCode: "110001", country: "IN" })).resolves.toBeUndefined();
  });

  it("rejects a malformed pincode before ever calling Delhivery", async () => {
    await expect(assertPincodeServiceableForCheckout({ postalCode: "abc", country: "IN" })).rejects.toMatchObject({ status: 422, code: "INVALID_PINCODE" });
    expect(checkPincodeMock).not.toHaveBeenCalled();
  });
});
