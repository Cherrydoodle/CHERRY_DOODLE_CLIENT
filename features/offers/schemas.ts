import { z } from "zod";

const uuid = z.string().uuid();
const version = z.number().int().positive();
const slug = z.string().trim().min(2).max(120).regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/);

export const offerPricingModeSchema = z.enum(["percentage", "fixed"]);

const offerProductInputSchema = z.object({
  productId: uuid,
  offerPriceCents: z.number().int().positive().max(100_000_000).nullable().optional(),
}).strict();

function checkNoDuplicateProducts(products: Array<{ productId: string }>, context: z.RefinementCtx) {
  const seen = new Set<string>();
  for (const product of products) {
    if (seen.has(product.productId)) {
      context.addIssue({ code: "custom", path: ["products"], message: "A product cannot be added to the same offer twice." });
      break;
    }
    seen.add(product.productId);
  }
}

export const offerCreateSchema = z.object({
  name: z.string().trim().min(2).max(160),
  slug,
  pricingMode: offerPricingModeSchema,
  discountPercent: z.number().positive().max(95).nullable().optional(),
  bannerMediaId: uuid.nullable().optional(),
  startsAt: z.string().datetime().nullable().optional(),
  endsAt: z.string().datetime().nullable().optional(),
  isActive: z.boolean().optional().default(true),
  priority: z.number().int().min(-10_000).max(10_000).optional().default(0),
  products: z.array(offerProductInputSchema).min(1, "An offer needs at least one product.").max(500),
}).strict().superRefine((value, context) => {
  if (value.startsAt && value.endsAt && new Date(value.endsAt).getTime() <= new Date(value.startsAt).getTime()) {
    context.addIssue({ code: "custom", path: ["endsAt"], message: "End date must be after the start date." });
  }
  if (value.pricingMode === "percentage") {
    if (value.discountPercent == null) context.addIssue({ code: "custom", path: ["discountPercent"], message: "A percentage offer requires a discount percent." });
    if (value.products.some((product) => product.offerPriceCents != null)) {
      context.addIssue({ code: "custom", path: ["products"], message: "Per-product prices are only used in fixed pricing mode." });
    }
  } else {
    if (value.discountPercent != null) context.addIssue({ code: "custom", path: ["discountPercent"], message: "Fixed-price offers do not use a discount percent." });
    if (value.products.some((product) => product.offerPriceCents == null)) {
      context.addIssue({ code: "custom", path: ["products"], message: "Every product needs an offer price in fixed pricing mode." });
    }
  }
  checkNoDuplicateProducts(value.products, context);
});

// Partial update: field-level shape only. Cross-field coherence (pricing mode vs.
// discountPercent vs. per-product prices) depends on values already stored when a
// field is omitted, so features/offers/service.ts#validateOfferCoherence checks it
// against the merged before+after record -- the same pattern updateProduct uses for
// validateSale (features/admin/service.ts).
export const offerUpdateSchema = z.object({
  name: z.string().trim().min(2).max(160).optional(),
  slug: slug.optional(),
  pricingMode: offerPricingModeSchema.optional(),
  discountPercent: z.number().positive().max(95).nullable().optional(),
  bannerMediaId: uuid.nullable().optional(),
  startsAt: z.string().datetime().nullable().optional(),
  endsAt: z.string().datetime().nullable().optional(),
  isActive: z.boolean().optional(),
  priority: z.number().int().min(-10_000).max(10_000).optional(),
  products: z.array(offerProductInputSchema).min(1, "An offer needs at least one product.").max(500).optional(),
  expectedVersion: version,
}).strict().superRefine((value, context) => {
  if (value.startsAt && value.endsAt && new Date(value.endsAt).getTime() <= new Date(value.startsAt).getTime()) {
    context.addIssue({ code: "custom", path: ["endsAt"], message: "End date must be after the start date." });
  }
  if (value.products) checkNoDuplicateProducts(value.products, context);
});
