import "server-only";

import type { AppRole } from "@/lib/auth/authorization";
import { requireUser } from "@/lib/auth/authorization";
import { ApiError } from "@/lib/http/problem";
import { createAdminSupabaseClient } from "@/lib/supabase/admin";
import { createServerSupabaseClient } from "@/lib/supabase/server";

type RegisterInput = { displayName: string; email: string; password: string; marketingConsent?: boolean };
type LoginInput = { email: string; password: string };

export type ProfileDTO = {
  id: string;
  email: string;
  emailVerified: boolean;
  displayName: string;
  locale: string;
  role: AppRole;
};

function mapAuthError(message: string, login = false): never {
  const normalized = message.toLowerCase();
  if (login || normalized.includes("invalid login")) throw new ApiError(401, "INVALID_CREDENTIALS", "Email or password is incorrect.");
  if (normalized.includes("password")) throw new ApiError(422, "WEAK_PASSWORD", "The password does not meet the security requirements.");
  throw new ApiError(503, "SERVICE_UNAVAILABLE", "Authentication is temporarily unavailable.");
}

export async function register(input: RegisterInput, callbackUrl: string) {
  const supabase = await createServerSupabaseClient();
  const { data, error } = await supabase.auth.signUp({
    email: input.email,
    password: input.password,
    options: {
      // Only used if the Supabase project still has "Confirm email" enabled;
      // ignored by Supabase when it isn't (no confirmation email is sent, and
      // signUp returns a session below so the user is logged in immediately).
      emailRedirectTo: callbackUrl,
      data: { display_name: input.displayName, marketing_consent: input.marketingConsent ?? false },
    },
  });
  if (error && !error.message.toLowerCase().includes("already")) mapAuthError(error.message);
  // No session means either the account already existed (error swallowed above
  // to avoid leaking account existence) or the project still requires email
  // confirmation. Either way, fall back to the "check your inbox" messaging.
  if (!data.session) return { verificationRequired: true as const };
  return getProfile();
}

export async function login(input: LoginInput) {
  const supabase = await createServerSupabaseClient();
  const { data, error } = await supabase.auth.signInWithPassword(input);
  if (error || !data.user) mapAuthError(error?.message ?? "Invalid login", true);
  return getProfile();
}

export async function logout() {
  const supabase = await createServerSupabaseClient();
  const { error } = await supabase.auth.signOut();
  if (error) throw new ApiError(503, "SERVICE_UNAVAILABLE", "Sign out could not be completed.");
}

export async function requestPasswordReset(email: string, callbackUrl: string) {
  const supabase = await createServerSupabaseClient();
  await supabase.auth.resetPasswordForEmail(email, { redirectTo: callbackUrl });
  // Deliberately ignore provider account-existence details.
  return { accepted: true as const };
}

export async function resetPassword(password: string) {
  const supabase = await createServerSupabaseClient();
  const { error } = await supabase.auth.updateUser({ password });
  if (error) {
    if (error.message.toLowerCase().includes("session")) throw new ApiError(401, "SESSION_EXPIRED", "The password recovery session has expired.");
    mapAuthError(error.message);
  }
}

export async function getProfile(): Promise<ProfileDTO> {
  const supabase = await createServerSupabaseClient();
  const [{ data: claimsData, error: claimsError }, { data: userData, error: userError }] = await Promise.all([
    supabase.auth.getClaims(),
    supabase.auth.getUser(),
  ]);
  if (claimsError || userError || !claimsData?.claims?.sub || !userData.user) throw new ApiError(401, "AUTH_REQUIRED", "Authentication is required.");
  const [{ data: profile }, { data: roleRow }] = await Promise.all([
    supabase.from("profiles").select("display_name,locale").eq("user_id", userData.user.id).maybeSingle(),
    supabase.from("user_roles").select("role").eq("user_id", userData.user.id).maybeSingle(),
  ]);
  const appMetadata = claimsData.claims.app_metadata;
  const metadataRole = appMetadata && typeof appMetadata === "object" ? (appMetadata as Record<string, unknown>).app_role : undefined;
  const rawRole = claimsData.claims.app_role ?? metadataRole ?? roleRow?.role;
  const role: AppRole = rawRole === "admin" || rawRole === "catalog_manager" ? rawRole : "customer";
  return {
    id: userData.user.id,
    email: userData.user.email ?? "",
    emailVerified: Boolean(userData.user.email_confirmed_at),
    displayName: profile?.display_name ?? "Cherry Doodle customer",
    locale: profile?.locale ?? "en",
    role,
  };
}

export async function updateProfile(input: { displayName?: string; locale?: string; marketingConsent?: boolean }) {
  const supabase = await createServerSupabaseClient();
  const { data: claims } = await supabase.auth.getClaims();
  if (!claims?.claims?.sub) throw new ApiError(401, "AUTH_REQUIRED", "Authentication is required.");
  const patch: Record<string, unknown> = {};
  if (input.displayName !== undefined) patch.display_name = input.displayName;
  if (input.locale !== undefined) patch.locale = input.locale;
  if (input.marketingConsent !== undefined) patch.marketing_consent_at = input.marketingConsent ? new Date().toISOString() : null;
  const { error } = await supabase.from("profiles").update(patch).eq("user_id", claims.claims.sub);
  if (error) throw new ApiError(503, "SERVICE_UNAVAILABLE", "Profile could not be updated.");
  return getProfile();
}

// RZ-026 / RZ-000 decision #25: self-service account deletion. Immediate, not a
// soft-delete-with-grace-period (no such policy was decided). Deleting the
// auth.users row cascades through profiles/customer_addresses/carts/wishlist_items
// via their existing FK definitions; orders/checkout_sessions/audit_logs
// intentionally use ON DELETE SET NULL so business/financial records survive
// account deletion (matches the Privacy Policy's "subject to records we must
// retain by law").
export async function deleteMyAccount() {
  const auth = await requireUser();
  const admin = createAdminSupabaseClient();

  if (auth.role === "admin") {
    const { count } = await admin.from("user_roles").select("*", { count: "exact", head: true }).eq("role", "admin");
    if ((count ?? 0) <= 1) {
      throw new ApiError(409, "LAST_ADMIN", "You are the last administrator and cannot delete your account. Assign another admin first.");
    }
  }

  const { count: activeOrders } = await admin
    .from("orders")
    .select("*", { count: "exact", head: true })
    .eq("customer_user_id", auth.userId)
    .is("deleted_at", null)
    .not("status", "in", "(delivered,cancelled)");
  if ((activeOrders ?? 0) > 0) {
    throw new ApiError(
      409,
      "ACCOUNT_HAS_ACTIVE_ORDERS",
      "You have an order that is still being processed. Please wait until it is delivered or cancelled, or contact us, before deleting your account.",
    );
  }

  // Written before deletion (not after): if this insert fails we abort with
  // nothing yet deleted, rather than deleting the account and then reporting a
  // possibly-misleading failure for an audit write that can no longer matter.
  const { error: auditError } = await admin.from("audit_logs").insert({
    actor_user_id: auth.userId, actor_role: auth.role, action: "account.self_delete", resource_type: "user",
    resource_id: auth.userId, before_data: null, after_data: null, request_id: crypto.randomUUID(),
  });
  if (auditError) throw new ApiError(503, "SERVICE_UNAVAILABLE", "Your account could not be deleted right now. Please try again.");

  const { error } = await admin.auth.admin.deleteUser(auth.userId);
  if (error) throw new ApiError(503, "SERVICE_UNAVAILABLE", "Your account could not be deleted. Please try again or contact support.");
  return { deleted: true as const };
}
