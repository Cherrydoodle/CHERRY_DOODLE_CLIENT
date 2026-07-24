import { type NextRequest, NextResponse } from "next/server";

import { safeNextPath } from "@/features/auth/schemas";
import { createServerSupabaseClient } from "@/lib/supabase/server";

export async function GET(request: NextRequest) {
  const code = request.nextUrl.searchParams.get("code");
  const next = safeNextPath(request.nextUrl.searchParams.get("next") ?? undefined);
  if (!code) return NextResponse.redirect(new URL("/auth/error?code=missing_code", request.url));

  const supabase = await createServerSupabaseClient();
  const { error } = await supabase.auth.exchangeCodeForSession(code);
  if (error) return NextResponse.redirect(new URL("/auth/error?code=invalid_or_expired", request.url));
  return NextResponse.redirect(new URL(next, request.url));
}
