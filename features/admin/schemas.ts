import { z } from "zod";

const slug = z.string().trim().min(2).max(120).regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/);
const uuid = z.string().uuid();
const version = z.number().int().positive();

export const resourceIdSchema = uuid;
export const categoryCreateSchema = z.object({
  name: z.string().trim().min(2).max(120), slug, parentId: uuid.nullable().optional(), description: z.string().max(2000).optional(),
  emoji: z.string().max(32).nullable().optional(), imageMediaId: uuid.nullable().optional(), seoTitle: z.string().max(160).nullable().optional(),
  seoDescription: z.string().max(320).nullable().optional(), sortOrder: z.number().int().optional(), isActive: z.boolean().optional(),
}).strict();
export const categoryUpdateSchema = categoryCreateSchema.partial().extend({ expectedVersion: version }).strict();
export const versionCommandSchema = z.object({ expectedVersion: version }).strict();

const badge = z.enum(["new", "bestseller", "sale"]);
const productFields = {
  slug, name: z.string().trim().min(2).max(160), label: z.string().trim().max(100), description: z.string().trim().min(1).max(5000),
  material: z.string().trim().max(255), size: z.string().trim().max(255), basePriceCents: z.number().int().positive().max(100_000_000),
  salePriceCents: z.number().int().positive().max(100_000_000).nullable(), featuredSortOrder: z.number().int().nullable().optional(),
  primaryCategoryId: uuid, badges: z.array(badge).max(3), allowCustomImage: z.boolean().optional().default(false),
};
export const productCreateSchema = z.object(productFields).strict().superRefine((value, context) => {
  if (value.salePriceCents !== null && value.salePriceCents >= value.basePriceCents) context.addIssue({ code: "custom", path: ["salePriceCents"], message: "Sale price must be lower than base price." });
});
export const productCreateCompleteSchema = z.object({
  ...productFields,
  variant: z.object({
    colorId: uuid.nullable(), label: z.string().trim().min(1).max(100), sku: z.string().trim().min(1).max(80),
    stockQuantity: z.number().int().nonnegative().max(1_000_000),
    lowStockThreshold: z.number().int().nonnegative().max(1_000_000).optional().default(5),
  }).strict(),
  mediaId: uuid.nullable().optional(),
  publish: z.boolean().optional().default(false),
}).strict().superRefine((value, context) => {
  if (value.salePriceCents !== null && value.salePriceCents >= value.basePriceCents) context.addIssue({ code: "custom", path: ["salePriceCents"], message: "Sale price must be lower than base price." });
});
export const productUpdateSchema = z.object({
  slug: productFields.slug.optional(), name: productFields.name.optional(), label: productFields.label.optional(), description: productFields.description.optional(),
  material: productFields.material.optional(), size: productFields.size.optional(), basePriceCents: productFields.basePriceCents.optional(),
  salePriceCents: productFields.salePriceCents.optional(), featuredSortOrder: productFields.featuredSortOrder,
  primaryCategoryId: productFields.primaryCategoryId.optional(), badges: productFields.badges.optional(), allowCustomImage: z.boolean().optional(), expectedVersion: version,
}).strict();
export const publishProductSchema = z.object({ publish: z.boolean(), expectedVersion: version }).strict();

export const variantCreateSchema = z.object({
  colorId: uuid.nullable(), label: z.string().trim().min(1).max(100), sku: z.string().trim().min(1).max(80), stockQuantity: z.number().int().nonnegative().max(1_000_000),
  lowStockThreshold: z.number().int().nonnegative().max(1_000_000).optional().default(5), sortOrder: z.number().int().optional().default(0),
}).strict();
export const variantUpdateSchema = z.object({
  colorId: uuid.nullable().optional(), label: z.string().trim().min(1).max(100).optional(), sku: z.string().trim().min(1).max(80).optional(), stockQuantity: z.number().int().nonnegative().max(1_000_000).optional(),
  lowStockThreshold: z.number().int().nonnegative().max(1_000_000).optional(), sortOrder: z.number().int().optional(), isActive: z.boolean().optional(), expectedVersion: version,
}).strict();

export const attachMediaSchema = z.object({ position: z.number().int().min(0).max(99), isPrimary: z.boolean(), altTextOverride: z.string().max(300).nullable().optional() }).strict();
export const attachVariantMediaSchema = z.object({ position: z.number().int().min(0).max(99) }).strict();

export const contentCreateSchema = z.object({
  key: z.string().regex(/^[a-z0-9]+(?:[.-][a-z0-9]+)*$/), eyebrow: z.string().max(200).nullable().optional(), title: z.string().min(1).max(200),
  body: z.string().max(2000).nullable().optional(), mediaAssetId: uuid.nullable().optional(), primaryLabel: z.string().max(80).nullable().optional(),
  primaryHref: z.string().max(500).nullable().optional(), secondaryLabel: z.string().max(80).nullable().optional(), secondaryHref: z.string().max(500).nullable().optional(),
  startsAt: z.string().datetime().nullable().optional(), endsAt: z.string().datetime().nullable().optional(), isActive: z.boolean().optional(), sortOrder: z.number().int().optional(),
}).strict();
export const contentUpdateSchema = contentCreateSchema.partial().extend({ expectedVersion: version }).strict();
export const roleUpdateSchema = z.object({ role: z.enum(["customer", "catalog_manager", "admin"]), reason: z.string().trim().min(3).max(500) }).strict();
