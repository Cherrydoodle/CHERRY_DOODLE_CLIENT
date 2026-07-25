import "server-only";

import type { PostgrestError } from "@supabase/supabase-js";
import { unstable_cache } from "next/cache";
import { z } from "zod";

import { mediaImageDto } from "@/features/media/delivery";
import { decodeCursor, encodeCursor } from "@/features/catalog/cursor";
import { staticCategories, staticHome, staticListProducts, staticProductDetail } from "@/features/catalog/static-repository";
import type { Availability, CategoryDTO, HomeDTO, MarqueeItemDTO, ProductDetailDTO, ProductFilters, ProductListDTO, ProductSummaryDTO, ReelDTO } from "@/features/catalog/types";
import { ApiError } from "@/lib/http/problem";
import { getPublicSupabaseConfig } from "@/lib/public-env";
// Public catalog reads use the service-role client rather than the cookie-based one: this data is
// unpersonalized (access is already scoped by explicit status/deleted_at filters, not by RLS on the
// caller's session), and cookies() is a dynamic API that would force every page depending on these
// functions - including the root layout's nav and SSG'd product pages - into per-request rendering.
import { createAdminSupabaseClient } from "@/lib/supabase/admin";
import { logger } from "@/lib/observability/logger";

// A bare "X could not be loaded." says nothing about whether the query hit a bad
// API key, a missing relation, or an unreachable host — and ApiError.message is
// echoed to clients verbatim by toProblem, so the Postgrest detail can't live
// there. It goes to the server log and onto `cause` instead. That matters most
// during `next build`: generateStaticParams and the prerender pass both call into
// this file, and Next prints the thrown error (cause chain included) as the sole
// record of why a deploy failed.
function catalogUnavailable(operation: string, message: string, error: PostgrestError): ApiError {
  logger.error("Catalog query failed", {
    operation,
    supabaseCode: error.code,
    supabaseMessage: error.message,
    supabaseDetails: error.details,
    supabaseHint: error.hint,
  });
  return new ApiError(503, "SERVICE_UNAVAILABLE", message, undefined, { cause: error });
}

const colorSchema = z.object({
  id: z.string().uuid(), name: z.string(), slug: z.string(), hex: z.string(), variantId: z.string().uuid(), sku: z.string(),
  stockQuantity: z.number().int().nonnegative(), lowStockThreshold: z.number().int().nonnegative(),
});

const productRowSchema = z.object({
  id: z.string().uuid(), slug: z.string(), name: z.string(), label: z.string(), description: z.string(), material: z.string(), size: z.string(),
  base_price_cents: z.number().int(), sale_price_cents: z.number().int().nullable(), effective_price_cents: z.number().int(), currency: z.string().length(3),
  aggregate_rating: z.coerce.number(), review_count: z.number().int(), media_id: z.string().uuid(), storage_key: z.string(),
  alt_text: z.string(), width: z.number().int().nullable(), height: z.number().int().nullable(), colors: z.array(colorSchema),
  availability: z.enum(["in_stock", "low_stock", "out_of_stock"]), badges: z.array(z.enum(["new", "bestseller", "sale"])),
  subcategory_slug: z.string(), subcategory_name: z.string(), top_category_slug: z.string(), top_category_name: z.string(),
  offer_id: z.string().uuid().nullable(), offer_name: z.string().nullable(), offer_slug: z.string().nullable(),
  offer_discount_percent: z.union([z.string(), z.number()]).nullable(), offer_price_cents: z.number().int().nullable(), offer_ends_at: z.string().nullable(),
});

const categoryRowSchema = z.object({
  id: z.string().uuid(), slug: z.string(), name: z.string(), description: z.string(), emoji: z.string().nullable(),
  seo_title: z.string().nullable(), seo_description: z.string().nullable(), media_id: z.string().uuid().nullable(),
  storage_key: z.string().nullable(), alt_text: z.string().nullable(), width: z.number().int().nullable(), height: z.number().int().nullable(),
  subcategories: z.array(z.object({ id: z.string().uuid(), slug: z.string(), name: z.string() })),
});

type ProductRow = z.infer<typeof productRowSchema>;

function summaryFromRow(input: unknown): ProductSummaryDTO {
  const row = productRowSchema.parse(input);
  const defaultColor = row.colors.find((color) => color.stockQuantity > 0) ?? row.colors[0];
  const offer = row.offer_id
    ? { id: row.offer_id, name: row.offer_name ?? "", slug: row.offer_slug ?? "", discountPercent: row.offer_discount_percent === null ? null : Number(row.offer_discount_percent), endsAt: row.offer_ends_at }
    : null;
  return {
    id: row.id,
    slug: row.slug,
    name: row.name,
    label: row.label,
    // saleCents drives the storefront's struck-through-price display (ProductCard.tsx);
    // an active offer price takes priority over the manual sale price so the whole
    // storefront picks it up with no component changes. effectiveCents is read
    // straight from the view's precomputed column rather than re-derived here, so
    // there is exactly one place (public.offer_price_for in SQL) doing the arithmetic.
    pricing: { currency: row.currency, listCents: row.base_price_cents, saleCents: row.offer_price_cents ?? row.sale_price_cents, effectiveCents: row.effective_price_cents, offer },
    primaryImage: mediaImageDto({ id: row.media_id, storageKey: row.storage_key, alt: row.alt_text, width: row.width ?? 1, height: row.height ?? 1 }),
    colors: row.colors.map((color) => ({ id: color.id, name: color.name, slug: color.slug, hex: color.hex })),
    defaultVariantId: defaultColor?.variantId ?? null,
    rating: { average: row.aggregate_rating, count: row.review_count },
    badges: row.badges,
    availability: row.availability,
  };
}

async function fetchCategories(): Promise<CategoryDTO[]> {
  const supabase = createAdminSupabaseClient();
  const { data, error } = await supabase.from("public_category_tree").select("*").order("sort_order");
  if (error) throw catalogUnavailable("fetchCategories", "Categories could not be loaded.", error);
  return (data ?? []).map((input) => {
    const row = categoryRowSchema.parse(input);
    return {
      id: row.id, slug: row.slug, name: row.name, description: row.description, emoji: row.emoji,
      image: row.media_id && row.storage_key ? mediaImageDto({ id: row.media_id, storageKey: row.storage_key, alt: row.alt_text ?? row.name, width: row.width ?? 1, height: row.height ?? 1 }) : null,
      seo: { title: row.seo_title, description: row.seo_description }, subcategories: row.subcategories,
    };
  });
}

// Public catalog pages have no request-time APIs on their path, so Next.js would
// otherwise cache this fetch indefinitely (until the next deploy) per the default
// fetchCache heuristic. Wrapping it in unstable_cache with a tag lets the admin
// panel's category mutations (features/admin/service.ts) call revalidateTag("categories")
// to push changes live immediately, with a 5-minute revalidate as a safety net.
const cachedListCategories = unstable_cache(fetchCategories, ["catalog-categories"], { tags: ["categories"], revalidate: 300 });

export async function listCategories(): Promise<CategoryDTO[]> {
  if (!getPublicSupabaseConfig()) return staticCategories();
  return cachedListCategories();
}

// Public, unauthenticated read of active top-strip messages. Uses the service-role
// client for the same reason as listCategories/getHome: unpersonalized content that
// must not force the root layout into per-request rendering via cookies(). Falls
// back to an empty list (Header renders its own hardcoded defaults) rather than
// throwing, so a marquee outage never takes down every page.
export async function listMarquee(): Promise<MarqueeItemDTO[]> {
  if (!getPublicSupabaseConfig()) return [];
  const supabase = createAdminSupabaseClient();
  const { data, error } = await supabase
    .from("content_blocks")
    .select("id,title,primary_href,starts_at,ends_at")
    .like("key", "home.marquee.%")
    .eq("is_active", true)
    .is("deleted_at", null)
    .order("sort_order")
    .order("created_at");
  if (error) return [];
  const now = Date.now();
  return (data ?? [])
    .filter((row) => (!row.starts_at || new Date(row.starts_at).getTime() <= now) && (!row.ends_at || new Date(row.ends_at).getTime() >= now))
    .map((row) => ({ id: String(row.id), text: String(row.title), link: row.primary_href ? String(row.primary_href) : null }));
}

// Public, unauthenticated read of active Instagram reels for the homepage. Same
// service-role + graceful-empty-fallback rationale as listMarquee: content that must
// not force per-request rendering and must never take a page down on an outage.
export async function listReels(): Promise<ReelDTO[]> {
  if (!getPublicSupabaseConfig()) return [];
  const supabase = createAdminSupabaseClient();
  const { data, error } = await supabase
    .from("content_blocks")
    .select("id,body,primary_href,starts_at,ends_at")
    .like("key", "home.reel.%")
    .eq("is_active", true)
    .is("deleted_at", null)
    .order("sort_order")
    .order("created_at");
  if (error) return [];
  const now = Date.now();
  return (data ?? [])
    .filter((row) => row.primary_href && (!row.starts_at || new Date(row.starts_at).getTime() <= now) && (!row.ends_at || new Date(row.ends_at).getTime() >= now))
    .map((row) => ({ id: String(row.id), reelUrl: String(row.primary_href), caption: row.body ? String(row.body) : null }));
}

async function fetchProducts(filters: ProductFilters): Promise<ProductListDTO> {
  const offset = decodeCursor(filters.cursor);
  const supabase = createAdminSupabaseClient();
  let query = supabase.from("public_product_cards").select("*", { count: "exact" });
  if (filters.category) query = query.eq("top_category_slug", filters.category);
  if (filters.sub) query = query.eq("subcategory_slug", filters.sub);
  // A product discounted only by a live offer (no manual sale_price_cents) must
  // still show up under "Sale" -- otherwise it would display a discount everywhere
  // except the one filter/link (Header.tsx's "Sale" link) meant to find it.
  if (filters.sale) query = query.or("sale_price_cents.not.is.null,offer_id.not.is.null");
  if (filters.offer) query = query.not("offer_id", "is", null);
  if (filters.isNew) query = query.contains("badges", ["new"]);
  if (filters.bestseller) query = query.contains("badges", ["bestseller"]);
  if (filters.color) query = query.contains("color_slugs", [filters.color]);
  if (filters.priceMaxCents) query = query.lte("effective_price_cents", filters.priceMaxCents);
  if (filters.q) query = query.textSearch("search_document", filters.q, { config: "simple", type: "websearch" });

  if (filters.sort === "newest") query = query.order("published_at", { ascending: false }).order("id");
  else if (filters.sort === "price-asc") query = query.order("effective_price_cents", { ascending: true }).order("id");
  else if (filters.sort === "price-desc") query = query.order("effective_price_cents", { ascending: false }).order("id");
  else if (filters.sort === "rating") query = query.order("aggregate_rating", { ascending: false }).order("id");
  else query = query.order("featured_sort_order", { ascending: true, nullsFirst: false }).order("id");

  const { data, error, count } = await query.range(offset, offset + filters.limit - 1);
  if (error) throw catalogUnavailable("listProducts", "Products could not be loaded.", error);
  const items = (data ?? []).map(summaryFromRow);
  const total = count ?? items.length;
  return { items, total, nextCursor: offset + items.length < total ? encodeCursor(offset + items.length) : null };
}

// See fetchCategories above for why this is cached and tagged rather than left to the
// default fetch heuristic: without it, product listings freeze at whatever they were
// at the last deploy and admin edits never reach the storefront on their own.
const cachedListProducts = unstable_cache(fetchProducts, ["catalog-products"], { tags: ["products"], revalidate: 300 });

export async function listProducts(filters: ProductFilters): Promise<ProductListDTO> {
  if (!getPublicSupabaseConfig()) return staticListProducts(filters);
  return cachedListProducts(filters);
}

export type CategoryFacetColor = { id: string; name: string; slug: string; hex: string };
export type CategoryFacets = { colors: CategoryFacetColor[]; maxPriceCents: number };

async function fetchCategoryFacets(input: { category?: string; sub?: string }): Promise<CategoryFacets> {
  const supabase = createAdminSupabaseClient();
  let query = supabase.from("public_product_cards").select("colors,effective_price_cents");
  if (input.category) query = query.eq("top_category_slug", input.category);
  if (input.sub) query = query.eq("subcategory_slug", input.sub);
  const { data, error } = await query;
  if (error) return { colors: [], maxPriceCents: 0 };
  const colors = new Map<string, CategoryFacetColor>();
  let maxPriceCents = 0;
  for (const row of (data ?? []) as Array<{ colors: CategoryFacetColor[] | null; effective_price_cents: number | null }>) {
    maxPriceCents = Math.max(maxPriceCents, Number(row.effective_price_cents ?? 0));
    for (const color of row.colors ?? []) {
      if (color?.slug && !colors.has(color.slug)) colors.set(color.slug, { id: color.id, name: color.name, slug: color.slug, hex: color.hex });
    }
  }
  return { colors: [...colors.values()], maxPriceCents };
}

// Cached/tagged like the other catalog reads so admin catalog edits (revalidateTag("products"))
// refresh the sidebar's colour swatches and price ceiling alongside the product listings.
const cachedCategoryFacets = unstable_cache(fetchCategoryFacets, ["catalog-category-facets"], { tags: ["products"], revalidate: 300 });

export async function getCategoryFacets(input: { category?: string; sub?: string }): Promise<CategoryFacets> {
  if (!getPublicSupabaseConfig()) {
    const items = staticListProducts({ category: input.category, sub: input.sub, sort: "featured", limit: 1000 }).items;
    const colors = new Map<string, CategoryFacetColor>();
    let maxPriceCents = 0;
    for (const item of items) {
      maxPriceCents = Math.max(maxPriceCents, item.pricing.effectiveCents);
      for (const color of item.colors) if (!colors.has(color.slug)) colors.set(color.slug, color);
    }
    return { colors: [...colors.values()], maxPriceCents };
  }
  return cachedCategoryFacets(input);
}

export async function getPublicProductSummaries(productIds: string[]): Promise<ProductSummaryDTO[]> {
  if (productIds.length === 0) return [];
  if (!getPublicSupabaseConfig()) {
    const all = staticListProducts({ sort: "featured", limit: 100 }).items;
    const wanted = new Set(productIds);
    return all.filter((item) => wanted.has(item.id));
  }
  const supabase = createAdminSupabaseClient();
  const { data, error } = await supabase.from("public_product_cards").select("*").in("id", productIds);
  if (error) throw catalogUnavailable("listProductsByIds", "Products could not be loaded.", error);
  const byId = new Map((data ?? []).map((row) => {
    const summary = summaryFromRow(row);
    return [summary.id, summary] as const;
  }));
  return productIds.flatMap((id) => {
    const product = byId.get(id);
    return product ? [product] : [];
  });
}

async function fetchProductDetail(slug: string): Promise<ProductDetailDTO | null> {
  const supabase = createAdminSupabaseClient();
  const { data, error } = await supabase.from("public_product_cards").select("*").eq("slug", slug).maybeSingle();
  if (error) throw catalogUnavailable("fetchProductDetail", "Product could not be loaded.", error);
  if (!data) return null;
  const row: ProductRow = productRowSchema.parse(data);
  const summary = summaryFromRow(row);
  const { data: mediaRows, error: mediaError } = await supabase
    .from("product_media")
    .select("position,alt_text_override,media_assets!inner(id,storage_key,storage_provider,alt_text,width,height,status)")
    .eq("product_id", row.id)
    .order("position");
  if (mediaError) throw catalogUnavailable("fetchProductMedia", "Product media could not be loaded.", mediaError);
  const gallery = (mediaRows ?? []).flatMap((entry) => {
    const media = Array.isArray(entry.media_assets) ? entry.media_assets[0] : entry.media_assets;
    if (!media || media.status !== "ready" || media.storage_provider !== "cloudinary") return [];
    return [mediaImageDto({ id: media.id, storageKey: media.storage_key, alt: entry.alt_text_override ?? media.alt_text, width: media.width ?? 1, height: media.height ?? 1 })];
  });
  const related = await listProducts({ category: row.top_category_slug, sort: "featured", limit: 5 });
  return {
    ...summary,
    description: row.description,
    material: row.material,
    size: row.size,
    category: { slug: row.subcategory_slug, name: row.subcategory_name, parent: { slug: row.top_category_slug, name: row.top_category_name } },
    gallery: gallery.length ? gallery : [summary.primaryImage],
    variants: row.colors.map((color) => ({
      id: color.variantId,
      sku: color.sku,
      color: { id: color.id, name: color.name, slug: color.slug, hex: color.hex },
      availability: (color.stockQuantity <= 0 ? "out_of_stock" : color.stockQuantity <= color.lowStockThreshold ? "low_stock" : "in_stock") as Availability,
      maxQuantity: Math.min(99, color.stockQuantity),
    })),
    shippingMessage: "Shipping is calculated at checkout. We ship across India via Delhivery, dispatched in 1–2 business days.",
    returnsMessage: "Returns within 7 days for unused items in original packaging (damaged or wrong items).",
    related: related.items.filter((item) => item.id !== row.id).slice(0, 4),
  };
}

// See fetchCategories above for why this is cached and tagged.
const cachedGetProductDetail = unstable_cache(fetchProductDetail, ["catalog-product-detail"], { tags: ["products"], revalidate: 300 });

export async function getProductDetail(slug: string): Promise<ProductDetailDTO | null> {
  if (!getPublicSupabaseConfig()) return staticProductDetail(slug);
  return cachedGetProductDetail(slug);
}

const CONTENT_BLOCK_COLUMNS = "id,key,eyebrow,title,body,primary_label,primary_href,secondary_label,secondary_href,starts_at,ends_at,media_assets(id,storage_key,storage_provider,alt_text,width,height,status)";

// A banner row is live once published (is_active, not soft-deleted) AND within its
// optional starts_at/ends_at window. Filtered here in JS rather than via chained
// PostgREST .or() calls, which don't reliably AND together with other filters.
function isWithinSchedule(row: { starts_at: string | null; ends_at: string | null }): boolean {
  const now = Date.now();
  if (row.starts_at && new Date(row.starts_at).getTime() > now) return false;
  if (row.ends_at && new Date(row.ends_at).getTime() < now) return false;
  return true;
}

async function getContentBlock(key: string) {
  if (!getPublicSupabaseConfig()) return null;
  const supabase = createAdminSupabaseClient();
  const { data } = await supabase
    .from("content_blocks")
    .select(CONTENT_BLOCK_COLUMNS)
    .eq("key", key)
    .eq("is_active", true)
    .is("deleted_at", null)
    .maybeSingle();
  return data && isWithinSchedule(data) ? data : null;
}

// Homepage hero slider: the legacy singleton "home.hero" plus any admin-created
// "home.banner.*" rows, active and in-schedule, ordered the same way the admin
// banner list orders them.
async function listActiveHeroBanners() {
  if (!getPublicSupabaseConfig()) return [];
  const supabase = createAdminSupabaseClient();
  const { data, error } = await supabase
    .from("content_blocks")
    .select(CONTENT_BLOCK_COLUMNS)
    .or("key.eq.home.hero,key.like.home.banner.%")
    .eq("is_active", true)
    .is("deleted_at", null)
    .order("sort_order")
    .order("created_at");
  if (error) throw catalogUnavailable("listBanners", "Banners could not be loaded.", error);
  return (data ?? []).filter(isWithinSchedule);
}

// Bestsellers/New Arrivals should always show exactly 4 cards even when fewer than 4
// products currently carry that badge, so a spare pool (sorted the same way as
// "Featured for you") backfills the gap without repeating a product within a section.
function backfillTo(primary: ProductSummaryDTO[], pool: ProductSummaryDTO[], target: number): ProductSummaryDTO[] {
  if (primary.length >= target) return primary.slice(0, target);
  const seen = new Set(primary.map((product) => product.id));
  const filled = [...primary];
  for (const product of pool) {
    if (filled.length >= target) break;
    if (seen.has(product.id)) continue;
    seen.add(product.id);
    filled.push(product);
  }
  return filled;
}

export async function getHome(): Promise<HomeDTO> {
  if (!getPublicSupabaseConfig()) return staticHome();
  const [categories, bestsellers, newArrivals, saleProducts, featuredPool, heroBannerRows, saleBanner] = await Promise.all([
    listCategories(),
    listProducts({ bestseller: true, sort: "featured", limit: 4 }),
    listProducts({ isNew: true, sort: "newest", limit: 4 }),
    listProducts({ sale: true, sort: "featured", limit: 4 }),
    listProducts({ sort: "featured", limit: 24 }),
    listActiveHeroBanners(),
    getContentBlock("home.sale-banner"),
  ]);
  const fallback = staticHome();
  const blockImage = (block: { media_assets: unknown } | null) => {
    const media = block && (Array.isArray(block.media_assets) ? block.media_assets[0] : block.media_assets) as Record<string, unknown> | null;
    return media && media.status === "ready" && media.storage_provider === "cloudinary" ? mediaImageDto({ id: String(media.id), storageKey: String(media.storage_key), alt: String(media.alt_text), width: Number(media.width ?? 1), height: Number(media.height ?? 1) }) : null;
  };
  return {
    heroBanners: heroBannerRows.length > 0 ? heroBannerRows.map((row) => ({
      id: String(row.id), eyebrow: row.eyebrow ?? "", title: row.title, body: row.body ?? "",
      primaryLabel: row.primary_label ?? "Shop", primaryHref: row.primary_href ?? "/",
      secondaryLabel: row.secondary_label, secondaryHref: row.secondary_href, image: blockImage(row),
    })) : fallback.heroBanners,
    saleBanner: saleBanner ? {
      eyebrow: saleBanner.eyebrow ?? "", title: saleBanner.title, body: saleBanner.body ?? "", primaryLabel: saleBanner.primary_label ?? "Shop",
      primaryHref: saleBanner.primary_href ?? "/", image: blockImage(saleBanner),
    } : fallback.saleBanner,
    categories,
    bestsellers: backfillTo(bestsellers.items, featuredPool.items, 4),
    newArrivals: backfillTo(newArrivals.items, featuredPool.items, 4),
    saleProducts: saleProducts.items,
    featured: featuredPool.items.slice(0, 8),
    serviceMessages: fallback.serviceMessages,
  };
}

// Build-time helpers (generateStaticParams, sitemap) run without a request, so they
// cannot use the cookie-based client. These use the service-role client instead and
// return slugs only — never used to render page content.
export async function listAllProductSlugs(): Promise<string[]> {
  if (!getPublicSupabaseConfig()) return [];
  try {
    const admin = createAdminSupabaseClient();
    const { data, error } = await admin.from("products").select("slug").eq("status", "published").is("deleted_at", null);
    if (error) throw error;
    return (data ?? []).map((row) => row.slug as string);
  } catch (err) {
    logger.warn("listAllProductSlugs: Supabase query failed at build time, skipping static generation (pages will be ISR'd on first request)", { error: String(err) });
    return [];
  }
}

export async function listAllCategorySlugs(): Promise<string[]> {
  if (!getPublicSupabaseConfig()) return [];
  try {
    const admin = createAdminSupabaseClient();
    const { data, error } = await admin.from("categories").select("slug").is("parent_id", null).eq("is_active", true).is("deleted_at", null);
    if (error) throw error;
    return (data ?? []).map((row) => row.slug as string);
  } catch (err) {
    logger.warn("listAllCategorySlugs: Supabase query failed at build time, skipping static generation (pages will be ISR'd on first request)", { error: String(err) });
    return [];
  }
}
