import { createRequire } from "node:module";

import type { NextConfig } from "next";

import { buildContentSecurityPolicy, RAZORPAY_ORIGIN } from "@/lib/security/csp";

const require = createRequire(import.meta.url);

// This is the permissive baseline applied to every route by default.
// script-src needs 'unsafe-inline' because this app renders one inline
// JSON-LD <script> (app/product/[id]/page.tsx) and Next.js App Router itself
// injects inline RSC-streaming scripts. proxy.ts overrides this with a
// stricter nonce + strict-dynamic policy (no unsafe-inline) on /checkout,
// /account, and /auth specifically, since those routes are already
// dynamically rendered and don't render that inline script.
const contentSecurityPolicy = buildContentSecurityPolicy({
  scriptSrc: `'self' 'unsafe-inline' ${RAZORPAY_ORIGIN}`,
  styleSrc: "'self' 'unsafe-inline'",
});

const securityHeaders = [
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "X-Frame-Options", value: "DENY" },
  { key: "Cross-Origin-Opener-Policy", value: "same-origin" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=()" },
  { key: "Content-Security-Policy", value: contentSecurityPolicy },
  ...(process.env.NODE_ENV === "production" ? [{ key: "Strict-Transport-Security", value: "max-age=63072000; includeSubDomains; preload" }] : []),
];

const remotePatterns: NonNullable<NextConfig["images"]>["remotePatterns"] = [];
const cloudinaryCloudName = process.env.CLOUDINARY_CLOUD_NAME?.trim();
if (cloudinaryCloudName && /^[A-Za-z0-9_-]+$/.test(cloudinaryCloudName)) {
  remotePatterns.push({
    protocol: "https",
    hostname: "res.cloudinary.com",
    pathname: `/${cloudinaryCloudName}/image/**`,
  });
}

const nextConfig: NextConfig = {
  poweredByHeader: false,
  reactStrictMode: true,
  images: {
    formats: ["image/avif", "image/webp"],
    remotePatterns,
    // Cloudinary already delivers f_auto,q_auto (see features/media/delivery.ts);
    // a custom loader hands Next a Cloudinary-resized URL per srcset breakpoint
    // instead of re-fetching and re-encoding that image through /_next/image.
    loader: "custom",
    loaderFile: "./lib/image/cloudinary-loader.ts",
  },
  async headers() {
    return [{ source: "/(.*)", headers: securityHeaders }];
  },
};

// Source map upload only activates when SENTRY_ORG/SENTRY_PROJECT/SENTRY_AUTH_TOKEN
// are set (a CI/deploy-time secret); it's a no-op in local dev and in this repo's
// current build until those are configured.
//
// Loaded via a synchronous, gated require (not a static import or top-level
// await — Next's config loader requires this file with require(), which
// cannot mix with top-level await) so that Vitest never eagerly cold-loads
// @sentry/nextjs's Node auto-instrumentation, which conflicts with its module
// loader (see lib/http/route.ts / instrumentation.ts for the same guard) —
// tests/security-hardening.test.ts imports this file directly to assert on
// `headers()`, which never depends on the Sentry wrapper.
export default process.env.VITEST
  ? nextConfig
  : (require("@sentry/nextjs") as typeof import("@sentry/nextjs")).withSentryConfig(nextConfig, {
      org: process.env.SENTRY_ORG,
      project: process.env.SENTRY_PROJECT,
      authToken: process.env.SENTRY_AUTH_TOKEN,
      silent: true,
    });
