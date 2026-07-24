import "server-only";

import type { z } from "zod";

import type { AuthContext } from "@/lib/auth/authorization";
import { ApiError } from "@/lib/http/problem";
import { createAdminSupabaseClient } from "@/lib/supabase/admin";
import { mediaImageDto } from "@/features/media/delivery";
import { createContentBlock, deleteContentBlock, updateContentBlock } from "@/features/admin/service";
import type { bannerCreateSchema, bannerUpdateSchema } from "@/features/admin-operations/schemas";

type BannerCreate = z.infer<typeof bannerCreateSchema>;
type BannerUpdate = z.infer<typeof bannerUpdateSchema>;

function bannerDto(row: Record<string, unknown>) {
  const mediaValue = row.media_assets;
  const media = Array.isArray(mediaValue) ? mediaValue[0] : mediaValue as Record<string, unknown> | null;
  return {
    id: String(row.id), key: String(row.key), title: String(row.title), subtitle: row.body ? String(row.body) : "",
    buttonText: row.primary_label ? String(row.primary_label) : "Shop now", buttonLink: row.primary_href ? String(row.primary_href) : "/",
    imageMediaId: row.media_asset_id ? String(row.media_asset_id) : null,
    image: media?.status === "ready" && media.storage_provider === "cloudinary" ? mediaImageDto({ id: String(media.id), storageKey: String(media.storage_key), alt: String(media.alt_text ?? row.title), width: Number(media.width ?? 1), height: Number(media.height ?? 1) }) : null,
    isActive: Boolean(row.is_active), sortOrder: Number(row.sort_order), startsAt: row.starts_at, endsAt: row.ends_at,
    version: Number(row.version), createdAt: row.created_at, updatedAt: row.updated_at,
  };
}

const projection = "*,media_assets(id,status,storage_key,storage_provider,alt_text,width,height)";

export async function listBanners() {
  const { data, error } = await createAdminSupabaseClient().from("content_blocks").select(projection).or("key.eq.home.hero,key.eq.home.sale-banner,key.like.home.banner.%").is("deleted_at", null).order("sort_order").order("created_at");
  if (error) throw new ApiError(503, "SERVICE_UNAVAILABLE", "Banners could not be loaded.");
  return (data ?? []).map((row) => bannerDto(row));
}

export async function getBanner(id: string) {
  const { data, error } = await createAdminSupabaseClient().from("content_blocks").select(projection).eq("id", id).is("deleted_at", null).maybeSingle();
  if (error) throw new ApiError(503, "SERVICE_UNAVAILABLE", "Banner could not be loaded.");
  if (!data || !(data.key === "home.hero" || data.key === "home.sale-banner" || data.key.startsWith("home.banner."))) throw new ApiError(404, "NOT_FOUND", "Banner not found.");
  return bannerDto(data);
}

export async function createBanner(input: BannerCreate, actor: AuthContext, requestId: string) {
  const key = `home.banner.${crypto.randomUUID()}`;
  const created = await createContentBlock({
    key, title: input.title, body: input.subtitle ?? null, mediaAssetId: input.imageMediaId,
    primaryLabel: input.buttonText, primaryHref: input.buttonLink, secondaryLabel: null, secondaryHref: null,
    startsAt: input.startsAt ?? null, endsAt: input.endsAt ?? null, isActive: input.isActive, sortOrder: input.sortOrder,
  }, actor, requestId);
  return getBanner(created.id);
}

export async function updateBanner(id: string, input: BannerUpdate, actor: AuthContext, requestId: string) {
  await getBanner(id);
  await updateContentBlock(id, {
    ...(input.title !== undefined ? { title: input.title } : {}),
    ...(input.subtitle !== undefined ? { body: input.subtitle } : {}),
    ...(input.buttonText !== undefined ? { primaryLabel: input.buttonText } : {}),
    ...(input.buttonLink !== undefined ? { primaryHref: input.buttonLink } : {}),
    ...(input.imageMediaId !== undefined ? { mediaAssetId: input.imageMediaId } : {}),
    ...(input.isActive !== undefined ? { isActive: input.isActive } : {}),
    ...(input.sortOrder !== undefined ? { sortOrder: input.sortOrder } : {}),
    ...(input.startsAt !== undefined ? { startsAt: input.startsAt } : {}),
    ...(input.endsAt !== undefined ? { endsAt: input.endsAt } : {}),
    expectedVersion: input.expectedVersion,
  }, actor, requestId);
  return getBanner(id);
}

export async function deleteBanner(id: string, expectedVersion: number, actor: AuthContext, requestId: string) {
  await getBanner(id);
  await deleteContentBlock(id, expectedVersion, actor, requestId);
}
