function supabaseOrigin(): string | null {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL?.trim();
  if (!url) return null;
  try {
    return new URL(url).origin;
  } catch {
    return null;
  }
}

// Derived from the configured host (not hardcoded) so self-hosted PostHog
// instances are covered too, not just PostHog Cloud.
function posthogOrigin(): string | null {
  const url = process.env.NEXT_PUBLIC_POSTHOG_HOST?.trim();
  if (!url) return null;
  try {
    return new URL(url).origin;
  } catch {
    return null;
  }
}

// Razorpay Standard Checkout's script/iframe/telemetry hosts. Kept scoped to
// *.razorpay.com (not a blanket wildcard) so this still meaningfully restricts
// arbitrary third-party origins while covering api./checkout./lumberjack.
// subdomains Razorpay's checkout.js talks to.
export const RAZORPAY_ORIGIN = "https://*.razorpay.com";

// Covers both Sentry Cloud ingest regions (us/de). A self-hosted Sentry
// instance would need its own origin added here instead.
export const SENTRY_ORIGIN = "https://*.sentry.io";

// Instagram reel embeds (components/InstagramEmbed.tsx) render a direct
// instagram.com/{reel|p}/<id>/embed/ iframe -- no script is loaded into our
// page, so only frame-src needs to allow the host.
export const INSTAGRAM_FRAME_ORIGIN = "https://www.instagram.com";

/**
 * Shared CSP directive builder used by both next.config.ts (the permissive,
 * unsafe-inline baseline applied everywhere) and proxy.ts (the stricter
 * nonce + strict-dynamic policy applied only to /checkout, /account, /auth).
 * Keeping the vendor-origin list in one place avoids the two policies
 * silently drifting apart as new vendors get added.
 */
export function buildContentSecurityPolicy(options: { scriptSrc: string; styleSrc: string }): string {
  const connectSrc = ["'self'", RAZORPAY_ORIGIN, "https://api.cloudinary.com", supabaseOrigin(), SENTRY_ORIGIN, posthogOrigin()]
    .filter(Boolean)
    .join(" ");

  return [
    "default-src 'self'",
    `script-src ${options.scriptSrc}`,
    `style-src ${options.styleSrc}`,
    `img-src 'self' data: blob: https://res.cloudinary.com ${RAZORPAY_ORIGIN}`,
    "font-src 'self' data:",
    `connect-src ${connectSrc}`,
    `frame-src ${RAZORPAY_ORIGIN} ${INSTAGRAM_FRAME_ORIGIN}`,
    "frame-ancestors 'none'",
    "form-action 'self'",
    "base-uri 'self'",
    "object-src 'none'",
    "upgrade-insecure-requests",
  ].join("; ");
}
