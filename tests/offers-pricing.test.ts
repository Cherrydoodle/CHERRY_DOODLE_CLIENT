import { beforeEach, describe, expect, it, vi } from "vitest";

// Mirrors the mock pattern in tests/admin-reconciliation.test.ts: a per-table
// query-builder mock keyed off the full call chain, since resolveOfferPrices reads
// straight from the active_product_offers view rather than issuing raw SQL.
type TableResult = { data: unknown; error: unknown };
type TableHandler = () => TableResult;

const tableHandlers: Partial<Record<string, TableHandler>> = {};

function createQueryBuilder(table: string): Record<string, unknown> {
  const builder: Record<string, unknown> = {};
  for (const method of ["select", "in"]) {
    builder[method] = () => builder;
  }
  const resolve = (): TableResult => (tableHandlers[table]?.() ?? { data: null, error: null });
  builder.then = (onFulfilled?: (v: TableResult) => unknown, onRejected?: (r: unknown) => unknown) =>
    Promise.resolve(resolve()).then(onFulfilled, onRejected);
  return builder;
}

vi.mock("@/lib/supabase/admin", () => ({
  createAdminSupabaseClient: () => ({ from: (table: string) => createQueryBuilder(table) }),
}));

const { computeOfferPriceCents, resolveOfferPrices } = await import("@/features/offers/pricing");

beforeEach(() => {
  for (const key of Object.keys(tableHandlers)) delete tableHandlers[key];
});

// public.offer_price_for (supabase/migrations/202607250002_offer_pricing.sql) is
// the sole source of truth for what a customer is charged; computeOfferPriceCents
// is a display-only preview that must produce numerically identical results, since
// it is what the catalog/cart/checkout preview and the admin form both render
// before (or instead of) hitting the database. These cases were cross-checked
// against the live SQL function via psql during implementation:
//   offer_price_for(100000, 30, null)   = 70000
//   offer_price_for(100000, null, 55000) = 55000
//   offer_price_for(100000, null, 150000) = 100000  (never raises)
//   offer_price_for(1, 99, null)        = 1          (floor stays >= 1)
describe("computeOfferPriceCents (offer_price_for parity)", () => {
  it("applies a percentage discount off the current price, flooring in the customer's favour", () => {
    expect(computeOfferPriceCents(100000, "percentage", 30, null)).toBe(70000);
    expect(computeOfferPriceCents(33300, "percentage", 30, null)).toBe(23310);
  });

  it("uses the fixed price directly in fixed mode", () => {
    expect(computeOfferPriceCents(100000, "fixed", null, 55000)).toBe(55000);
  });

  it("never raises the price: a fixed price above the current price clamps down to the current price", () => {
    expect(computeOfferPriceCents(100000, "fixed", null, 150000)).toBe(100000);
  });

  it("never raises the price: a negative-implying discount cannot occur, but a 0% discount is a no-op", () => {
    expect(computeOfferPriceCents(100000, "percentage", 0, null)).toBe(100000);
  });

  it("floors the result to a minimum of 1 cent even at a 99% discount on a 1-cent item", () => {
    expect(computeOfferPriceCents(1, "percentage", 99, null)).toBe(1);
  });

  it("floors a deep discount to a minimum of 1 cent rather than 0", () => {
    expect(computeOfferPriceCents(100, "percentage", 100, null)).toBe(1);
  });
});

describe("resolveOfferPrices", () => {
  it("returns an empty map without querying when given no product ids", async () => {
    tableHandlers.active_product_offers = () => { throw new Error("should not be called"); };
    const result = await resolveOfferPrices([]);
    expect(result.size).toBe(0);
  });

  it("maps each active_product_offers row onto its product id, coercing the numeric discount column", async () => {
    tableHandlers.active_product_offers = () => ({
      data: [
        { product_id: "p1", offer_id: "o1", offer_name: "Sale A", offer_slug: "sale-a", offer_discount_percent: "30.00", offer_price_cents: 7000, offer_ends_at: "2026-08-01T00:00:00Z" },
        { product_id: "p2", offer_id: "o2", offer_name: "Sale B", offer_slug: "sale-b", offer_discount_percent: null, offer_price_cents: 5000, offer_ends_at: null },
      ],
      error: null,
    });
    const result = await resolveOfferPrices(["p1", "p2", "p3"]);
    expect(result.size).toBe(2);
    expect(result.get("p1")).toEqual({ offerId: "o1", offerName: "Sale A", offerSlug: "sale-a", discountPercent: 30, offerPriceCents: 7000, endsAt: "2026-08-01T00:00:00Z" });
    expect(result.get("p2")?.discountPercent).toBeNull();
    expect(result.has("p3")).toBe(false);
  });

  it("returns an empty map (never throws) when the query errors", async () => {
    tableHandlers.active_product_offers = () => ({ data: null, error: { code: "500" } });
    const result = await resolveOfferPrices(["p1"]);
    expect(result.size).toBe(0);
  });
});
