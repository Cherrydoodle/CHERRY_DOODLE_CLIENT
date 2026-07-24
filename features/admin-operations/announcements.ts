import "server-only";

import type { z } from "zod";

import type { AuthContext } from "@/lib/auth/authorization";
import { ApiError } from "@/lib/http/problem";
import { createAdminSupabaseClient } from "@/lib/supabase/admin";
import { createContentBlock, deleteContentBlock, updateContentBlock } from "@/features/admin/service";
import type { announcementCreateSchema, announcementUpdateSchema } from "@/features/admin-operations/schemas";

type AnnouncementCreate = z.infer<typeof announcementCreateSchema>;
type AnnouncementUpdate = z.infer<typeof announcementUpdateSchema>;

const KEY_PREFIX = "home.marquee.";

function announcementDto(row: Record<string, unknown>) {
  return {
    id: String(row.id),
    text: String(row.title),
    link: row.primary_href ? String(row.primary_href) : null,
    isActive: Boolean(row.is_active),
    sortOrder: Number(row.sort_order),
    startsAt: row.starts_at,
    endsAt: row.ends_at,
    version: Number(row.version),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export async function listAnnouncements() {
  const { data, error } = await createAdminSupabaseClient().from("content_blocks").select("*").like("key", `${KEY_PREFIX}%`).is("deleted_at", null).order("sort_order").order("created_at");
  if (error) throw new ApiError(503, "SERVICE_UNAVAILABLE", "Marquee messages could not be loaded.");
  return (data ?? []).map((row) => announcementDto(row));
}

export async function getAnnouncement(id: string) {
  const { data, error } = await createAdminSupabaseClient().from("content_blocks").select("*").eq("id", id).is("deleted_at", null).maybeSingle();
  if (error) throw new ApiError(503, "SERVICE_UNAVAILABLE", "Marquee message could not be loaded.");
  if (!data || !String(data.key).startsWith(KEY_PREFIX)) throw new ApiError(404, "NOT_FOUND", "Marquee message not found.");
  return announcementDto(data);
}

export async function createAnnouncement(input: AnnouncementCreate, actor: AuthContext, requestId: string) {
  const key = `${KEY_PREFIX}${crypto.randomUUID()}`;
  const created = await createContentBlock({
    key, title: input.text, primaryHref: input.link ?? null,
    isActive: input.isActive, sortOrder: input.sortOrder,
    startsAt: input.startsAt ?? null, endsAt: input.endsAt ?? null,
  }, actor, requestId);
  return getAnnouncement(created.id);
}

export async function updateAnnouncement(id: string, input: AnnouncementUpdate, actor: AuthContext, requestId: string) {
  await getAnnouncement(id);
  await updateContentBlock(id, {
    ...(input.text !== undefined ? { title: input.text } : {}),
    ...(input.link !== undefined ? { primaryHref: input.link } : {}),
    ...(input.isActive !== undefined ? { isActive: input.isActive } : {}),
    ...(input.sortOrder !== undefined ? { sortOrder: input.sortOrder } : {}),
    ...(input.startsAt !== undefined ? { startsAt: input.startsAt } : {}),
    ...(input.endsAt !== undefined ? { endsAt: input.endsAt } : {}),
    expectedVersion: input.expectedVersion,
  }, actor, requestId);
  return getAnnouncement(id);
}

export async function deleteAnnouncement(id: string, expectedVersion: number, actor: AuthContext, requestId: string) {
  await getAnnouncement(id);
  await deleteContentBlock(id, expectedVersion, actor, requestId);
}
