import { createServerClient } from "@supabase/ssr";
import { type NextRequest, NextResponse } from "next/server";

import { getPublicSupabaseConfig } from "@/lib/public-env";

export async function updateSession(request: NextRequest) {
  const config = getPublicSupabaseConfig();
  if (!config) return { response: NextResponse.next({ request }), claims: null };

  let response = NextResponse.next({ request });
  const supabase = createServerClient(config.url, config.publishableKey, {
    cookies: {
      getAll: () => request.cookies.getAll(),
      setAll(cookiesToSet) {
        cookiesToSet.forEach(({ name, value }) => request.cookies.set(name, value));
        response = NextResponse.next({ request });
        cookiesToSet.forEach(({ name, value, options }) => response.cookies.set(name, value, options));
      },
    },
  });

  const { data } = await supabase.auth.getClaims();
  return { response, claims: data?.claims ?? null };
}
