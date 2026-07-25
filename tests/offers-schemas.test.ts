import { describe, expect, it } from "vitest";

import { offerCreateSchema, offerUpdateSchema } from "@/features/offers/schemas";

const baseOffer = {
  name: "Monsoon Sale",
  slug: "monsoon-sale",
  pricingMode: "percentage" as const,
  discountPercent: 30,
  products: [{ productId: "07545075-c751-4f2d-bf28-5a137d6f9de8" }],
};

describe("offerCreateSchema", () => {
  it("accepts a valid percentage offer", () => {
    expect(offerCreateSchema.safeParse(baseOffer).success).toBe(true);
  });

  it("requires at least one product", () => {
    expect(offerCreateSchema.safeParse({ ...baseOffer, products: [] }).success).toBe(false);
  });

  it("requires a discount percent in percentage mode", () => {
    const { discountPercent: _omit, ...rest } = baseOffer;
    expect(offerCreateSchema.safeParse(rest).success).toBe(false);
  });

  it("rejects a discount percent above 95", () => {
    expect(offerCreateSchema.safeParse({ ...baseOffer, discountPercent: 96 }).success).toBe(false);
  });

  it("rejects per-product offer prices in percentage mode", () => {
    const input = { ...baseOffer, products: [{ productId: baseOffer.products[0].productId, offerPriceCents: 5000 }] };
    expect(offerCreateSchema.safeParse(input).success).toBe(false);
  });

  it("requires an offer price on every product in fixed mode, and forbids discountPercent", () => {
    const fixedNoPrices = { ...baseOffer, pricingMode: "fixed" as const, discountPercent: undefined, products: [{ productId: baseOffer.products[0].productId }] };
    expect(offerCreateSchema.safeParse(fixedNoPrices).success).toBe(false);

    const fixedWithDiscount = { ...baseOffer, pricingMode: "fixed" as const, products: [{ productId: baseOffer.products[0].productId, offerPriceCents: 5000 }] };
    expect(offerCreateSchema.safeParse(fixedWithDiscount).success).toBe(false);

    const fixedValid = { ...baseOffer, pricingMode: "fixed" as const, discountPercent: undefined, products: [{ productId: baseOffer.products[0].productId, offerPriceCents: 5000 }] };
    expect(offerCreateSchema.safeParse(fixedValid).success).toBe(true);
  });

  it("rejects a duplicate product in the same offer", () => {
    const id = baseOffer.products[0].productId;
    expect(offerCreateSchema.safeParse({ ...baseOffer, products: [{ productId: id }, { productId: id }] }).success).toBe(false);
  });

  it("rejects an end date at or before the start date", () => {
    const equal = { ...baseOffer, startsAt: "2026-08-01T00:00:00Z", endsAt: "2026-08-01T00:00:00Z" };
    expect(offerCreateSchema.safeParse(equal).success).toBe(false);
    const before = { ...baseOffer, startsAt: "2026-08-02T00:00:00Z", endsAt: "2026-08-01T00:00:00Z" };
    expect(offerCreateSchema.safeParse(before).success).toBe(false);
  });

  it("accepts an end date after the start date", () => {
    const valid = { ...baseOffer, startsAt: "2026-08-01T00:00:00Z", endsAt: "2026-08-02T00:00:00Z" };
    expect(offerCreateSchema.safeParse(valid).success).toBe(true);
  });

  it("rejects unknown fields (strict)", () => {
    expect(offerCreateSchema.safeParse({ ...baseOffer, notAField: true }).success).toBe(false);
  });
});

describe("offerUpdateSchema", () => {
  it("accepts a partial update with only expectedVersion and one field", () => {
    expect(offerUpdateSchema.safeParse({ isActive: false, expectedVersion: 1 }).success).toBe(true);
  });

  it("requires expectedVersion", () => {
    expect(offerUpdateSchema.safeParse({ isActive: false }).success).toBe(false);
  });

  it("rejects a duplicate product when products are included in the update", () => {
    const id = baseOffer.products[0].productId;
    expect(offerUpdateSchema.safeParse({ expectedVersion: 1, products: [{ productId: id }, { productId: id }] }).success).toBe(false);
  });

  it("rejects an end date at or before the start date when both are provided", () => {
    expect(offerUpdateSchema.safeParse({ expectedVersion: 1, startsAt: "2026-08-02T00:00:00Z", endsAt: "2026-08-01T00:00:00Z" }).success).toBe(false);
  });
});
