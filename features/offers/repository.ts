import "server-only";

import { unstable_cache } from "next/cache";

import type { ImageDTO } from "@/features/catalog/types";
import { resolveReadyMediaImage } from "@/features/media/delivery";
import { getPublicSupabaseConfig } from "@/lib/public-env";
import { createAdminSupabaseClient } from "@/lib/supabase/admin";

export type OfferSummaryDTO = {
  id: string;
  name: string;
  slug: string;
  discountPercent: number | null;
  banner: ImageDTO | null;
  endsAt: string | null;
  productCount: number;
};

// Filtered in JS rather than via chained PostgREST .or() calls for the same reason
// as catalog/repository.ts#isWithinSchedule: they don't reliably AND together with
// the other filters on this query.
function isWithinSchedule(row: { starts_at: string | null; ends_at: string | null }): boolean {
  const now = Date.now();
  if (row.starts_at && new Date(row.starts_at).getTime() > now) return false;
  if (row.ends_at && new Date(row.ends_at).getTime() < now) return false;
  return true;
}

async function fetchActiveOffers(): Promise<OfferSummaryDTO[]> {
  const supabase = createAdminSupabaseClient();
  const { data, error } = await supabase
    .from("offers")
    .select("id,name,slug,discount_percent,banner_media_id,starts_at,ends_at,offer_products(count)")
    .eq("is_active", true)
    .is("deleted_at", null)
    .order("priority", { ascending: false })
    .order("created_at", { ascending: false });
  if (error) return [];
  const scheduled = (data ?? []).filter(isWithinSchedule);
  return Promise.all(scheduled.map(async (row) => ({
    id: row.id, name: row.name, slug: row.slug,
    discountPercent: row.discount_percent === null ? null : Number(row.discount_percent),
    banner: await resolveReadyMediaImage(row.banner_media_id),
    endsAt: row.ends_at, productCount: (row.offer_products as Array<{ count: number }> | null)?.[0]?.count ?? 0,
  })));
}

// Cached/tagged like the other catalog reads (features/catalog/repository.ts) so
// admin offer mutations refresh the storefront's banner strip immediately, with a
// 5-minute revalidate as a safety net for the schedule boundary itself (an offer's
// starts_at/ends_at passing with nobody touching the admin panel).
const cachedListActiveOffers = unstable_cache(fetchActiveOffers, ["catalog-active-offers"], { tags: ["offers"], revalidate: 300 });

export async function listActiveOffers(): Promise<OfferSummaryDTO[]> {
  if (!getPublicSupabaseConfig()) return [];
  return cachedListActiveOffers();
}
