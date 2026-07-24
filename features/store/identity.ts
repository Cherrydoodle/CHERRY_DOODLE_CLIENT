import "server-only";

import { cache } from "react";

import type { ImageDTO } from "@/features/catalog/types";
import { resolveReadyMediaImage } from "@/features/media/delivery";
import { createAdminSupabaseClient } from "@/lib/supabase/admin";
import { logger } from "@/lib/observability/logger";

export type StoreIdentity = {
  storeName: string;
  email: string;
  phone: string;
  website: string;
  address: string;
  instagram: string | null;
  currency: string;
  logo: ImageDTO | null;
  favicon: ImageDTO | null;
};

// Confirmed in docs/decisions/rz-000-business-decisions.md. Used as a resilient
// fallback so the public policy/contact pages always render (a Razorpay reviewer
// must never hit a 5xx on a legal page), even if store_settings cannot be read.
export const STORE_IDENTITY_FALLBACK: StoreIdentity = {
  storeName: "Cherry Doodle",
  email: "cherrydoodle987@gmail.com",
  phone: "+91 6235874566",
  website: "https://cherrydoodle.in",
  address: "Regent Plaza, 2nd Floor, Ramanattukara – 673633",
  instagram: "https://www.instagram.com/cherry__doodle",
  currency: "INR",
  logo: null,
  favicon: null,
};

// Deduplicated per-request via React cache. Reads a whitelist of public-safe columns
// with the service-role client (server-only); no admin/internal fields are exposed.
export const getStoreIdentity = cache(async (): Promise<StoreIdentity> => {
  try {
    const { data, error } = await createAdminSupabaseClient()
      .from("store_settings")
      .select("store_name,email,phone_number,website,address,instagram_url,default_currency,logo_media_id,favicon_media_id")
      .eq("singleton", true)
      .single();
    if (error || !data) return STORE_IDENTITY_FALLBACK;
    const [logo, favicon] = await Promise.all([resolveReadyMediaImage(data.logo_media_id), resolveReadyMediaImage(data.favicon_media_id)]);
    return {
      storeName: data.store_name ?? STORE_IDENTITY_FALLBACK.storeName,
      email: String(data.email ?? STORE_IDENTITY_FALLBACK.email),
      phone: data.phone_number ?? STORE_IDENTITY_FALLBACK.phone,
      website: data.website ?? STORE_IDENTITY_FALLBACK.website,
      address: data.address ?? STORE_IDENTITY_FALLBACK.address,
      instagram: data.instagram_url ?? STORE_IDENTITY_FALLBACK.instagram,
      currency: data.default_currency ?? STORE_IDENTITY_FALLBACK.currency,
      logo,
      favicon,
    };
  } catch (caught) {
    logger.warn("store_identity_load_failed", {
      errorName: caught instanceof Error ? caught.name : "UnknownError",
    });
    return STORE_IDENTITY_FALLBACK;
  }
});
