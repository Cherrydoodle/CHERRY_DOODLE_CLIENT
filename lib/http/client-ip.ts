import "server-only";

// Resolve the client IP for rate-limiting purposes from a source the client cannot
// forge. `x-forwarded-for` is attacker-controllable: a request can prepend arbitrary
// values to its leftmost entry, so keying a limiter on `xff.split(",")[0]` lets an
// attacker rotate the header and bypass the limit entirely.
//
// `x-vercel-forwarded-for` (set and overwritten at Vercel's edge) and `x-real-ip`
// (set by most reverse proxies) are single trusted values the platform stamps and a
// client cannot override, so they are preferred. The leftmost `x-forwarded-for` is
// used only as a last-resort fallback for platforms that set nothing else, and
// `"local"` covers local/dev where no proxy is present.
export function clientIp(request: Request): string {
  const trusted =
    request.headers.get("x-vercel-forwarded-for")?.trim() ||
    request.headers.get("x-real-ip")?.trim();
  if (trusted) return trusted;

  const forwarded = request.headers.get("x-forwarded-for")?.split(",", 1)[0]?.trim();
  return forwarded || "local";
}
