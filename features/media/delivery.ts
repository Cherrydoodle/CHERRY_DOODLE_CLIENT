import "server-only";

import type { ImageDTO } from "@/features/catalog/types";
import { cloudinaryDeliveryUrl, createPrivateCloudinaryReadUrl } from "@/features/media/cloudinary-client";
import { ConfigurationError } from "@/lib/env.server";
import { createAdminSupabaseClient } from "@/lib/supabase/admin";

type MediaRow = { id: string; storageKey: string; alt: string; width: number; height: number };

// Shared by the admin settings service and the public store-identity reader —
// both resolve a store_settings logo_media_id/favicon_media_id the same way.
export async function resolveReadyMediaImage(mediaId: string | null): Promise<ImageDTO | null> {
  if (!mediaId) return null;
  const { data } = await createAdminSupabaseClient()
    .from("media_assets")
    .select("id,storage_key,alt_text,width,height")
    .eq("id", mediaId)
    .eq("status", "ready")
    .eq("storage_provider", "cloudinary")
    .maybeSingle();
  if (!data) return null;
  return mediaImageDto({ id: data.id, storageKey: data.storage_key, alt: data.alt_text, width: data.width ?? 1, height: data.height ?? 1 });
}

export function mediaImageDto(row: MediaRow): ImageDTO {
  return {
    id: row.id,
    alt: row.alt,
    width: row.width,
    height: row.height,
    urls: {
      thumb: cloudinaryDeliveryUrl(row.storageKey, { width: 160, height: 160, crop: "fill", gravity: "auto", fetch_format: "auto", quality: "auto" }),
      card: cloudinaryDeliveryUrl(row.storageKey, { width: 800, height: 800, crop: "fill", gravity: "auto", fetch_format: "auto", quality: "auto" }),
      detail: cloudinaryDeliveryUrl(row.storageKey, { width: 1200, crop: "limit", fetch_format: "auto", quality: "auto" }),
    },
  };
}

export function privateMediaUrl(storageKey: string, mimeType: string, ttlSeconds?: number) {
  const format = mimeType === "image/jpeg" ? "jpg" : mimeType === "image/png" ? "png" : mimeType === "image/webp" ? "webp" : null;
  if (!format) throw new ConfigurationError("Private Cloudinary media has an unsupported MIME type.");
  return createPrivateCloudinaryReadUrl(storageKey, format, ttlSeconds);
}
