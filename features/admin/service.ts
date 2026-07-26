import "server-only";

import { revalidateTag } from "next/cache";
import type { z } from "zod";

import type { AuthContext } from "@/lib/auth/authorization";
import { ApiError } from "@/lib/http/problem";
import { logger } from "@/lib/observability/logger";
import { createAdminSupabaseClient } from "@/lib/supabase/admin";
import { mediaImageDto } from "@/features/media/delivery";
import { requestMediaDeletion } from "@/features/media/service";
import type {
  attachMediaSchema, attachVariantMediaSchema, categoryCreateSchema, categoryUpdateSchema, contentCreateSchema, contentUpdateSchema,
  productCreateCompleteSchema, productUpdateSchema, roleUpdateSchema, variantCreateSchema, variantUpdateSchema,
} from "@/features/admin/schemas";

type CategoryCreate = z.infer<typeof categoryCreateSchema>;
type CategoryUpdate = z.infer<typeof categoryUpdateSchema>;
type ProductCreateComplete = z.infer<typeof productCreateCompleteSchema>;
type ProductUpdate = z.infer<typeof productUpdateSchema>;
type VariantCreate = z.infer<typeof variantCreateSchema>;
type VariantUpdate = z.infer<typeof variantUpdateSchema>;
type AttachMedia = z.infer<typeof attachMediaSchema>;
type AttachVariantMedia = z.infer<typeof attachVariantMediaSchema>;
type ContentCreate = z.infer<typeof contentCreateSchema>;
type ContentUpdate = z.infer<typeof contentUpdateSchema>;
type RoleUpdate = z.infer<typeof roleUpdateSchema>;

export function readyMediaDto(value: unknown) {
  const media = Array.isArray(value) ? value[0] : value as Record<string, unknown> | null;
  if (!media || media.status !== "ready" || media.storage_provider !== "cloudinary" || !media.storage_key) return null;
  return mediaImageDto({ id: String(media.id), storageKey: String(media.storage_key), alt: String(media.alt_text ?? ""), width: Number(media.width ?? 1), height: Number(media.height ?? 1) });
}

// S10: an admin mutation that cannot be audited must not silently report success
// -- the underlying write already happened, but the caller (and the client) needs
// to know the trail is broken, so this throws rather than only logging. Exported so
// other admin-resource modules (e.g. features/offers/service.ts) that don't own a
// content_blocks-backed resource can still audit through the same helper.
export async function audit(actor: AuthContext, action: string, resourceType: string, resourceId: string | null, before: unknown, after: unknown, requestId: string) {
  const admin = createAdminSupabaseClient();
  const { error } = await admin.from("audit_logs").insert({
    actor_user_id: actor.userId, actor_role: actor.role, action, resource_type: resourceType, resource_id: resourceId,
    before_data: before ?? null, after_data: after ?? null, request_id: requestId,
  });
  if (error) {
    logger.error("audit_log_write_failed", { action, resourceType, resourceId, requestId, errorCode: error.code });
    throw new ApiError(503, "AUDIT_LOG_FAILED", "The action succeeded but could not be recorded in the audit trail. Please verify and retry if needed.");
  }
}

function categoryPatch(input: Partial<CategoryCreate>, actor: AuthContext) {
  return {
    ...(input.name !== undefined ? { name: input.name } : {}), ...(input.slug !== undefined ? { slug: input.slug } : {}),
    ...(input.parentId !== undefined ? { parent_id: input.parentId } : {}), ...(input.description !== undefined ? { description: input.description } : {}),
    ...(input.emoji !== undefined ? { emoji: input.emoji } : {}), ...(input.imageMediaId !== undefined ? { image_media_id: input.imageMediaId } : {}),
    ...(input.seoTitle !== undefined ? { seo_title: input.seoTitle } : {}), ...(input.seoDescription !== undefined ? { seo_description: input.seoDescription } : {}),
    ...(input.sortOrder !== undefined ? { sort_order: input.sortOrder } : {}), ...(input.isActive !== undefined ? { is_active: input.isActive } : {}),
    updated_by: actor.userId,
  };
}

export async function listAdminCategories(options: { includeDeleted: boolean; query?: string; page: number; limit: number }) {
  const admin = createAdminSupabaseClient();
  let query = admin.from("categories").select("*,media_assets(id,status,storage_key,storage_provider,alt_text,width,height),product_categories(count)", { count: "exact" });
  if (!options.includeDeleted) query = query.is("deleted_at", null);
  if (options.query) query = query.ilike("name", `%${options.query}%`);
  const start = (options.page - 1) * options.limit;
  const { data, error, count } = await query.order("sort_order").order("name").range(start, start + options.limit - 1);
  if (error) throw new ApiError(503, "SERVICE_UNAVAILABLE", "Categories could not be loaded.");
  return { items: (data ?? []).map((row) => ({
    id: row.id, name: row.name, slug: row.slug, parentId: row.parent_id, description: row.description,
    emoji: row.emoji, imageMediaId: row.image_media_id, image: readyMediaDto(row.media_assets), productCount: row.product_categories?.[0]?.count ?? 0,
    seoTitle: row.seo_title, seoDescription: row.seo_description, sortOrder: row.sort_order, isActive: row.is_active,
    version: row.version, createdAt: row.created_at, updatedAt: row.updated_at,
  })), total: count ?? 0, page: options.page, limit: options.limit };
}

// Maps the validate_category_tree DB trigger's bare `raise exception '<CODE>'` text
// (supabase/migrations/202607140002_catalog_media.sql) to friendly API errors, so the
// admin panel shows "max two levels" instead of a generic "could not be created".
// The trigger is the actual two-level-hierarchy enforcement; this only translates it.
function mapCategoryTreeError(message: string) {
  if (message.includes("CATEGORY_DEPTH_EXCEEDED")) {
    return new ApiError(422, "CATEGORY_DEPTH_EXCEEDED", "A subcategory can't have its own subcategories (max two levels).");
  }
  if (message.includes("CATEGORY_PARENT_INVALID")) {
    return new ApiError(422, "CATEGORY_PARENT_INVALID", "The chosen parent category no longer exists.");
  }
  if (message.includes("CATEGORY_WITH_CHILDREN_CANNOT_BECOME_CHILD")) {
    return new ApiError(409, "CATEGORY_WITH_CHILDREN_CANNOT_BECOME_CHILD", "This category has subcategories, so it can't become a subcategory itself.");
  }
  return null;
}

export async function createCategory(input: CategoryCreate, actor: AuthContext, requestId: string) {
  const admin = createAdminSupabaseClient();
  if (input.imageMediaId) await requireReadyMedia(input.imageMediaId, ["category"]);
  const { data, error } = await admin.from("categories").insert({ ...categoryPatch(input, actor), created_by: actor.userId }).select("*").single();
  if (error) {
    if (error.code === "23505") throw new ApiError(409, "SLUG_EXISTS", "Category slug already exists.");
    throw mapCategoryTreeError(error.message) ?? new ApiError(422, "VALIDATION_ERROR", "Category could not be created.");
  }
  await audit(actor, "category.create", "category", data.id, null, data, requestId);
  revalidateTag("categories", { expire: 0 });
  return data;
}

export async function updateCategory(id: string, input: CategoryUpdate, actor: AuthContext, requestId: string) {
  const admin = createAdminSupabaseClient();
  if (input.imageMediaId) await requireReadyMedia(input.imageMediaId, ["category"]);
  const { data: before } = await admin.from("categories").select("*").eq("id", id).maybeSingle();
  if (!before) throw new ApiError(404, "NOT_FOUND", "Category not found.");
  const { expectedVersion, ...fields } = input;
  const { data, error } = await admin.from("categories").update(categoryPatch(fields, actor)).eq("id", id).eq("version", expectedVersion).select("*").maybeSingle();
  if (error) {
    if (error.code === "23505") throw new ApiError(409, "SLUG_EXISTS", "Category slug already exists.");
    const treeError = mapCategoryTreeError(error.message);
    if (treeError) throw treeError;
  }
  if (!data) throw new ApiError(409, "VERSION_CONFLICT", "Category was changed by another user.");
  await audit(actor, "category.update", "category", id, before, data, requestId);
  revalidateTag("categories", { expire: 0 });
  return data;
}

export async function deleteCategory(id: string, expectedVersion: number, actor: AuthContext, requestId: string) {
  const admin = createAdminSupabaseClient();
  const [children, products, beforeResult] = await Promise.all([
    admin.from("categories").select("*", { count: "exact", head: true }).eq("parent_id", id).is("deleted_at", null),
    admin.from("product_categories").select("*", { count: "exact", head: true }).eq("category_id", id),
    admin.from("categories").select("*").eq("id", id).maybeSingle(),
  ]);
  if (!beforeResult.data) throw new ApiError(404, "NOT_FOUND", "Category not found.");
  if ((children.count ?? 0) + (products.count ?? 0) > 0) throw new ApiError(409, "CATEGORY_IN_USE", "Reassign child categories and products before deletion.");
  const { data } = await admin.from("categories").update({ deleted_at: new Date().toISOString(), deleted_by: actor.userId, is_active: false, updated_by: actor.userId }).eq("id", id).eq("version", expectedVersion).select("id").maybeSingle();
  if (!data) throw new ApiError(409, "VERSION_CONFLICT", "Category was changed by another user.");
  await audit(actor, "category.delete", "category", id, beforeResult.data, null, requestId);
  revalidateTag("categories", { expire: 0 });
  const imageMediaId = beforeResult.data.image_media_id as string | null;
  if (imageMediaId) {
    await requestMediaDeletion(imageMediaId, actor).catch((error) => {
      logger.error("media_cleanup_failed", { mediaId: imageMediaId, resourceType: "category", resourceId: id, error: error instanceof Error ? error.message : String(error) });
    });
  }
}

function productPatch(input: Partial<ProductUpdate>, actor: AuthContext) {
  return {
    ...(input.slug !== undefined ? { slug: input.slug } : {}), ...(input.name !== undefined ? { name: input.name } : {}),
    ...(input.label !== undefined ? { label: input.label } : {}), ...(input.description !== undefined ? { description: input.description } : {}),
    ...(input.material !== undefined ? { material: input.material } : {}), ...(input.size !== undefined ? { size: input.size } : {}),
    ...(input.basePriceCents !== undefined ? { base_price_cents: input.basePriceCents } : {}), ...(input.salePriceCents !== undefined ? { sale_price_cents: input.salePriceCents } : {}),
    ...(input.featuredSortOrder !== undefined ? { featured_sort_order: input.featuredSortOrder } : {}),
    ...(input.allowCustomImage !== undefined ? { allow_custom_image: input.allowCustomImage } : {}), updated_by: actor.userId,
  };
}

export async function listAdminProducts(options: { status?: string; query?: string; categoryIds?: string[]; page: number; limit: number }) {
  const admin = createAdminSupabaseClient();
  let query = admin.from("products").select(`
    id,slug,name,label,description,material,size,status,base_price_cents,sale_price_cents,currency,allow_custom_image,version,published_at,updated_at,
    product_categories!inner(category_id,is_primary,categories(id,name,slug)),
    product_variants(stock_quantity,low_stock_threshold,is_active,deleted_at),
    product_media(position,is_primary,media_assets(id,status,storage_key,storage_provider,alt_text,width,height))
  `, { count: "exact" }).is("deleted_at", null).eq("product_categories.is_primary", true);
  if (options.status) query = query.eq("status", options.status);
  if (options.query) query = query.ilike("name", `%${options.query}%`);
  // A caller filtering by a master category passes that master's id plus every one of
  // its subcategory ids (resolved client-side), since a product's primaryCategoryId is
  // whichever of the two was actually chosen when it was created -- an exact match on
  // just the master would silently miss every product filed under a subcategory.
  if (options.categoryIds?.length) query = query.in("product_categories.category_id", options.categoryIds);
  const start = (options.page - 1) * options.limit;
  const { data, error, count } = await query.order("updated_at", { ascending: false }).range(start, start + options.limit - 1);
  if (error) throw new ApiError(503, "SERVICE_UNAVAILABLE", "Products could not be loaded.");
  return { items: (data ?? []).map((row) => {
    const primaryCategory = row.product_categories?.[0];
    const categoryValue = primaryCategory?.categories;
    const category = Array.isArray(categoryValue) ? categoryValue[0] : categoryValue;
    const stock = (row.product_variants ?? []).filter((variant) => variant.is_active && !variant.deleted_at).reduce((sum, variant) => sum + variant.stock_quantity, 0);
    const primaryMedia = (row.product_media ?? []).find((media) => media.is_primary);
    const mediaValue = primaryMedia?.media_assets;
    const image = Array.isArray(mediaValue) ? mediaValue[0] : mediaValue;
    return {
      id: row.id, slug: row.slug, name: row.name, label: row.label, description: row.description, material: row.material, size: row.size,
      status: row.status, basePriceMinor: row.base_price_cents, salePriceMinor: row.sale_price_cents, currency: row.currency,
      allowCustomImage: row.allow_custom_image, stock, category: category ? { id: category.id, name: category.name, slug: category.slug } : null,
      primaryImage: readyMediaDto(image), version: row.version, publishedAt: row.published_at, updatedAt: row.updated_at,
    };
  }), total: count ?? 0, page: options.page, limit: options.limit };
}

export async function getAdminProduct(id: string) {
  const admin = createAdminSupabaseClient();
  const { data, error } = await admin.from("products").select(`
    *,product_categories(category_id,is_primary,categories(id,slug,name,parent_id,is_active,deleted_at)),product_badges(badge),
    product_variants(id,color_id,label,sku,stock_quantity,low_stock_threshold,is_active,sort_order,version,deleted_at,colors(id,name,slug,hex_code),product_variant_media(media_asset_id,position)),
    product_media(media_asset_id,position,is_primary,alt_text_override,media_assets(id,status,purpose,storage_key,storage_provider,alt_text,width,height))
  `).eq("id", id).maybeSingle();
  if (error) throw new ApiError(503, "SERVICE_UNAVAILABLE", "Product could not be loaded.");
  if (!data) throw new ApiError(404, "NOT_FOUND", "Product not found.");
  // Adds a ready-to-render `.image` DTO (with Cloudinary URLs) to every attached media
  // row, not just the primary -- the admin panel's gallery editor needs a thumbnail for
  // each image, and this is the one place that fetches the full product_media list.
  const productMedia = (data.product_media ?? []).map((row: { media_assets: unknown }) => ({ ...row, image: readyMediaDto(row.media_assets) }));
  return { ...data, product_media: productMedia };
}

// Creates the product, its primary category link, badges, first variant, and (optionally) its
// primary image in one database transaction via the create_product_with_variant RPC, then
// optionally publishes it. This replaces a prior sequence of separate client-driven requests
// that could leave an orphaned draft (product with no variant/image) if any step failed, and
// that could not be safely retried because the product row already existed under that slug.
export async function createProduct(input: ProductCreateComplete, actor: AuthContext, requestId: string) {
  validateSale(input.basePriceCents, input.salePriceCents);
  await requireActiveCategory(input.primaryCategoryId);
  if (input.mediaId) await requireReadyMedia(input.mediaId, ["product"]);

  const admin = createAdminSupabaseClient();
  const { data: productId, error } = await admin.rpc("create_product_with_variant", {
    p_slug: input.slug, p_name: input.name, p_label: input.label, p_description: input.description,
    p_material: input.material, p_size: input.size, p_base_price_cents: input.basePriceCents,
    p_sale_price_cents: input.salePriceCents, p_featured_sort_order: input.featuredSortOrder ?? null,
    p_allow_custom_image: input.allowCustomImage ?? false, p_primary_category_id: input.primaryCategoryId,
    p_badges: input.badges, p_color_id: input.variant.colorId, p_variant_label: input.variant.label, p_sku: input.variant.sku,
    p_stock_quantity: input.variant.stockQuantity, p_low_stock_threshold: input.variant.lowStockThreshold,
    p_media_id: input.mediaId ?? null, p_actor_id: actor.userId,
  });
  if (error) {
    if (error.code === "23505") {
      if (error.message.includes("sku")) throw new ApiError(409, "VARIANT_EXISTS", "That SKU already exists.");
      throw new ApiError(409, "SLUG_EXISTS", "Product slug already exists.");
    }
    throw new ApiError(422, "VALIDATION_ERROR", "Product could not be created.");
  }

  await audit(actor, "product.create", "product", productId, null, { id: productId }, requestId);
  revalidateTag("products", { expire: 0 });
  let product = await getAdminProduct(productId);
  if (input.publish) product = await publishProduct(productId, true, product.version, actor, requestId);
  return product;
}

export async function updateProduct(id: string, input: ProductUpdate, actor: AuthContext, requestId: string) {
  const admin = createAdminSupabaseClient();
  const before = await getAdminProduct(id);
  const basePrice = input.basePriceCents ?? before.base_price_cents;
  const salePrice = input.salePriceCents === undefined ? before.sale_price_cents : input.salePriceCents;
  validateSale(basePrice, salePrice);
  if (input.primaryCategoryId) await requireActiveCategory(input.primaryCategoryId);
  const { expectedVersion, primaryCategoryId, badges, ...fields } = input;
  const { data, error } = await admin.from("products").update(productPatch(fields, actor)).eq("id", id).eq("version", expectedVersion).select("id").maybeSingle();
  if (error?.code === "23505") throw new ApiError(409, "SLUG_EXISTS", "Product slug already exists.");
  if (!data) throw new ApiError(409, "VERSION_CONFLICT", "Product was changed by another user.");
  if (primaryCategoryId) {
    await admin.from("product_categories").update({ is_primary: false }).eq("product_id", id);
    await admin.from("product_categories").upsert({ product_id: id, category_id: primaryCategoryId, is_primary: true }, { onConflict: "product_id,category_id" });
  }
  if (badges) {
    await admin.from("product_badges").delete().eq("product_id", id);
    if (badges.length) await admin.from("product_badges").insert(badges.map((badge) => ({ product_id: id, badge, assigned_by: actor.userId })));
  }
  const after = await getAdminProduct(id);
  await audit(actor, "product.update", "product", id, before, after, requestId);
  revalidateTag("products", { expire: 0 });
  return after;
}

function validateSale(base: number, sale: number | null) {
  if (sale !== null && sale >= base) throw new ApiError(422, "VALIDATION_ERROR", "Sale price must be lower than base price.");
}

export async function publishProduct(id: string, publish: boolean, expectedVersion: number, actor: AuthContext, requestId: string) {
  const admin = createAdminSupabaseClient();
  const before = await getAdminProduct(id);
  if (publish) {
    const failures: Array<{ path: string; message: string }> = [];
    if (!before.product_categories?.some((item: { is_primary: boolean; categories: { is_active?: boolean; deleted_at?: string | null } | Array<{ is_active?: boolean; deleted_at?: string | null }> }) => {
      const category = Array.isArray(item.categories) ? item.categories[0] : item.categories;
      return item.is_primary && category?.is_active !== false && !category?.deleted_at;
    })) failures.push({ path: "primaryCategory", message: "An active primary category is required." });
    if (!before.product_variants?.some((item: { is_active: boolean; stock_quantity: number; deleted_at: string | null }) => item.is_active && item.stock_quantity > 0 && !item.deleted_at)) failures.push({ path: "variants", message: "An active in-stock variant is required." });
    if (!before.product_media?.some((item: { is_primary: boolean; media_assets: { status?: string } | Array<{ status?: string }> }) => item.is_primary && (Array.isArray(item.media_assets) ? item.media_assets[0]?.status : item.media_assets?.status) === "ready")) failures.push({ path: "primaryImage", message: "A ready primary image is required." });
    if (failures.length) throw new ApiError(422, "PUBLISH_REQUIREMENTS_FAILED", "Product is not ready to publish.", failures);
  }
  const patch = publish ? { status: "published", published_at: new Date().toISOString(), updated_by: actor.userId } : { status: "draft", published_at: null, updated_by: actor.userId };
  const { data } = await admin.from("products").update(patch).eq("id", id).eq("version", expectedVersion).select("id").maybeSingle();
  if (!data) throw new ApiError(409, "VERSION_CONFLICT", "Product was changed by another user.");
  const after = await getAdminProduct(id);
  await audit(actor, publish ? "product.publish" : "product.unpublish", "product", id, before, after, requestId);
  revalidateTag("products", { expire: 0 });
  return after;
}

export async function deleteProduct(id: string, expectedVersion: number, actor: AuthContext, requestId: string) {
  const admin = createAdminSupabaseClient();
  const before = await getAdminProduct(id);
  const { data } = await admin.from("products").update({ status: "archived", deleted_at: new Date().toISOString(), deleted_by: actor.userId, updated_by: actor.userId }).eq("id", id).eq("version", expectedVersion).select("id").maybeSingle();
  if (!data) throw new ApiError(409, "VERSION_CONFLICT", "Product was changed by another user.");
  await audit(actor, "product.delete", "product", id, before, null, requestId);
  revalidateTag("products", { expire: 0 });
  // Soft-delete the product's own variants too. Deleting the product alone left their
  // deleted_at null forever, which kept their SKUs "live" under the SKU uniqueness index
  // and blocked recreating a product with the same name/variants (409 VARIANT_EXISTS).
  await admin.from("product_variants").update({ is_active: false, deleted_at: new Date().toISOString() }).eq("product_id", id).is("deleted_at", null);
  await cleanupProductMedia(admin, id, before, actor);
}

// Gathers every media asset attached to a product's gallery and its variants' galleries,
// detaches them (the join rows are pure associations -- order_items already snapshot
// variant_label/color_name/sku as immutable text independent of these tables), then
// asks requestMediaDeletion to destroy each Cloudinary asset that's no longer referenced
// anywhere else. Failures here must never fail the caller's delete -- they fall back to
// the media-cleanup cron via requestMediaDeletion's own delete_pending/retry handling.
async function cleanupProductMedia(
  admin: ReturnType<typeof createAdminSupabaseClient>,
  productId: string,
  before: { product_media?: Array<{ media_asset_id: string }>; product_variants?: Array<{ id: string; product_variant_media?: Array<{ media_asset_id: string }> }> },
  actor: AuthContext,
) {
  const variantIds = (before.product_variants ?? []).map((variant) => variant.id);
  const mediaIds = new Set<string>();
  for (const item of before.product_media ?? []) mediaIds.add(item.media_asset_id);
  for (const variant of before.product_variants ?? []) for (const item of variant.product_variant_media ?? []) mediaIds.add(item.media_asset_id);
  if (mediaIds.size === 0) return;
  await admin.from("product_media").delete().eq("product_id", productId);
  if (variantIds.length) await admin.from("product_variant_media").delete().in("product_variant_id", variantIds);
  await Promise.all([...mediaIds].map((mediaId) =>
    requestMediaDeletion(mediaId, actor).catch((error) => {
      logger.error("media_cleanup_failed", { mediaId, resourceType: "product", resourceId: productId, error: error instanceof Error ? error.message : String(error) });
    })
  ));
}

export async function createVariant(productId: string, input: VariantCreate, actor: AuthContext, requestId: string) {
  const admin = createAdminSupabaseClient();
  await getAdminProduct(productId);
  const { data, error } = await admin.from("product_variants").insert({ product_id: productId, color_id: input.colorId, label: input.label, sku: input.sku, stock_quantity: input.stockQuantity, low_stock_threshold: input.lowStockThreshold ?? 5, sort_order: input.sortOrder ?? 0 }).select("*").single();
  if (error) throw new ApiError(error.code === "23505" ? 409 : 422, error.code === "23505" ? "VARIANT_EXISTS" : "VALIDATION_ERROR", "Variant could not be created.");
  await audit(actor, "variant.create", "product_variant", data.id, null, data, requestId);
  revalidateTag("products", { expire: 0 });
  return data;
}

export async function updateVariant(productId: string, variantId: string, input: VariantUpdate, actor: AuthContext, requestId: string) {
  const admin = createAdminSupabaseClient();
  const { data: before } = await admin.from("product_variants").select("*").eq("id", variantId).eq("product_id", productId).maybeSingle();
  if (!before) throw new ApiError(404, "NOT_FOUND", "Variant not found.");
  const { expectedVersion, colorId, label, stockQuantity, lowStockThreshold, sortOrder, isActive, ...rest } = input;
  const patch = { ...rest, ...(colorId !== undefined ? { color_id: colorId } : {}), ...(label !== undefined ? { label } : {}), ...(stockQuantity !== undefined ? { stock_quantity: stockQuantity } : {}), ...(lowStockThreshold !== undefined ? { low_stock_threshold: lowStockThreshold } : {}), ...(sortOrder !== undefined ? { sort_order: sortOrder } : {}), ...(isActive !== undefined ? { is_active: isActive } : {}) };
  const { data, error } = await admin.from("product_variants").update(patch).eq("id", variantId).eq("product_id", productId).eq("version", expectedVersion).select("*").maybeSingle();
  if (error?.code === "23505") throw new ApiError(409, "VARIANT_EXISTS", "SKU already exists, or this color and label combination is already in use.");
  if (!data) throw new ApiError(409, "VERSION_CONFLICT", "Variant was changed by another user.");
  await audit(actor, "variant.update", "product_variant", variantId, before, data, requestId);
  revalidateTag("products", { expire: 0 });
  return data;
}

export async function deleteVariant(productId: string, variantId: string, expectedVersion: number, actor: AuthContext, requestId: string) {
  const admin = createAdminSupabaseClient();
  const product = await getAdminProduct(productId);
  const active = product.product_variants?.filter((item: { is_active: boolean; deleted_at: string | null }) => item.is_active && !item.deleted_at) ?? [];
  if (product.status === "published" && active.length <= 1) throw new ApiError(409, "PRODUCT_REQUIRES_VARIANT", "Published product requires an active variant.");
  const { data: before } = await admin.from("product_variants").select("*,product_variant_media(media_asset_id)").eq("id", variantId).eq("product_id", productId).maybeSingle();
  if (!before) throw new ApiError(404, "NOT_FOUND", "Variant not found.");
  const { data } = await admin.from("product_variants").update({ is_active: false, deleted_at: new Date().toISOString() }).eq("id", variantId).eq("version", expectedVersion).select("id").maybeSingle();
  if (!data) throw new ApiError(409, "VERSION_CONFLICT", "Variant was changed by another user.");
  await audit(actor, "variant.delete", "product_variant", variantId, before, null, requestId);
  revalidateTag("products", { expire: 0 });
  const mediaIds = ((before as { product_variant_media?: Array<{ media_asset_id: string }> }).product_variant_media ?? []).map((item) => item.media_asset_id);
  if (mediaIds.length) {
    await admin.from("product_variant_media").delete().eq("product_variant_id", variantId);
    await Promise.all(mediaIds.map((mediaId) =>
      requestMediaDeletion(mediaId, actor).catch((error) => {
        logger.error("media_cleanup_failed", { mediaId, resourceType: "product_variant", resourceId: variantId, error: error instanceof Error ? error.message : String(error) });
      })
    ));
  }
}

async function requireActiveCategory(categoryId: string) {
  const { data } = await createAdminSupabaseClient().from("categories").select("id").eq("id", categoryId).eq("is_active", true).is("deleted_at", null).maybeSingle();
  if (!data) throw new ApiError(422, "CATEGORY_INVALID", "Primary category must be active.");
}

export async function requireReadyMedia(mediaId: string, purposes: Array<"product" | "category" | "hero" | "content" | "avatar">) {
  const admin = createAdminSupabaseClient();
  const { data } = await admin.from("media_assets").select("id,status,purpose").eq("id", mediaId).eq("status", "ready").in("purpose", purposes).is("deleted_at", null).maybeSingle();
  if (!data) throw new ApiError(422, "MEDIA_NOT_READY", `Media asset must be ready and have purpose: ${purposes.join(" or ")}.`);
}

export async function attachProductMedia(productId: string, mediaId: string, input: AttachMedia, actor: AuthContext, requestId: string) {
  await requireReadyMedia(mediaId, ["product"]);
  const admin = createAdminSupabaseClient();
  if (input.isPrimary) await admin.from("product_media").update({ is_primary: false }).eq("product_id", productId);
  const { error } = await admin.from("product_media").upsert({ product_id: productId, media_asset_id: mediaId, position: input.position, is_primary: input.isPrimary, alt_text_override: input.altTextOverride ?? null }, { onConflict: "product_id,media_asset_id" });
  if (error) throw new ApiError(409, "POSITION_CONFLICT", "Media position is already in use.");
  await audit(actor, "product.media.attach", "product", productId, null, { mediaId, ...input }, requestId);
  return getAdminProduct(productId);
}

export async function detachProductMedia(productId: string, mediaId: string, actor: AuthContext, requestId: string) {
  const admin = createAdminSupabaseClient();
  const product = await getAdminProduct(productId);
  const relation = product.product_media?.find((item: { media_asset_id: string }) => item.media_asset_id === mediaId);
  if (!relation) return;
  if (product.status === "published" && relation.is_primary) throw new ApiError(409, "PRODUCT_REQUIRES_IMAGE", "Published product requires a primary image.");
  await admin.from("product_media").delete().eq("product_id", productId).eq("media_asset_id", mediaId);
  await audit(actor, "product.media.detach", "product", productId, relation, null, requestId);
}

// Links an image already in the product's gallery to a specific variant, so selecting
// that variant on the storefront swaps to its own images instead of the shared gallery.
// Unlike attachProductMedia, mediaId must already be a product_media row for this
// product -- there is no separate variant-image upload path.
export async function attachVariantMedia(productId: string, variantId: string, mediaId: string, input: AttachVariantMedia, actor: AuthContext, requestId: string) {
  const admin = createAdminSupabaseClient();
  const product = await getAdminProduct(productId);
  const variant = product.product_variants?.find((item: { id: string }) => item.id === variantId);
  if (!variant) throw new ApiError(404, "NOT_FOUND", "Variant not found.");
  const inGallery = product.product_media?.some((item: { media_asset_id: string }) => item.media_asset_id === mediaId);
  if (!inGallery) throw new ApiError(422, "MEDIA_NOT_IN_GALLERY", "Image must already be part of the product's gallery.");
  const { error } = await admin.from("product_variant_media").upsert({ product_variant_id: variantId, media_asset_id: mediaId, position: input.position }, { onConflict: "product_variant_id,media_asset_id" });
  if (error) throw new ApiError(409, "POSITION_CONFLICT", "Variant image position is already in use.");
  await audit(actor, "variant.media.attach", "product_variant", variantId, null, { mediaId, ...input }, requestId);
  return getAdminProduct(productId);
}

export async function detachVariantMedia(productId: string, variantId: string, mediaId: string, actor: AuthContext, requestId: string) {
  const admin = createAdminSupabaseClient();
  await getAdminProduct(productId);
  await admin.from("product_variant_media").delete().eq("product_variant_id", variantId).eq("media_asset_id", mediaId);
  await audit(actor, "variant.media.detach", "product_variant", variantId, { mediaId }, null, requestId);
}

function contentPatch(input: Partial<ContentCreate>, actor: AuthContext) {
  return {
    ...(input.key !== undefined ? { key: input.key } : {}), ...(input.eyebrow !== undefined ? { eyebrow: input.eyebrow } : {}),
    ...(input.title !== undefined ? { title: input.title } : {}), ...(input.body !== undefined ? { body: input.body } : {}),
    ...(input.mediaAssetId !== undefined ? { media_asset_id: input.mediaAssetId } : {}), ...(input.primaryLabel !== undefined ? { primary_label: input.primaryLabel } : {}),
    ...(input.primaryHref !== undefined ? { primary_href: input.primaryHref } : {}), ...(input.secondaryLabel !== undefined ? { secondary_label: input.secondaryLabel } : {}),
    ...(input.secondaryHref !== undefined ? { secondary_href: input.secondaryHref } : {}), ...(input.startsAt !== undefined ? { starts_at: input.startsAt } : {}),
    ...(input.endsAt !== undefined ? { ends_at: input.endsAt } : {}), ...(input.isActive !== undefined ? { is_active: input.isActive } : {}),
    ...(input.sortOrder !== undefined ? { sort_order: input.sortOrder } : {}), updated_by: actor.userId,
  };
}

export async function listContentBlocks() {
  const { data, error } = await createAdminSupabaseClient().from("content_blocks").select("*").is("deleted_at", null).order("sort_order");
  if (error) throw new ApiError(503, "SERVICE_UNAVAILABLE", "Content blocks could not be loaded.");
  return data ?? [];
}

export async function createContentBlock(input: ContentCreate, actor: AuthContext, requestId: string) {
  if (input.mediaAssetId) await requireReadyMedia(input.mediaAssetId, ["hero", "content"]);
  const admin = createAdminSupabaseClient();
  const { data, error } = await admin.from("content_blocks").insert({ ...contentPatch(input, actor), created_by: actor.userId }).select("*").single();
  if (error) throw new ApiError(error.code === "23505" ? 409 : 422, error.code === "23505" ? "KEY_EXISTS" : "VALIDATION_ERROR", "Content block could not be created.");
  await audit(actor, "content.create", "content_block", data.id, null, data, requestId);
  return data;
}

export async function updateContentBlock(id: string, input: ContentUpdate, actor: AuthContext, requestId: string) {
  if (input.mediaAssetId) await requireReadyMedia(input.mediaAssetId, ["hero", "content"]);
  const admin = createAdminSupabaseClient();
  const { data: before } = await admin.from("content_blocks").select("*").eq("id", id).maybeSingle();
  if (!before) throw new ApiError(404, "NOT_FOUND", "Content block not found.");
  const { expectedVersion, ...fields } = input;
  const { data } = await admin.from("content_blocks").update(contentPatch(fields, actor)).eq("id", id).eq("version", expectedVersion).select("*").maybeSingle();
  if (!data) throw new ApiError(409, "VERSION_CONFLICT", "Content block was changed by another user.");
  await audit(actor, "content.update", "content_block", id, before, data, requestId);
  return data;
}

export async function deleteContentBlock(id: string, expectedVersion: number, actor: AuthContext, requestId: string) {
  const admin = createAdminSupabaseClient();
  const { data: before } = await admin.from("content_blocks").select("*").eq("id", id).maybeSingle();
  if (!before) throw new ApiError(404, "NOT_FOUND", "Content block not found.");
  const { data } = await admin.from("content_blocks").update({ deleted_at: new Date().toISOString(), deleted_by: actor.userId, is_active: false }).eq("id", id).eq("version", expectedVersion).select("id").maybeSingle();
  if (!data) throw new ApiError(409, "VERSION_CONFLICT", "Content block was changed by another user.");
  await audit(actor, "content.delete", "content_block", id, before, null, requestId);
  const mediaAssetId = before.media_asset_id as string | null;
  if (mediaAssetId) {
    await requestMediaDeletion(mediaAssetId, actor).catch((error) => {
      logger.error("media_cleanup_failed", { mediaId: mediaAssetId, resourceType: "content_block", resourceId: id, error: error instanceof Error ? error.message : String(error) });
    });
  }
}

export async function updateUserRole(userId: string, input: RoleUpdate, actor: AuthContext, requestId: string) {
  const admin = createAdminSupabaseClient();
  const [{ data: before }, authUser] = await Promise.all([
    admin.from("user_roles").select("user_id,role").eq("user_id", userId).maybeSingle(),
    admin.auth.admin.getUserById(userId),
  ]);
  if (!before) throw new ApiError(404, "NOT_FOUND", "User role not found.");
  if (authUser.error || !authUser.data.user) throw new ApiError(404, "NOT_FOUND", "Authentication user not found.");
  if (before.role === "admin" && input.role !== "admin") {
    const { count } = await admin.from("user_roles").select("*", { count: "exact", head: true }).eq("role", "admin");
    if ((count ?? 0) <= 1) throw new ApiError(409, "LAST_ADMIN", "The last administrator cannot be demoted.");
  }
  const { data, error } = await admin.from("user_roles").update({ role: input.role, assigned_by: actor.userId, assigned_at: new Date().toISOString() }).eq("user_id", userId).select("user_id,role,assigned_at").single();
  if (error) throw new ApiError(503, "SERVICE_UNAVAILABLE", "User role could not be updated.");
  const metadataResult = await admin.auth.admin.updateUserById(userId, {
    app_metadata: { ...authUser.data.user.app_metadata, app_role: input.role },
  });
  if (metadataResult.error) {
    await admin.from("user_roles").update({ role: before.role, assigned_by: actor.userId, assigned_at: new Date().toISOString() }).eq("user_id", userId);
    throw new ApiError(503, "SERVICE_UNAVAILABLE", "User role metadata could not be updated.");
  }
  await admin.auth.admin.signOut(userId, "global");
  await audit(actor, "user.role.update", "user", userId, before, { ...data, reason: input.reason }, requestId);
  return { userId: data.user_id, role: data.role, assignedAt: data.assigned_at };
}

export async function listAuditLogs(limit: number) {
  const { data, error } = await createAdminSupabaseClient().from("audit_logs").select("*").order("created_at", { ascending: false }).limit(limit);
  if (error) throw new ApiError(503, "SERVICE_UNAVAILABLE", "Audit logs could not be loaded.");
  return data ?? [];
}

export async function listNewsletterSubscriptions(limit: number, status?: string) {
  const admin = createAdminSupabaseClient();
  let query = admin.from("newsletter_subscriptions").select("id,email,status,source,confirmed_at,unsubscribed_at,created_at,updated_at").order("created_at", { ascending: false }).limit(limit);
  if (status) query = query.eq("status", status);
  const { data, error } = await query;
  if (error) throw new ApiError(503, "SERVICE_UNAVAILABLE", "Newsletter subscriptions could not be loaded.");
  return data ?? [];
}
