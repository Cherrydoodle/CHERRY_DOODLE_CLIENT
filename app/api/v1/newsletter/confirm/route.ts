import { NextResponse, type NextRequest } from "next/server";

import { newsletterTokenSchema } from "@/features/newsletter/schemas";
import { confirmNewsletter } from "@/features/newsletter/service";

export async function GET(request: NextRequest) {
  const parsed = newsletterTokenSchema.safeParse(request.nextUrl.searchParams.get("token"));
  const destination = new URL("/", request.url);
  destination.searchParams.set("newsletter", parsed.success && await confirmNewsletter(parsed.data) ? "confirmed" : "invalid");
  return NextResponse.redirect(destination, 303);
}
