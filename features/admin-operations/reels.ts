import "server-only";

import type { z } from "zod";

import type { AuthContext } from "@/lib/auth/authorization";
import { ApiError } from "@/lib/http/problem";
import { createAdminSupabaseClient } from "@/lib/supabase/admin";
import { createContentBlock, deleteContentBlock, updateContentBlock } from "@/features/admin/service";
import type { reelCreateSchema, reelUpdateSchema } from "@/features/admin-operations/schemas";

type ReelCreate = z.infer<typeof reelCreateSchema>;
type ReelUpdate = z.infer<typeof reelUpdateSchema>;

// Instagram reels reuse the generic content_blocks store under a dedicated key
// namespace (like banners and the marquee). The reel permalink lives in
// primary_href; the optional caption in body. content_blocks.title is NOT NULL,
// so it carries a fixed, non-user-facing label.
const KEY_PREFIX = "home.reel.";
const TITLE = "Instagram reel";

function reelDto(row: Record<string, unknown>) {
  return {
    id: String(row.id),
    reelUrl: row.primary_href ? String(row.primary_href) : "",
    caption: row.body ? String(row.body) : "",
    isActive: Boolean(row.is_active),
    sortOrder: Number(row.sort_order),
    startsAt: row.starts_at,
    endsAt: row.ends_at,
    version: Number(row.version),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export async function listReels() {
  const { data, error } = await createAdminSupabaseClient().from("content_blocks").select("*").like("key", `${KEY_PREFIX}%`).is("deleted_at", null).order("sort_order").order("created_at");
  if (error) throw new ApiError(503, "SERVICE_UNAVAILABLE", "Reels could not be loaded.");
  return (data ?? []).map((row) => reelDto(row));
}

export async function getReel(id: string) {
  const { data, error } = await createAdminSupabaseClient().from("content_blocks").select("*").eq("id", id).is("deleted_at", null).maybeSingle();
  if (error) throw new ApiError(503, "SERVICE_UNAVAILABLE", "Reel could not be loaded.");
  if (!data || !String(data.key).startsWith(KEY_PREFIX)) throw new ApiError(404, "NOT_FOUND", "Reel not found.");
  return reelDto(data);
}

export async function createReel(input: ReelCreate, actor: AuthContext, requestId: string) {
  const key = `${KEY_PREFIX}${crypto.randomUUID()}`;
  const created = await createContentBlock({
    key, title: TITLE, body: input.caption ?? null, primaryHref: input.reelUrl,
    isActive: input.isActive, sortOrder: input.sortOrder,
    startsAt: input.startsAt ?? null, endsAt: input.endsAt ?? null,
  }, actor, requestId);
  return getReel(created.id);
}

export async function updateReel(id: string, input: ReelUpdate, actor: AuthContext, requestId: string) {
  await getReel(id);
  await updateContentBlock(id, {
    ...(input.reelUrl !== undefined ? { primaryHref: input.reelUrl } : {}),
    ...(input.caption !== undefined ? { body: input.caption } : {}),
    ...(input.isActive !== undefined ? { isActive: input.isActive } : {}),
    ...(input.sortOrder !== undefined ? { sortOrder: input.sortOrder } : {}),
    ...(input.startsAt !== undefined ? { startsAt: input.startsAt } : {}),
    ...(input.endsAt !== undefined ? { endsAt: input.endsAt } : {}),
    expectedVersion: input.expectedVersion,
  }, actor, requestId);
  return getReel(id);
}

export async function deleteReel(id: string, expectedVersion: number, actor: AuthContext, requestId: string) {
  await getReel(id);
  await deleteContentBlock(id, expectedVersion, actor, requestId);
}
