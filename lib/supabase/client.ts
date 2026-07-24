"use client";

import { createBrowserClient } from "@supabase/ssr";

import { getPublicSupabaseConfig } from "@/lib/public-env";

export function createClient() {
  const config = getPublicSupabaseConfig();
  if (!config) throw new Error("Supabase browser configuration is missing.");
  return createBrowserClient(config.url, config.publishableKey);
}
