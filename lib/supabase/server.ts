import "server-only";

import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";

import { ConfigurationError } from "@/lib/env.server";
import { getPublicSupabaseConfig } from "@/lib/public-env";

export async function createServerSupabaseClient() {
  const config = getPublicSupabaseConfig();
  if (!config) throw new ConfigurationError("Supabase public configuration is missing.");
  const cookieStore = await cookies();

  return createServerClient(config.url, config.publishableKey, {
    cookies: {
      getAll: () => cookieStore.getAll(),
      setAll(cookiesToSet) {
        try {
          cookiesToSet.forEach(({ name, value, options }) => cookieStore.set(name, value, options));
        } catch {
          // Server Components cannot write cookies. proxy.ts refreshes them.
        }
      },
    },
  });
}
