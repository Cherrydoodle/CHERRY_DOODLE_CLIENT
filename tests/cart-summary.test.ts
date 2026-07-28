import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// Mirrors the query-builder mock pattern in tests/checkout.test.ts / tests/offers-pricing.test.ts.
type TableResult = { data: unknown; error: unknown };
type TableHandler = () => TableResult;
const tableHandlers: Partial<Record<string, TableHandler>> = {};

function createQueryBuilder(table: string): Record<string, unknown> {
  const builder: Record<string, unknown> = {};
  for (const method of ["select", "in", "eq", "is", "order"]) builder[method] = () => builder;
  const resolve = (): TableResult => (tableHandlers[table]?.() ?? { data: null, error: null });
  builder.then = (onFulfilled?: (v: TableResult) => unknown, onRejected?: (r: unknown) => unknown) =>
    Promise.resolve(resolve()).then(onFulfilled, onRejected);
  return builder;
}

vi.mock("@/lib/supabase/admin", () => ({
  createAdminSupabaseClient: () => ({ from: (table: string) => createQueryBuilder(table) }),
}));
vi.mock("@/features/offers/pricing", () => ({ resolveOfferPrices: async () => new Map() }));

const { getCartById } = await import("@/features/cart/service");
const { resolveCheckoutLines } = await import("@/features/checkout/service");

const originalEnv = { ...process.env };
const THRESHOLD = 299_900;
const FLAT = 4_900;

beforeEach(() => {
  process.env = {
    ...originalEnv,
    CHECKOUT_FREE_SHIPPING_THRESHOLD_MINOR: String(THRESHOLD),
    CHECKOUT_FLAT_SHIPPING_MINOR: String(FLAT),
  } as NodeJS.ProcessEnv;
  for (const key of Object.keys(tableHandlers)) delete tableHandlers[key];
});

afterEach(() => {
  process.env = { ...originalEnv };
});

const cartRecord = { id: "cart-1", user_id: "user-1", guest_token_hash: null, updated_at: "2026-01-01T00:00:00.000Z" };

function cartVariantFixture(basePriceCents: number) {
  return {
    id: "variant-1", sku: "SKU-1", label: "Cherry", stock_quantity: 20, low_stock_threshold: 3,
    is_active: true, deleted_at: null,
    colors: { id: "color-1", name: "Cherry", slug: "cherry", hex_code: "#e85b81" },
    products: {
      id: "product-1", slug: "cherry-gel-pen", name: "Cherry Gel Pen", label: "Stationery",
      base_price_cents: basePriceCents, sale_price_cents: null, currency: "INR",
      status: "published", deleted_at: null, aggregate_rating: "4.5", review_count: 12,
      product_badges: [], product_media: [],
    },
  };
}

describe("cart shipping (features/cart/service.ts#getCartById)", () => {
  it("charges the flat rate when merchandise is below the free-shipping threshold", async () => {
    tableHandlers.cart_items = () => ({ data: [{ id: "item-1", quantity: 1, product_variant_id: "variant-1" }], error: null });
    tableHandlers.product_variants = () => ({ data: [cartVariantFixture(100_000)], error: null });

    const cart = await getCartById(cartRecord, "user");

    expect(cart.summary.subtotalCents).toBe(100_000);
    expect(cart.summary.shippingCents).toBe(FLAT);
    expect(cart.summary.freeShippingThresholdCents).toBe(THRESHOLD);
    expect(cart.summary.freeShippingRemainingCents).toBe(THRESHOLD - 100_000);
    expect(cart.summary.totalCents).toBe(100_000 + FLAT);
  });

  it("waives shipping once merchandise meets the free-shipping threshold", async () => {
    tableHandlers.cart_items = () => ({ data: [{ id: "item-1", quantity: 1, product_variant_id: "variant-1" }], error: null });
    tableHandlers.product_variants = () => ({ data: [cartVariantFixture(350_000)], error: null });

    const cart = await getCartById(cartRecord, "user");

    expect(cart.summary.shippingCents).toBe(0);
    expect(cart.summary.freeShippingRemainingCents).toBe(0);
    expect(cart.summary.totalCents).toBe(cart.summary.subtotalCents);
  });

  it("charges no shipping on an empty cart", async () => {
    tableHandlers.cart_items = () => ({ data: [], error: null });

    const cart = await getCartById(cartRecord, "user");

    expect(cart.items).toHaveLength(0);
    expect(cart.summary.shippingCents).toBe(0);
    expect(cart.summary.totalCents).toBe(0);
  });

  // The whole point of filling in shippingCents is that /cart quotes the exact
  // delivery fee checkout will charge -- a shopper should never see one number on
  // the cart page and a different one once a Razorpay session is created.
  it("matches the shipping charge resolveCheckoutLines computes for the same merchandise total", async () => {
    tableHandlers.cart_items = () => ({ data: [{ id: "item-1", quantity: 1, product_variant_id: "variant-1" }], error: null });
    tableHandlers.product_variants = () => ({ data: [cartVariantFixture(100_000)], error: null });
    const cart = await getCartById(cartRecord, "user");

    tableHandlers.products = () => ({
      data: [{ id: "product-1", slug: "cherry-gel-pen", name: "Cherry Gel Pen", base_price_cents: 100_000, sale_price_cents: null, currency: "INR", status: "published", deleted_at: null }],
      error: null,
    });
    tableHandlers.product_variants = () => ({
      data: [{ id: "variant-1", product_id: "product-1", sku: "SKU-1", label: "Cherry", stock_quantity: 20, is_active: true, deleted_at: null, sort_order: 0, colors: { name: "Cherry", slug: "cherry" } }],
      error: null,
    });
    const resolved = await resolveCheckoutLines({ items: [{ productSlug: "cherry-gel-pen", quantity: 1 }] } as never);

    expect(resolved.shippingMinor).toBe(cart.summary.shippingCents);
    expect(resolved.totalMinor).toBe(cart.summary.totalCents);
  });
});
