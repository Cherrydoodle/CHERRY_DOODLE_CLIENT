import "server-only";

import { cloudinaryPublicId, createCloudinaryUpload, deleteCloudinaryImage, getCloudinaryImage } from "@/features/media/cloudinary-client";
import { mediaImageDto } from "@/features/media/delivery";
import type { AppRole } from "@/lib/auth/authorization";
import { ApiError } from "@/lib/http/problem";
import { createAdminSupabaseClient } from "@/lib/supabase/admin";

type UploadInput = { purpose: "product" | "category" | "hero" | "content" | "avatar" | "brand" | "order_customization"; filename: string; mimeType: string; byteSize: number; altText: string };
type Actor = { userId: string; role: AppRole };

const FORMAT_TO_MIME: Record<string, string> = { jpg: "image/jpeg", jpeg: "image/jpeg", png: "image/png", webp: "image/webp" };

function cleanFilename(filename: string) {
  return filename.replace(/[\u0000-\u001f\u007f]/g, "").replace(/[\\/]/g, "_").slice(0, 255);
}

export async function startMediaUpload(input: UploadInput, actor: Actor) {
  const admin = createAdminSupabaseClient();
  const mediaId = crypto.randomUUID();
  const requiresSignedUrls = input.purpose === "order_customization";
  const storageKey = cloudinaryPublicId(mediaId, input.purpose);
  const upload = createCloudinaryUpload({ publicId: storageKey, isPrivate: requiresSignedUrls });
  const { error } = await admin.from("media_assets").insert({
    id: mediaId,
    storage_provider: "cloudinary",
    storage_key: storageKey,
    purpose: input.purpose,
    status: "pending",
    original_filename: cleanFilename(input.filename),
    mime_type: input.mimeType,
    byte_size: input.byteSize,
    alt_text: input.altText,
    uploaded_by: actor.userId,
    require_signed_urls: requiresSignedUrls,
    metadata: { requestedMimeType: input.mimeType, requestedByteSize: input.byteSize },
  });
  if (error) throw new ApiError(503, "SERVICE_UNAVAILABLE", "Media upload could not be initialized.");
  return {
    mediaId,
    storageKey,
    uploadUrl: upload.uploadUrl,
    uploadMethod: "POST" as const,
    fields: upload.fields,
    expiresAt: upload.expiresAt,
    allowed: { mimeTypes: ["image/jpeg", "image/png", "image/webp"], maxBytes: 10_000_000 },
  };
}

async function inspectCloudinaryImage(asset: Record<string, unknown>) {
  const details = await getCloudinaryImage(String(asset.storage_key), Boolean(asset.require_signed_urls));
  if (details.publicId !== asset.storage_key || details.type !== (asset.require_signed_urls ? "authenticated" : "upload")) {
    throw new ApiError(422, "IMAGE_POLICY_FAILED", "The uploaded asset does not match the signed upload request.");
  }
  const expectedSize = Number(asset.byte_size);
  if (!Number.isSafeInteger(details.bytes) || details.bytes < 1 || details.bytes > 10_000_000 || details.bytes !== expectedSize) {
    throw new ApiError(422, "IMAGE_POLICY_FAILED", "The uploaded file size does not match the upload request.");
  }
  if (FORMAT_TO_MIME[details.format] !== asset.mime_type) {
    throw new ApiError(422, "IMAGE_POLICY_FAILED", "The uploaded image format does not match the upload request.");
  }
  if (!Number.isSafeInteger(details.width) || !Number.isSafeInteger(details.height) || details.width < 1 || details.height < 1) {
    throw new ApiError(422, "IMAGE_POLICY_FAILED", "Cloudinary returned invalid image dimensions.");
  }
  const purpose = String(asset.purpose);
  const minimum = purpose === "hero" ? { width: 1600, height: 900 } : purpose === "brand" || purpose === "avatar" ? { width: 128, height: 128 } : { width: 800, height: 800 };
  if (details.width < minimum.width || details.height < minimum.height) {
    throw new ApiError(422, "IMAGE_POLICY_FAILED", `Image must be at least ${minimum.width} by ${minimum.height} pixels.`);
  }
  return details;
}

export async function completeMediaUpload(mediaId: string) {
  const admin = createAdminSupabaseClient();
  const { data: asset, error } = await admin.from("media_assets").select("*").eq("id", mediaId).maybeSingle();
  if (error || !asset || asset.deleted_at) throw new ApiError(404, "NOT_FOUND", "Media asset not found.");
  if (asset.status === "ready") return adminMediaDto(asset);
  if (asset.status !== "pending") throw new ApiError(409, "UPLOAD_INCOMPLETE", "Media asset is not awaiting upload completion.");
  if (asset.storage_provider !== "cloudinary") throw new ApiError(409, "LEGACY_MEDIA", "Legacy media must be re-uploaded to Cloudinary.");

  let inspected: Awaited<ReturnType<typeof inspectCloudinaryImage>>;
  try {
    inspected = await inspectCloudinaryImage(asset);
  } catch (error) {
    if (error instanceof ApiError && error.code === "UPLOAD_INCOMPLETE") throw error;
    await Promise.all([
      admin.from("media_assets").update({ status: "failed", last_error: error instanceof Error ? error.message.slice(0, 500) : "Image policy failed." }).eq("id", mediaId),
      deleteCloudinaryImage(String(asset.storage_key), Boolean(asset.require_signed_urls)).catch(() => undefined),
    ]);
    throw error;
  }
  const metadata = asset.metadata && typeof asset.metadata === "object" && !Array.isArray(asset.metadata) ? asset.metadata : {};
  const { data: updated, error: updateError } = await admin.from("media_assets").update({
    status: "ready",
    ready_at: new Date().toISOString(),
    width: inspected.width,
    height: inspected.height,
    storage_etag: inspected.etag,
    metadata: { ...metadata, cloudinaryAssetId: inspected.assetId, cloudinaryVersion: inspected.version, cloudinaryFormat: inspected.format },
    last_error: null,
  }).eq("id", mediaId).eq("status", "pending").select("*").single();
  if (updateError || !updated) throw new ApiError(503, "SERVICE_UNAVAILABLE", "Media upload could not be finalized.");
  return adminMediaDto(updated);
}

function adminMediaDto(asset: Record<string, unknown>) {
  const ready = asset.status === "ready" && asset.storage_provider === "cloudinary" && typeof asset.storage_key === "string";
  return {
    id: String(asset.id),
    status: String(asset.status),
    purpose: String(asset.purpose),
    filename: asset.original_filename,
    mimeType: asset.mime_type,
    byteSize: asset.byte_size,
    width: asset.width,
    height: asset.height,
    altText: asset.alt_text,
    version: asset.version,
    createdAt: asset.created_at,
    readyAt: asset.ready_at,
    image: ready ? mediaImageDto({ id: String(asset.id), storageKey: String(asset.storage_key), alt: String(asset.alt_text ?? ""), width: Number(asset.width ?? 1), height: Number(asset.height ?? 1) }) : null,
  };
}

export async function listMedia(options: { status?: string; purpose?: string; limit: number }) {
  const admin = createAdminSupabaseClient();
  let query = admin.from("media_assets").select("*").order("created_at", { ascending: false }).limit(options.limit);
  if (options.status) query = query.eq("status", options.status);
  if (options.purpose) query = query.eq("purpose", options.purpose);
  const { data, error } = await query;
  if (error) throw new ApiError(503, "SERVICE_UNAVAILABLE", "Media library could not be loaded.");
  return (data ?? []).map((asset) => adminMediaDto(asset));
}

export async function requestMediaDeletion(mediaId: string, actor: Actor) {
  const admin = createAdminSupabaseClient();
  const [productRefs, variantRefs, categoryRefs, contentRefs, profileRefs, settingsRefs, customizationRefs] = await Promise.all([
    admin.from("product_media").select("*", { count: "exact", head: true }).eq("media_asset_id", mediaId),
    admin.from("product_variant_media").select("*", { count: "exact", head: true }).eq("media_asset_id", mediaId),
    admin.from("categories").select("*", { count: "exact", head: true }).eq("image_media_id", mediaId).is("deleted_at", null),
    admin.from("content_blocks").select("*", { count: "exact", head: true }).eq("media_asset_id", mediaId).is("deleted_at", null),
    admin.from("profiles").select("*", { count: "exact", head: true }).eq("avatar_media_id", mediaId).is("deleted_at", null),
    admin.from("store_settings").select("*", { count: "exact", head: true }).or(`logo_media_id.eq.${mediaId},favicon_media_id.eq.${mediaId}`),
    admin.from("order_item_customizations").select("*", { count: "exact", head: true }).eq("media_asset_id", mediaId),
  ]);
  if ([productRefs, variantRefs, categoryRefs, contentRefs, profileRefs, settingsRefs, customizationRefs].reduce((sum, result) => sum + (result.count ?? 0), 0) > 0) {
    throw new ApiError(409, "MEDIA_IN_USE", "Detach the media asset before deleting it.");
  }
  const { data: asset } = await admin.from("media_assets").update({ status: "delete_pending", deleted_by: actor.userId }).eq("id", mediaId).is("deleted_at", null).select("storage_key,storage_provider,require_signed_urls,status").maybeSingle();
  if (!asset) return { status: "deleted" as const };
  if (asset.storage_provider !== "cloudinary") {
    await admin.from("media_assets").update({ last_error: `Legacy ${asset.storage_provider} asset requires manual provider cleanup.` }).eq("id", mediaId);
    return { status: "delete_pending" as const };
  }
  try {
    await deleteCloudinaryImage(asset.storage_key, asset.require_signed_urls);
    await admin.from("media_assets").update({ status: "deleted", deleted_at: new Date().toISOString(), last_error: null }).eq("id", mediaId);
    return { status: "deleted" as const };
  } catch (error) {
    await admin.from("media_assets").update({ deletion_attempts: 1, last_error: error instanceof Error ? error.message.slice(0, 500) : "Deletion failed" }).eq("id", mediaId);
    return { status: "delete_pending" as const };
  }
}

export async function cleanupMedia() {
  const admin = createAdminSupabaseClient();
  const cutoff = new Date(Date.now() - 60 * 60_000).toISOString();
  const { data: assets } = await admin.from("media_assets").select("*").or(`status.eq.delete_pending,and(status.eq.pending,created_at.lt.${cutoff})`).limit(50);
  let deleted = 0;
  let failed = 0;
  for (const asset of assets ?? []) {
    if (asset.storage_provider !== "cloudinary") {
      await admin.from("media_assets").update({ last_error: `Legacy ${asset.storage_provider} asset requires manual provider cleanup.` }).eq("id", asset.id);
      failed += 1;
      continue;
    }
    try {
      if (asset.status === "pending") {
        const inspected = await inspectCloudinaryImage(asset);
        const metadata = asset.metadata && typeof asset.metadata === "object" && !Array.isArray(asset.metadata) ? asset.metadata : {};
        await admin.from("media_assets").update({
          status: "ready", ready_at: new Date().toISOString(), width: inspected.width, height: inspected.height,
          storage_etag: inspected.etag, metadata: { ...metadata, cloudinaryAssetId: inspected.assetId, cloudinaryVersion: inspected.version, cloudinaryFormat: inspected.format }, last_error: null,
        }).eq("id", asset.id);
        continue;
      }
      await deleteCloudinaryImage(asset.storage_key, asset.require_signed_urls);
      await admin.from("media_assets").update({ status: "deleted", deleted_at: new Date().toISOString(), last_error: null }).eq("id", asset.id);
      deleted += 1;
    } catch (error) {
      if (asset.status === "pending") {
        await deleteCloudinaryImage(asset.storage_key, asset.require_signed_urls).catch(() => undefined);
        await admin.from("media_assets").update({ status: "failed", last_error: error instanceof Error ? error.message.slice(0, 500) : "Upload expired" }).eq("id", asset.id);
      } else {
        await admin.from("media_assets").update({ deletion_attempts: Number(asset.deletion_attempts) + 1, last_error: error instanceof Error ? error.message.slice(0, 500) : "Cleanup failed" }).eq("id", asset.id);
      }
      failed += 1;
    }
  }
  return { examined: assets?.length ?? 0, deleted, failed };
}
