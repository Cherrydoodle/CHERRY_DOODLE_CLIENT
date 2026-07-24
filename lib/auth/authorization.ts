import "server-only";

import { headers } from "next/headers";

import { ApiError } from "@/lib/http/problem";
import { enforceRateLimit } from "@/lib/http/rate-limit";
import { getPublicSupabaseConfig } from "@/lib/public-env";
import { createServerSupabaseClient } from "@/lib/supabase/server";

export type AppRole = "customer" | "catalog_manager" | "admin";
export type AppPermission =
  | "catalog.write"
  | "catalog.publish"
  | "media.write"
  | "content.write"
  | "newsletter.read"
  | "users.manage_roles"
  | "audit.read"
  | "system.cleanup"
  | "dashboard.read"
  | "orders.read"
  | "orders.write"
  | "customers.read"
  | "settings.read"
  | "settings.write";

export const permissionRoles: Record<AppPermission, AppRole[]> = {
  "catalog.write": ["catalog_manager", "admin"],
  "catalog.publish": ["catalog_manager", "admin"],
  "media.write": ["catalog_manager", "admin"],
  "content.write": ["catalog_manager", "admin"],
  "newsletter.read": ["admin"],
  "users.manage_roles": ["admin"],
  "audit.read": ["admin"],
  "system.cleanup": ["admin"],
  "dashboard.read": ["catalog_manager", "admin"],
  "orders.read": ["admin"],
  "orders.write": ["admin"],
  "customers.read": ["admin"],
  "settings.read": ["catalog_manager", "admin"],
  "settings.write": ["admin"],
};

export type AuthContext = { userId: string; role: AppRole; email?: string };

export async function optionalAuth(): Promise<AuthContext | null> {
  if (!getPublicSupabaseConfig()) return null;
  const supabase = await createServerSupabaseClient();
  const authorization = (await headers()).get("authorization");
  const bearer = authorization?.match(/^Bearer\s+(.+)$/i)?.[1];
  const { data, error } = await supabase.auth.getClaims(bearer);
  if (error || !data?.claims?.sub) return null;
  const appMetadata = data.claims.app_metadata;
  const metadataRole = appMetadata && typeof appMetadata === "object" ? (appMetadata as Record<string, unknown>).app_role : undefined;
  const rawRole = data.claims.app_role ?? metadataRole;
  const role: AppRole = rawRole === "admin" || rawRole === "catalog_manager" ? rawRole : "customer";
  return { userId: data.claims.sub, role, email: typeof data.claims.email === "string" ? data.claims.email : undefined };
}

export async function requireUser() {
  const auth = await optionalAuth();
  if (!auth) throw new ApiError(401, "AUTH_REQUIRED", "Authentication is required.");
  return auth;
}

// S13: every admin API route calls requirePermission first, before any other
// logic -- so this is the single choke point to rate-limit all admin actions
// (reads and writes) without repeating enforceRateLimit calls across ~30 route
// files, which would be easy to miss on new routes. Limits are generous for
// normal admin-panel usage (data tables, bulk actions) and only meaningfully
// throttle scripted abuse of a compromised admin credential.
export async function requirePermission(permission: AppPermission) {
  const auth = await requireUser();
  if (!permissionRoles[permission].includes(auth.role)) throw new ApiError(403, "FORBIDDEN", "You do not have permission to perform this action.");
  await enforceRateLimit({ scope: "admin-action", subject: auth.userId, limit: 200, windowSeconds: 60 });
  return auth;
}
