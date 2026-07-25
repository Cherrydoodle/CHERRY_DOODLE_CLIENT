import "server-only";

import { createAdminSupabaseClient } from "@/lib/supabase/admin";

export type ResolvedOfferPrice = {
  offerId: string;
  offerName: string;
  offerSlug: string;
  discountPercent: number | null;
  offerPriceCents: number;
  endsAt: string | null;
};

type ActiveProductOfferRow = {
  product_id: string;
  offer_id: string;
  offer_name: string;
  offer_slug: string;
  offer_discount_percent: string | number | null;
  offer_price_cents: number;
  offer_ends_at: string | null;
};

// The single read path for "what does an active offer charge for this product right
// now" -- used by cart display and by the checkout money authority alike, so both
// always agree with the price the storefront listing showed. The arithmetic itself
// lives in one place only: the public.offer_price_for SQL function backing this view
// (supabase/migrations/202607250002_offer_pricing.sql). Nothing here recomputes a
// percentage.
export async function resolveOfferPrices(productIds: string[]): Promise<Map<string, ResolvedOfferPrice>> {
  const result = new Map<string, ResolvedOfferPrice>();
  if (productIds.length === 0) return result;
  const admin = createAdminSupabaseClient();
  const { data, error } = await admin
    .from("active_product_offers")
    .select("product_id,offer_id,offer_name,offer_slug,offer_discount_percent,offer_price_cents,offer_ends_at")
    .in("product_id", [...new Set(productIds)]);
  if (error) return result;
  for (const row of (data ?? []) as ActiveProductOfferRow[]) {
    result.set(row.product_id, {
      offerId: row.offer_id,
      offerName: row.offer_name,
      offerSlug: row.offer_slug,
      discountPercent: row.offer_discount_percent === null ? null : Number(row.offer_discount_percent),
      offerPriceCents: row.offer_price_cents,
      endsAt: row.offer_ends_at,
    });
  }
  return result;
}

// Display-only preview of what public.offer_price_for(...) will compute once an
// offer is active in the database -- used by the admin form so a merchandiser sees
// the resulting price while building an offer, before any row exists to query. Must
// stay numerically identical to the SQL function; tests/offers-pricing.test.ts
// asserts the two formulas agree.
export function computeOfferPriceCents(
  currentPriceCents: number,
  pricingMode: "percentage" | "fixed",
  discountPercent: number | null,
  fixedPriceCents: number | null,
): number {
  const candidate = pricingMode === "fixed" && fixedPriceCents != null
    ? fixedPriceCents
    : Math.floor((currentPriceCents * (100 - (discountPercent ?? 0))) / 100);
  return Math.max(1, Math.min(candidate, currentPriceCents));
}
