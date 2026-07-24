import "server-only";

import { createClient } from "@supabase/supabase-js";

import { requireSupabaseServerConfig } from "@/lib/env.server";

export function createAdminSupabaseClient() {
  const { url, secretKey } = requireSupabaseServerConfig();
  return createClient(url, secretKey, {
    auth: { autoRefreshToken: false, detectSessionInUrl: false, persistSession: false },
  });
}
