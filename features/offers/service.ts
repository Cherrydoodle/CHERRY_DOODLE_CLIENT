import "server-only";

import { revalidateTag } from "next/cache";
import type { z } from "zod";

import type { AuthContext } from "@/lib/auth/authorization";
import { ApiError } from "@/lib/http/problem";
import { createAdminSupabaseClient } from "@/lib/supabase/admin";
import { audit, readyMediaDto, requireReadyMedia } from "@/features/admin/service";
import { computeOfferPriceCents } from "@/features/offers/pricing";
import type { offerCreateSchema, offerUpdateSchema } from "@/features/offers/schemas";

type OfferCreate = z.infer<typeof offerCreateSchema>;
type OfferUpdate = z.infer<typeof offerUpdateSchema>;
type OfferProductInput = { productId: string; offerPriceCents?: number | null };

export type OfferProductDto = {
  productId: string;
  name: string;
  slug: string;
  basePriceCents: number;
  salePriceCents: number | null;
  currentPriceCents: number;
  offerPriceCents: number;
};

export type OfferDto = {
  id: string;
  name: string;
  slug: string;
  pricingMode: "percentage" | "fixed";
  discountPercent: number | null;
  bannerMediaId: string | null;
  banner: ReturnType<typeof readyMediaDto>;
  startsAt: string | null;
  endsAt: string | null;
  isActive: boolean;
  priority: number;
  version: number;
  createdAt: string;
  updatedAt: string;
  products: OfferProductDto[];
};

const PROJECTION = "*,media_assets(id,status,storage_key,storage_provider,alt_text,width,height),offer_products(product_id,offer_price_cents,products(id,name,slug,base_price_cents,sale_price_cents))";

type RawProduct = { id: string; name: string; slug: string; base_price_cents: number; sale_price_cents: number | null };
type RawOfferProductRow = { product_id: string; offer_price_cents: number | null; products: RawProduct | RawProduct[] | null };

function one<T>(value: T | T[] | null | undefined): T | null {
  return Array.isArray(value) ? (value[0] ?? null) : (value ?? null);
}

function offerProductDto(row: RawOfferProductRow, pricingMode: "percentage" | "fixed", discountPercent: number | null): OfferProductDto | null {
  const product = one(row.products);
  if (!product) return null;
  const currentPriceCents = product.sale_price_cents ?? product.base_price_cents;
  return {
    productId: product.id, name: product.name, slug: product.slug,
    basePriceCents: product.base_price_cents, salePriceCents: product.sale_price_cents,
    currentPriceCents, offerPriceCents: computeOfferPriceCents(currentPriceCents, pricingMode, discountPercent, row.offer_price_cents),
  };
}

function offerDto(row: Record<string, unknown>): OfferDto {
  const pricingMode = row.pricing_mode as "percentage" | "fixed";
  const discountPercent = row.discount_percent === null || row.discount_percent === undefined ? null : Number(row.discount_percent);
  const productRows = (row.offer_products ?? []) as RawOfferProductRow[];
  return {
    id: String(row.id), name: String(row.name), slug: String(row.slug), pricingMode, discountPercent,
    bannerMediaId: row.banner_media_id ? String(row.banner_media_id) : null, banner: readyMediaDto(row.media_assets),
    startsAt: (row.starts_at as string | null) ?? null, endsAt: (row.ends_at as string | null) ?? null,
    isActive: Boolean(row.is_active), priority: Number(row.priority),
    version: Number(row.version), createdAt: row.created_at as string, updatedAt: row.updated_at as string,
    products: productRows.map((item) => offerProductDto(item, pricingMode, discountPercent)).filter((item): item is OfferProductDto => item !== null),
  };
}

// Mirrors validateSale's role in features/admin/service.ts#updateProduct: a
// standalone check callable with either the create payload or an update merged
// against its stored "before" state, so a partial PATCH that omits pricingMode or
// products still gets validated against what the offer will actually look like.
function validateOfferCoherence(pricingMode: "percentage" | "fixed", discountPercent: number | null, products: OfferProductInput[]) {
  if (products.length === 0) throw new ApiError(422, "VALIDATION_ERROR", "An offer needs at least one product.");
  if (pricingMode === "percentage") {
    if (discountPercent == null) throw new ApiError(422, "VALIDATION_ERROR", "A percentage offer requires a discount percent.");
    if (products.some((product) => product.offerPriceCents != null)) throw new ApiError(422, "VALIDATION_ERROR", "Per-product prices are only used in fixed pricing mode.");
  } else {
    if (discountPercent != null) throw new ApiError(422, "VALIDATION_ERROR", "Fixed-price offers do not use a discount percent.");
    if (products.some((product) => product.offerPriceCents == null)) throw new ApiError(422, "VALIDATION_ERROR", "Every product needs an offer price in fixed pricing mode.");
  }
}

async function requireExistingProducts(productIds: string[]) {
  if (productIds.length === 0) return;
  const admin = createAdminSupabaseClient();
  const { data } = await admin.from("products").select("id").in("id", productIds).is("deleted_at", null);
  const found = new Set((data ?? []).map((row) => row.id as string));
  const missing = productIds.filter((id) => !found.has(id));
  if (missing.length) throw new ApiError(422, "PRODUCT_INVALID", "One or more selected products are unavailable.");
}

function offerPatch(input: Partial<Omit<OfferCreate, "products">>, actor: AuthContext) {
  return {
    ...(input.name !== undefined ? { name: input.name } : {}), ...(input.slug !== undefined ? { slug: input.slug } : {}),
    ...(input.pricingMode !== undefined ? { pricing_mode: input.pricingMode } : {}), ...(input.discountPercent !== undefined ? { discount_percent: input.discountPercent } : {}),
    ...(input.bannerMediaId !== undefined ? { banner_media_id: input.bannerMediaId } : {}), ...(input.startsAt !== undefined ? { starts_at: input.startsAt } : {}),
    ...(input.endsAt !== undefined ? { ends_at: input.endsAt } : {}), ...(input.isActive !== undefined ? { is_active: input.isActive } : {}),
    ...(input.priority !== undefined ? { priority: input.priority } : {}), updated_by: actor.userId,
  };
}

export async function listOffers(options: { includeDeleted: boolean; query?: string; page: number; limit: number }) {
  const admin = createAdminSupabaseClient();
  let query = admin.from("offers").select(PROJECTION, { count: "exact" });
  if (!options.includeDeleted) query = query.is("deleted_at", null);
  if (options.query) query = query.ilike("name", `%${options.query}%`);
  const start = (options.page - 1) * options.limit;
  const { data, error, count } = await query.order("priority", { ascending: false }).order("created_at", { ascending: false }).range(start, start + options.limit - 1);
  if (error) throw new ApiError(503, "SERVICE_UNAVAILABLE", "Offers could not be loaded.");
  return { items: (data ?? []).map((row) => offerDto(row)), total: count ?? 0, page: options.page, limit: options.limit };
}

export async function getOffer(id: string) {
  const admin = createAdminSupabaseClient();
  const { data, error } = await admin.from("offers").select(PROJECTION).eq("id", id).is("deleted_at", null).maybeSingle();
  if (error) throw new ApiError(503, "SERVICE_UNAVAILABLE", "Offer could not be loaded.");
  if (!data) throw new ApiError(404, "NOT_FOUND", "Offer not found.");
  return offerDto(data);
}

// Two round trips (offer row, then junction rows) rather than a single RPC: offers
// are a marketing overlay, not the checkout money authority (features/checkout/
// service.ts is), so the same manual-rollback-on-failure pattern used for checkout
// session creation (features/checkout/service.ts's itemInsert handling) is enough
// to avoid an orphaned offer with zero products.
export async function createOffer(input: OfferCreate, actor: AuthContext, requestId: string) {
  validateOfferCoherence(input.pricingMode, input.discountPercent ?? null, input.products);
  await requireExistingProducts(input.products.map((product) => product.productId));
  if (input.bannerMediaId) await requireReadyMedia(input.bannerMediaId, ["hero", "content"]);

  const admin = createAdminSupabaseClient();
  const { data: offer, error } = await admin.from("offers").insert({
    name: input.name, slug: input.slug, pricing_mode: input.pricingMode, discount_percent: input.discountPercent ?? null,
    banner_media_id: input.bannerMediaId ?? null, starts_at: input.startsAt ?? null, ends_at: input.endsAt ?? null,
    is_active: input.isActive, priority: input.priority, created_by: actor.userId, updated_by: actor.userId,
  }).select("id").single();
  if (error) {
    if (error.code === "23505") throw new ApiError(409, "SLUG_EXISTS", "Offer slug already exists.");
    throw new ApiError(422, "VALIDATION_ERROR", "Offer could not be created.");
  }

  const { error: productsError } = await admin.from("offer_products").insert(
    input.products.map((product) => ({ offer_id: offer.id, product_id: product.productId, offer_price_cents: product.offerPriceCents ?? null })),
  );
  if (productsError) {
    await admin.from("offers").delete().eq("id", offer.id);
    throw new ApiError(422, "VALIDATION_ERROR", "Offer products could not be saved.");
  }

  await audit(actor, "offer.create", "offer", offer.id, null, { id: offer.id }, requestId);
  revalidateTag("products", { expire: 0 });
  revalidateTag("offers", { expire: 0 });
  return getOffer(offer.id);
}

export async function updateOffer(id: string, input: OfferUpdate, actor: AuthContext, requestId: string) {
  const admin = createAdminSupabaseClient();
  const before = await getOffer(id);

  const effectiveMode = input.pricingMode ?? before.pricingMode;
  const effectiveDiscount = input.discountPercent !== undefined ? input.discountPercent : before.discountPercent;
  const effectiveProducts: OfferProductInput[] = input.products ?? before.products.map((product) => ({
    productId: product.productId,
    offerPriceCents: before.pricingMode === "fixed" ? product.offerPriceCents : null,
  }));
  validateOfferCoherence(effectiveMode, effectiveDiscount ?? null, effectiveProducts);

  if (input.bannerMediaId) await requireReadyMedia(input.bannerMediaId, ["hero", "content"]);
  if (input.products) await requireExistingProducts(input.products.map((product) => product.productId));

  const { expectedVersion, products, ...fields } = input;
  const { data, error } = await admin.from("offers").update(offerPatch(fields, actor)).eq("id", id).eq("version", expectedVersion).select("id").maybeSingle();
  if (error?.code === "23505") throw new ApiError(409, "SLUG_EXISTS", "Offer slug already exists.");
  if (!data) throw new ApiError(409, "VERSION_CONFLICT", "Offer was changed by another user.");

  if (products) {
    const currentIds = new Set(before.products.map((product) => product.productId));
    const nextIds = new Set(products.map((product) => product.productId));
    const toDelete = [...currentIds].filter((productId) => !nextIds.has(productId));
    if (toDelete.length) await admin.from("offer_products").delete().eq("offer_id", id).in("product_id", toDelete);
    const { error: upsertError } = await admin.from("offer_products").upsert(
      products.map((product) => ({ offer_id: id, product_id: product.productId, offer_price_cents: product.offerPriceCents ?? null })),
      { onConflict: "offer_id,product_id" },
    );
    if (upsertError) throw new ApiError(422, "VALIDATION_ERROR", "Offer products could not be saved.");
  }

  const after = await getOffer(id);
  await audit(actor, "offer.update", "offer", id, before, after, requestId);
  revalidateTag("products", { expire: 0 });
  revalidateTag("offers", { expire: 0 });
  return after;
}

export async function deleteOffer(id: string, expectedVersion: number, actor: AuthContext, requestId: string) {
  const admin = createAdminSupabaseClient();
  const before = await getOffer(id);
  const { data } = await admin.from("offers").update({ deleted_at: new Date().toISOString(), deleted_by: actor.userId, is_active: false, updated_by: actor.userId }).eq("id", id).eq("version", expectedVersion).select("id").maybeSingle();
  if (!data) throw new ApiError(409, "VERSION_CONFLICT", "Offer was changed by another user.");
  await audit(actor, "offer.delete", "offer", id, before, null, requestId);
  revalidateTag("products", { expire: 0 });
  revalidateTag("offers", { expire: 0 });
}

// Cache-freshness optimisation, not a correctness mechanism: active_product_offers
// (supabase/migrations/202607250002_offer_pricing.sql) already gates offers with
// now() predicates, and checkout always re-prices live, so an unrevalidated cache
// can never cause a wrong charge -- only a stale display for up to
// unstable_cache's 5-minute revalidate window. This just tightens that window by
// pushing an immediate revalidation whenever an offer's starts_at/ends_at fell
// within the last run's interval (with a one-minute margin for cron jitter), the
// same way an admin create/edit already does via revalidateTag.
export async function revalidateOfferScheduleBoundaries(): Promise<{ crossedBoundaries: number }> {
  const admin = createAdminSupabaseClient();
  const windowStart = new Date(Date.now() - 6 * 60_000).toISOString();
  const now = new Date().toISOString();
  const { count } = await admin
    .from("offers")
    .select("id", { count: "exact", head: true })
    .is("deleted_at", null)
    .or(`and(starts_at.gte.${windowStart},starts_at.lte.${now}),and(ends_at.gte.${windowStart},ends_at.lte.${now})`);
  const crossedBoundaries = count ?? 0;
  if (crossedBoundaries > 0) {
    revalidateTag("products", { expire: 0 });
    revalidateTag("offers", { expire: 0 });
  }
  return { crossedBoundaries };
}
