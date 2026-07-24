import "server-only";

import { v2 as cloudinary } from "cloudinary";

import { requireCloudinaryConfig } from "@/lib/env.server";
import { ApiError } from "@/lib/http/problem";

type DeliveryType = "upload" | "authenticated";

function configuredCloudinary() {
  const config = requireCloudinaryConfig();
  cloudinary.config({
    cloud_name: config.cloudName,
    api_key: config.apiKey,
    api_secret: config.apiSecret,
    secure: true,
    signature_algorithm: "sha256",
  });
  return { cloudinary, config };
}

function deliveryType(isPrivate: boolean): DeliveryType {
  return isPrivate ? "authenticated" : "upload";
}

function providerErrorStatus(error: unknown) {
  if (!error || typeof error !== "object") return undefined;
  const value = error as { http_code?: unknown; error?: { http_code?: unknown } };
  const status = value.http_code ?? value.error?.http_code;
  return typeof status === "number" ? status : undefined;
}

export function cloudinaryPublicId(mediaId: string, purpose: string) {
  const environment = (process.env.VERCEL_ENV || process.env.NODE_ENV || "development").replace(/[^A-Za-z0-9_-]/g, "-");
  return `cherry-doodle/${environment}/${purpose}/${mediaId}`;
}

export function createCloudinaryUpload(input: { publicId: string; isPrivate: boolean }) {
  const { cloudinary: client, config } = configuredCloudinary();
  const timestamp = Math.floor(Date.now() / 1000);
  const signedParameters = { overwrite: false, public_id: input.publicId, timestamp };
  const signature = client.utils.api_sign_request(signedParameters, config.apiSecret);
  const type = deliveryType(input.isPrivate);
  return {
    uploadUrl: `https://api.cloudinary.com/v1_1/${encodeURIComponent(config.cloudName)}/image/${type}`,
    fields: {
      api_key: config.apiKey,
      timestamp: String(timestamp),
      signature,
      public_id: input.publicId,
      overwrite: "false",
    },
    // Cloudinary rejects signed upload timestamps older than one hour.
    expiresAt: new Date((timestamp + 3600) * 1000).toISOString(),
  };
}

export async function getCloudinaryImage(publicId: string, isPrivate: boolean) {
  const { cloudinary: client } = configuredCloudinary();
  try {
    const asset = await client.api.resource(publicId, { resource_type: "image", type: deliveryType(isPrivate) });
    return {
      publicId: String(asset.public_id),
      assetId: String(asset.asset_id),
      bytes: Number(asset.bytes),
      width: Number(asset.width),
      height: Number(asset.height),
      format: String(asset.format).toLowerCase(),
      type: String(asset.type),
      etag: asset.etag ? String(asset.etag) : null,
      version: Number(asset.version),
    };
  } catch (error) {
    if (providerErrorStatus(error) === 404) {
      throw new ApiError(409, "UPLOAD_INCOMPLETE", "The image has not finished uploading to Cloudinary.");
    }
    throw new ApiError(502, "UPSTREAM_ERROR", "Cloudinary image details could not be loaded.");
  }
}

export async function deleteCloudinaryImage(publicId: string, isPrivate: boolean) {
  const { cloudinary: client } = configuredCloudinary();
  try {
    const result = await client.uploader.destroy(publicId, { resource_type: "image", type: deliveryType(isPrivate), invalidate: true });
    if (result.result !== "ok" && result.result !== "not found") throw new Error("Unexpected Cloudinary deletion response.");
  } catch {
    throw new ApiError(502, "UPSTREAM_ERROR", "Cloudinary image deletion failed.");
  }
}

export function cloudinaryDeliveryUrl(publicId: string, options: Record<string, unknown>) {
  const { cloudinary: client } = configuredCloudinary();
  return client.url(publicId, { secure: true, resource_type: "image", type: "upload", ...options });
}

export function createPrivateCloudinaryReadUrl(publicId: string, format: string, ttlSeconds?: number) {
  const { cloudinary: client, config } = configuredCloudinary();
  const ttl = ttlSeconds ?? config.privateReadTtlSeconds;
  if (!Number.isInteger(ttl) || ttl < 60 || ttl > 3600) throw new ApiError(500, "INTERNAL_ERROR", "Private media URL expiry is invalid.");
  return client.utils.private_download_url(publicId, format, {
    resource_type: "image",
    type: "authenticated",
    expires_at: Math.floor(Date.now() / 1000) + ttl,
    attachment: false,
  });
}
