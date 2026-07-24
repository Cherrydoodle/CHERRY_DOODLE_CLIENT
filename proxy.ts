import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";

import { buildContentSecurityPolicy } from "@/lib/security/csp";
import { updateSession } from "@/lib/supabase/proxy";

// Payment and account/auth flows get a stricter nonce + strict-dynamic CSP
// (no unsafe-inline) instead of the permissive baseline in next.config.ts.
// Scoped to routes confirmed dynamic in `next build` output, so this closes
// the inline-script gap exactly where payment/PII flows, at zero cost to the
// static/ISR caching the rest of the storefront relies on (nonce-based CSP
// forces per-request rendering, which is why this isn't applied broadly).
// NOTE: /auth/register, /auth/error, /auth/forgot-password, and
// /auth/reset-password are currently statically rendered — deliberately
// excluded here so this change doesn't force them dynamic too.
const STRICT_CSP_ROUTES = ["/checkout", "/account", "/auth/login", "/auth/callback"];

function isStrictCspRoute(pathname: string) {
  return STRICT_CSP_ROUTES.some((route) => pathname === route || pathname.startsWith(`${route}/`));
}

export async function proxy(request: NextRequest) {
  const { response, claims } = await updateSession(request);
  const pathname = request.nextUrl.pathname;
  const isAccount = pathname.startsWith("/account");
  // Exact match only: /checkout/success (viewing a confirmation via its capability
  // token) intentionally stays unauthenticated-accessible; only starting a new
  // purchase requires login (RZ-045 / RZ-000 decision #26).
  const isCheckout = pathname === "/checkout";

  if ((isAccount || isCheckout) && !claims?.sub) {
    const login = new URL("/auth/login", request.url);
    login.searchParams.set("next", `${pathname}${request.nextUrl.search}`);
    return NextResponse.redirect(login);
  }

  if (isStrictCspRoute(pathname)) {
    const nonce = Buffer.from(crypto.randomUUID()).toString("base64");
    const isDev = process.env.NODE_ENV === "development";
    const csp = buildContentSecurityPolicy({
      scriptSrc: `'self' 'nonce-${nonce}' 'strict-dynamic'${isDev ? " 'unsafe-eval'" : ""}`,
      // A nonce present in the same directive makes browsers ignore 'unsafe-inline'
      // outright, so dev mode (where Next's DevTools overlay sets inline styles
      // with no nonce) needs plain 'unsafe-inline' instead of nonce'd style-src —
      // this is the exact dev/prod split the framework's own CSP guide uses.
      styleSrc: isDev ? "'self' 'unsafe-inline'" : `'self' 'nonce-${nonce}'`,
    });

    // Set on the request so Next.js's rendering step can extract the nonce
    // and auto-apply it to framework/RSC-streaming scripts (see
    // node_modules/next/dist/docs/.../content-security-policy.md).
    const requestHeaders = new Headers(request.headers);
    requestHeaders.set("x-nonce", nonce);
    requestHeaders.set("Content-Security-Policy", csp);
    const nonceResponse = NextResponse.next({ request: { headers: requestHeaders } });
    // Carry over any Set-Cookie updateSession staged (e.g. a refreshed Supabase
    // session token) onto this second response object.
    response.cookies.getAll().forEach((cookie) => nonceResponse.cookies.set(cookie));
    nonceResponse.headers.set("Content-Security-Policy", csp);
    return nonceResponse;
  }

  return response;
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp|avif)$).*)"],
};
