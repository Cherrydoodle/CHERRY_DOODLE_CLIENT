import "server-only";

import { addCartItem } from "@/features/cart/service";
import type { CartDTO } from "@/features/cart/types";
import { getPublicProductSummaries } from "@/features/catalog/repository";
import type { ProductSummaryDTO } from "@/features/catalog/types";
import { requireUser } from "@/lib/auth/authorization";
import { ApiError } from "@/lib/http/problem";
import { createAdminSupabaseClient } from "@/lib/supabase/admin";

export type WishlistDTO = { items: ProductSummaryDTO[]; count: number; updatedAt: string | null };

export async function getWishlist(): Promise<WishlistDTO> {
  const auth = await requireUser();
  const admin = createAdminSupabaseClient();
  const { data, error } = await admin.from("wishlist_items").select("product_id,created_at").eq("user_id", auth.userId).order("created_at", { ascending: false });
  if (error) throw new ApiError(503, "SERVICE_UNAVAILABLE", "Wishlist could not be loaded.");
  const rows = (data ?? []) as Array<{ product_id: string; created_at: string }>;
  const items = await getPublicProductSummaries(rows.map((row) => row.product_id));
  return { items, count: items.length, updatedAt: rows[0]?.created_at ?? null };
}

export async function addWishlistItem(productId: string) {
  const auth = await requireUser();
  const [product] = await getPublicProductSummaries([productId]);
  if (!product) throw new ApiError(404, "NOT_FOUND", "Product not found.");
  const admin = createAdminSupabaseClient();
  const { error } = await admin.from("wishlist_items").upsert({ user_id: auth.userId, product_id: productId }, { onConflict: "user_id,product_id", ignoreDuplicates: true });
  if (error) throw new ApiError(503, "SERVICE_UNAVAILABLE", "Product could not be saved.");
  const { count } = await admin.from("wishlist_items").select("*", { count: "exact", head: true }).eq("user_id", auth.userId);
  return { saved: true as const, count: count ?? 0 };
}

export async function removeWishlistItem(productId: string) {
  const auth = await requireUser();
  const admin = createAdminSupabaseClient();
  await admin.from("wishlist_items").delete().eq("user_id", auth.userId).eq("product_id", productId);
  const { count } = await admin.from("wishlist_items").select("*", { count: "exact", head: true }).eq("user_id", auth.userId);
  return { saved: false as const, count: count ?? 0 };
}

export async function mergeWishlist(productIds: string[]) {
  const auth = await requireUser();
  const unique = [...new Set(productIds)];
  const publicProducts = await getPublicProductSummaries(unique);
  const admin = createAdminSupabaseClient();
  if (publicProducts.length) {
    const { error } = await admin.from("wishlist_items").upsert(
      publicProducts.map((product) => ({ user_id: auth.userId, product_id: product.id })),
      { onConflict: "user_id,product_id", ignoreDuplicates: true },
    );
    if (error) throw new ApiError(503, "SERVICE_UNAVAILABLE", "Wishlist could not be synchronized.");
  }
  const wishlist = await getWishlist();
  return { ...wishlist, skipped: unique.length - publicProducts.length };
}

export async function moveWishlistItemToCart(productId: string, productVariantId: string | undefined, quantity: number): Promise<{ cart: CartDTO; wishlist: WishlistDTO }> {
  const auth = await requireUser();
  const admin = createAdminSupabaseClient();
  let variantId = productVariantId;
  if (variantId) {
    const { data } = await admin.from("product_variants").select("id").eq("id", variantId).eq("product_id", productId).eq("is_active", true).is("deleted_at", null).maybeSingle();
    if (!data) throw new ApiError(422, "VARIANT_UNAVAILABLE", "The selected product option is unavailable.");
  } else {
    const { data } = await admin.from("product_variants").select("id").eq("product_id", productId).eq("is_active", true).is("deleted_at", null).gt("stock_quantity", 0).order("sort_order").limit(1).maybeSingle();
    variantId = data?.id;
  }
  if (!variantId) throw new ApiError(422, "VARIANT_UNAVAILABLE", "No product option is available.");
  const cart = await addCartItem(variantId, quantity);
  await admin.from("wishlist_items").delete().eq("user_id", auth.userId).eq("product_id", productId);
  return { cart, wishlist: await getWishlist() };
}
