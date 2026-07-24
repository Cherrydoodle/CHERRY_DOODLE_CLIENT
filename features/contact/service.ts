import "server-only";

import { createHmac } from "node:crypto";

import { requireHmacSecret } from "@/lib/env.server";
import { ApiError } from "@/lib/http/problem";
import { createAdminSupabaseClient } from "@/lib/supabase/admin";

import type { ContactInput } from "./schemas";

function privateValueHash(value: string) {
  return createHmac("sha256", requireHmacSecret()).update(value).digest("hex");
}

// Persists a contact submission via the service-role client (RLS is enabled with no
// public policies). IP is stored only as a keyed hash; no raw IP is retained.
export async function submitContactMessage(
  input: ContactInput,
  ip: string | null,
  userAgent: string | null,
): Promise<{ accepted: true }> {
  const admin = createAdminSupabaseClient();
  const { error } = await admin.from("contact_messages").insert({
    name: input.name,
    email: input.email,
    subject: input.subject,
    message: input.message,
    last_ip_hash: ip ? privateValueHash(ip) : null,
    user_agent: userAgent ? userAgent.slice(0, 500) : null,
  });
  if (error) throw new ApiError(503, "SERVICE_UNAVAILABLE", "Your message could not be sent right now. Please try again.");
  return { accepted: true };
}
