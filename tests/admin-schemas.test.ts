import { describe, expect, it } from "vitest";

import { productCreateCompleteSchema, productCreateSchema, variantCreateSchema } from "@/features/admin/schemas";

const categoryId = "07545075-c751-4f2d-bf28-5a137d6f9de8";
const colorId = "268a7c03-a01a-4a25-bd8f-0df01430e356";
const mediaId = "9f8e7d6c-5b4a-4321-8765-0fedcba98765";

describe("admin catalog validation", () => {
  const product = {
    slug: "berry-gel-pen",
    name: "Berry Gel Pen",
    label: "Smooth 0.5 mm pen",
    description: "A smooth everyday gel pen.",
    material: "Plastic",
    size: "14 cm",
    basePriceCents: 499,
    salePriceCents: 399,
    primaryCategoryId: categoryId,
    badges: ["new"] as const,
  };

  it("accepts a valid draft product", () => {
    expect(productCreateSchema.parse(product).salePriceCents).toBe(399);
  });

  it("rejects non-discount sale pricing and unknown fields", () => {
    expect(productCreateSchema.safeParse({ ...product, salePriceCents: 499 }).success).toBe(false);
    expect(productCreateSchema.safeParse({ ...product, status: "published" }).success).toBe(false);
  });

  it("applies safe variant inventory defaults", () => {
    expect(variantCreateSchema.parse({ colorId, sku: "CD-PEN-BERRY", stockQuantity: 20 })).toMatchObject({
      lowStockThreshold: 5,
      sortOrder: 0,
    });
  });

  describe("atomic product creation payload", () => {
    const complete = {
      ...product,
      variant: { colorId, sku: "CD-PEN-BERRY", stockQuantity: 20 },
      mediaId,
      publish: false,
    };

    it("accepts a full product+variant+media payload with variant defaults applied", () => {
      const parsed = productCreateCompleteSchema.parse(complete);
      expect(parsed.variant).toMatchObject({ stockQuantity: 20, lowStockThreshold: 5 });
      expect(parsed.publish).toBe(false);
    });

    it("allows the primary image to be omitted so a draft can be created before an upload completes", () => {
      const { mediaId: _omit, ...withoutMedia } = complete;
      expect(productCreateCompleteSchema.safeParse(withoutMedia).success).toBe(true);
    });

    it("defaults publish to false when not supplied", () => {
      const { publish: _omit, ...withoutPublish } = complete;
      expect(productCreateCompleteSchema.parse(withoutPublish).publish).toBe(false);
    });

    it("still rejects non-discount sale pricing on the combined payload", () => {
      expect(productCreateCompleteSchema.safeParse({ ...complete, salePriceCents: complete.basePriceCents }).success).toBe(false);
    });

    it("rejects a payload missing the variant", () => {
      const { variant: _omit, ...withoutVariant } = complete;
      expect(productCreateCompleteSchema.safeParse(withoutVariant).success).toBe(false);
    });

    it("rejects unknown top-level fields", () => {
      expect(productCreateCompleteSchema.safeParse({ ...complete, stock: 20 }).success).toBe(false);
    });
  });
});
