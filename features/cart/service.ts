import "server-only";

import { createHash, randomBytes } from "node:crypto";
import { cookies } from "next/headers";

import type { ProductSummaryDTO } from "@/features/catalog/types";
import { mediaImageDto } from "@/features/media/delivery";
import type { CartDTO } from "@/features/cart/types";
import { optionalAuth, requireUser } from "@/lib/auth/authorization";
import { requireApplicationSecrets } from "@/lib/env.server";
import { ApiError } from "@/lib/http/problem";
import { createAdminSupabaseClient } from "@/lib/supabase/admin";

const GUEST_COOKIE = "cd_guest_cart";
type CartRecord = { id: string; user_id: string | null; guest_token_hash: string | null; updated_at: string };

type RawColor = { id: string; name: string; slug: string; hex_code: string };
type RawMedia = { id: string; storage_key: string; storage_provider: string; alt_text: string; width: number | null; height: number | null; status: string };
type RawProduct = {
  id: string; slug: string; name: string; label: string; base_price_cents: number; sale_price_cents: number | null; currency: string;
  status: string; deleted_at: string | null; aggregate_rating: number | string; review_count: number;
  product_badges: Array<{ badge: "new" | "bestseller" | "sale" }>;
  product_media: Array<{ is_primary: boolean; alt_text_override: string | null; media_assets: RawMedia | RawMedia[] }>;
};
type RawVariant = {
  id: string; sku: string; stock_quantity: number; low_stock_threshold: number; is_active: boolean; deleted_at: string | null;
  colors: RawColor | RawColor[]; products: RawProduct | RawProduct[];
};
type RawCartItem = { id: string; quantity: number; product_variant_id: string };

function one<T>(value: T | T[]) {
  return Array.isArray(value) ? value[0] : value;
}

function guestHash(token: string) {
  const { guestCartPepper } = requireApplicationSecrets();
  return createHash("sha256").update(`${token}:${guestCartPepper}`).digest("hex");
}

async function resolveCart(create: boolean): Promise<{ cart: CartRecord | null; owner: "guest" | "user" }> {
  const auth = await optionalAuth();
  const admin = createAdminSupabaseClient();
  if (auth) {
    const { data } = await admin.from("carts").select("id,user_id,guest_token_hash,updated_at").eq("user_id", auth.userId).eq("status", "active").maybeSingle();
    if (data || !create) return { cart: data as CartRecord | null, owner: "user" };
    const { data: inserted, error } = await admin.from("carts").insert({ user_id: auth.userId, status: "active" }).select("id,user_id,guest_token_hash,updated_at").single();
    if (error) {
      const { data: raced } = await admin.from("carts").select("id,user_id,guest_token_hash,updated_at").eq("user_id", auth.userId).eq("status", "active").single();
      if (!raced) throw new ApiError(503, "SERVICE_UNAVAILABLE", "Cart could not be created.");
      return { cart: raced as CartRecord, owner: "user" };
    }
    return { cart: inserted as CartRecord, owner: "user" };
  }

  const cookieStore = await cookies();
  let token = cookieStore.get(GUEST_COOKIE)?.value;
  if (!token && !create) return { cart: null, owner: "guest" };
  if (!token) token = randomBytes(32).toString("base64url");
  const hash = guestHash(token);
  const { data } = await admin.from("carts").select("id,user_id,guest_token_hash,updated_at").eq("guest_token_hash", hash).eq("status", "active").maybeSingle();
  if (data || !create) return { cart: data as CartRecord | null, owner: "guest" };
  const { data: inserted, error } = await admin.from("carts").insert({ guest_token_hash: hash, status: "active", expires_at: new Date(Date.now() + 30 * 86_400_000).toISOString() }).select("id,user_id,guest_token_hash,updated_at").single();
  if (error || !inserted) throw new ApiError(503, "SERVICE_UNAVAILABLE", "Cart could not be created.");
  cookieStore.set(GUEST_COOKIE, token, { httpOnly: true, secure: process.env.NODE_ENV === "production", sameSite: "lax", path: "/", maxAge: 30 * 86_400 });
  return { cart: inserted as CartRecord, owner: "guest" };
}

function emptyCart(owner: "guest" | "user"): CartDTO {
  return {
    id: null, owner, items: [],
    summary: { currency: "INR", itemCount: 0, subtotalBeforeDiscountCents: 0, discountCents: 0, subtotalCents: 0, shippingCents: null, totalCents: 0 },
    updatedAt: null,
  };
}

// Cart display is lenient about mixed currencies across items; checkout enforces
// a single currency per order (MIXED_CURRENCY_CART) before any payment is created.
function cartCurrency(dtoItems: CartDTO["items"]): string {
  return dtoItems[0]?.product.pricing.currency ?? "INR";
}

function productSummary(product: RawProduct, variant: RawVariant, color: RawColor): ProductSummaryDTO {
  const mediaRelation = product.product_media.find((entry) => entry.is_primary);
  const media = mediaRelation ? one(mediaRelation.media_assets) : undefined;
  const fallback = { id: product.id, alt: product.name, width: 1, height: 1, urls: { thumb: "/favicon.ico", card: "/favicon.ico", detail: "/favicon.ico" } };
  return {
    id: product.id, slug: product.slug, name: product.name, label: product.label,
    pricing: { currency: product.currency, listCents: product.base_price_cents, saleCents: product.sale_price_cents, effectiveCents: product.sale_price_cents ?? product.base_price_cents },
    primaryImage: media && media.status === "ready" && media.storage_provider === "cloudinary" ? mediaImageDto({ id: media.id, storageKey: media.storage_key, alt: mediaRelation?.alt_text_override ?? media.alt_text, width: media.width ?? 1, height: media.height ?? 1 }) : fallback,
    colors: [{ id: color.id, name: color.name, slug: color.slug, hex: color.hex_code }],
    defaultVariantId: variant.id,
    rating: { average: Number(product.aggregate_rating), count: product.review_count },
    badges: product.product_badges.map((badge) => badge.badge),
    availability: variant.stock_quantity <= 0 ? "out_of_stock" : variant.stock_quantity <= variant.low_stock_threshold ? "low_stock" : "in_stock",
  };
}

export async function getCartById(cart: CartRecord, owner: "guest" | "user"): Promise<CartDTO> {
  const admin = createAdminSupabaseClient();
  const { data: rawItems, error } = await admin.from("cart_items").select("id,quantity,product_variant_id").eq("cart_id", cart.id).order("created_at");
  if (error) throw new ApiError(503, "SERVICE_UNAVAILABLE", "Cart could not be loaded.");
  const items = (rawItems ?? []) as RawCartItem[];
  const variantIds = items.map((item) => item.product_variant_id);
  const variantsById = new Map<string, RawVariant>();
  if (variantIds.length) {
    const { data: variants, error: variantsError } = await admin.from("product_variants").select(`
      id,sku,stock_quantity,low_stock_threshold,is_active,deleted_at,
      colors(id,name,slug,hex_code),
      products(id,slug,name,label,base_price_cents,sale_price_cents,currency,status,deleted_at,aggregate_rating,review_count,
        product_badges(badge),
        product_media(is_primary,alt_text_override,media_assets(id,storage_key,storage_provider,alt_text,width,height,status))
      )
    `).in("id", variantIds);
    if (variantsError) throw new ApiError(503, "SERVICE_UNAVAILABLE", "Cart products could not be loaded.");
    for (const variant of (variants ?? []) as unknown as RawVariant[]) variantsById.set(variant.id, variant);
  }

  const dtoItems: CartDTO["items"] = [];
  for (const item of items) {
    const variant = variantsById.get(item.product_variant_id);
    if (!variant) continue;
    const product = one(variant.products);
    const color = one(variant.colors);
    if (!product || !color) continue;
    const unavailable = !variant.is_active || variant.deleted_at !== null || product.status !== "published" || product.deleted_at !== null || variant.stock_quantity <= 0;
    const warning = unavailable ? "out_of_stock" : item.quantity > variant.stock_quantity ? "quantity_reduced" : null;
    const unit = product.sale_price_cents ?? product.base_price_cents;
    dtoItems.push({
      id: item.id, quantity: item.quantity, variant: { id: variant.id, sku: variant.sku, color: { id: color.id, name: color.name, slug: color.slug, hex: color.hex_code } },
      product: productSummary(product, variant, color), unitPriceCents: unit, lineTotalCents: unit * item.quantity,
      originalLineTotalCents: product.base_price_cents * item.quantity, warning,
    });
  }
  const before = dtoItems.reduce((sum, item) => sum + item.originalLineTotalCents, 0);
  const subtotal = dtoItems.reduce((sum, item) => sum + item.lineTotalCents, 0);
  return {
    id: cart.id, owner, items: dtoItems,
    summary: { currency: cartCurrency(dtoItems), itemCount: dtoItems.reduce((sum, item) => sum + item.quantity, 0), subtotalBeforeDiscountCents: before, discountCents: before - subtotal, subtotalCents: subtotal, shippingCents: null, totalCents: subtotal },
    updatedAt: cart.updated_at,
  };
}

export async function getCart(): Promise<CartDTO> {
  const { cart, owner } = await resolveCart(false);
  return cart ? getCartById(cart, owner) : emptyCart(owner);
}

export async function addCartItem(productVariantId: string, quantity: number) {
  const { cart, owner } = await resolveCart(true);
  if (!cart) throw new ApiError(503, "SERVICE_UNAVAILABLE", "Cart could not be created.");
  const admin = createAdminSupabaseClient();
  const { error } = await admin.rpc("cart_add_item_atomic", { p_cart_id: cart.id, p_variant_id: productVariantId, p_quantity: quantity });
  if (error) {
    if (error.message.includes("VARIANT_UNAVAILABLE")) throw new ApiError(422, "VARIANT_UNAVAILABLE", "The selected product option is unavailable.");
    throw new ApiError(503, "SERVICE_UNAVAILABLE", "The item could not be added to the cart.");
  }
  const { data: refreshed } = await admin.from("carts").select("id,user_id,guest_token_hash,updated_at").eq("id", cart.id).single();
  return getCartById(refreshed as CartRecord, owner);
}

export async function setCartItemQuantity(itemId: string, quantity: number) {
  const { cart, owner } = await resolveCart(false);
  if (!cart) throw new ApiError(404, "NOT_FOUND", "Cart item not found.");
  const admin = createAdminSupabaseClient();
  const { error } = await admin.rpc("cart_set_item_quantity_atomic", { p_cart_id: cart.id, p_item_id: itemId, p_quantity: quantity });
  if (error) {
    if (error.message.includes("NOT_FOUND")) throw new ApiError(404, "NOT_FOUND", "Cart item not found.");
    if (error.message.includes("VARIANT_UNAVAILABLE")) throw new ApiError(422, "VARIANT_UNAVAILABLE", "The selected product option is unavailable.");
    throw new ApiError(503, "SERVICE_UNAVAILABLE", "Cart quantity could not be updated.");
  }
  return getCartById(cart, owner);
}

export async function removeCartItem(itemId: string) {
  const { cart, owner } = await resolveCart(false);
  if (!cart) return emptyCart(owner);
  const admin = createAdminSupabaseClient();
  await admin.from("cart_items").delete().eq("id", itemId).eq("cart_id", cart.id);
  await admin.from("carts").update({ updated_at: new Date().toISOString() }).eq("id", cart.id);
  return getCartById(cart, owner);
}

export async function clearCart() {
  const { cart, owner } = await resolveCart(false);
  if (!cart) return;
  const admin = createAdminSupabaseClient();
  await admin.from("cart_items").delete().eq("cart_id", cart.id);
  if (owner === "guest") {
    await admin.from("carts").update({ status: "abandoned", guest_token_hash: null }).eq("id", cart.id);
    (await cookies()).delete(GUEST_COOKIE);
  }
}

export async function claimGuestCart() {
  const auth = await requireUser();
  const cookieStore = await cookies();
  const token = cookieStore.get(GUEST_COOKIE)?.value;
  const admin = createAdminSupabaseClient();
  if (token) {
    const { error } = await admin.rpc("claim_guest_cart_atomic", { p_user_id: auth.userId, p_guest_hash: guestHash(token) });
    if (error) throw new ApiError(503, "SERVICE_UNAVAILABLE", "Guest cart could not be saved.");
    cookieStore.delete(GUEST_COOKIE);
  }
  const { cart } = await resolveCart(true);
  if (!cart) throw new ApiError(503, "SERVICE_UNAVAILABLE", "Cart could not be loaded.");
  return getCartById(cart, "user");
}
