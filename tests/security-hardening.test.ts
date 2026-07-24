import { afterEach, describe, expect, it } from "vitest";

import { assertSameOrigin } from "@/lib/http/request";
import { enforceRateLimit } from "@/lib/http/rate-limit";

const originalEnv = { ...process.env };

afterEach(() => {
  process.env = { ...originalEnv };
});

function requestWithOrigin(origin: string | null, extraHeaders?: Record<string, string>) {
  const headers = new Headers(extraHeaders);
  if (origin !== null) headers.set("origin", origin);
  return new Request("https://cherrydoodle.in/api/v1/cart/items", { method: "POST", headers });
}

describe("assertSameOrigin (RZ-090: Origin-absent mutations rejected)", () => {
  it("rejects a cookie-auth request with no Origin header at all", () => {
    expect(() => assertSameOrigin(requestWithOrigin(null))).toThrow(/origin/i);
  });

  it("rejects a request whose Origin does not match the request URL", () => {
    expect(() => assertSameOrigin(requestWithOrigin("https://evil.example"))).toThrow(/origin/i);
  });

  it("allows a request whose Origin matches the request URL", () => {
    expect(() => assertSameOrigin(requestWithOrigin("https://cherrydoodle.in"))).not.toThrow();
  });

  // Regression guard: the admin panel's server-side proxy reaches these routes
  // with a Bearer token and NO Origin header. Bearer-auth is not a CSRF vector, so
  // it must be exempt -- an earlier version of this hardening broke the admin panel
  // by rejecting all Origin-absent requests.
  it("allows a Bearer-token request with no Origin (server-to-server admin proxy)", () => {
    expect(() => assertSameOrigin(requestWithOrigin(null, { authorization: "Bearer abc.def.ghi" }))).not.toThrow();
  });

  it("does not treat a non-Bearer Authorization value as exempt", () => {
    expect(() => assertSameOrigin(requestWithOrigin(null, { authorization: "Basic dXNlcjpwYXNz" }))).toThrow(/origin/i);
  });
});

describe("enforceRateLimit (RZ-090: reset-password rate limiting)", () => {
  it("allows requests up to the limit, then rejects the next one (in-memory fallback)", async () => {
    delete process.env.UPSTASH_REDIS_REST_URL;
    delete process.env.UPSTASH_REDIS_REST_TOKEN;
    const subject = `reset-password-test-${crypto.randomUUID()}`;

    for (let i = 0; i < 5; i += 1) {
      await expect(enforceRateLimit({ scope: "reset-password", subject, limit: 5, windowSeconds: 3600 })).resolves.toBeUndefined();
    }
    await expect(enforceRateLimit({ scope: "reset-password", subject, limit: 5, windowSeconds: 3600 })).rejects.toMatchObject({ status: 429, code: "RATE_LIMITED" });
  });

  it("tracks distinct subjects independently", async () => {
    delete process.env.UPSTASH_REDIS_REST_URL;
    delete process.env.UPSTASH_REDIS_REST_TOKEN;
    const scope = `distinct-subjects-${crypto.randomUUID()}`;

    await enforceRateLimit({ scope, subject: "user-a", limit: 1, windowSeconds: 3600 });
    // A different subject under the same scope is not affected by user-a's usage.
    await expect(enforceRateLimit({ scope, subject: "user-b", limit: 1, windowSeconds: 3600 })).resolves.toBeUndefined();
    await expect(enforceRateLimit({ scope, subject: "user-a", limit: 1, windowSeconds: 3600 })).rejects.toMatchObject({ status: 429 });
  });
});

describe("Content-Security-Policy (RZ-090)", () => {
  it("includes a CSP header that allows the Razorpay checkout origin without blanket-allowing everything", async () => {
    const config = (await import("../next.config")).default;
    const headerGroups = await config.headers?.();
    const csp = headerGroups?.[0]?.headers.find((header) => header.key === "Content-Security-Policy")?.value;
    expect(csp).toBeTruthy();
    expect(csp).toMatch(/script-src[^;]*razorpay\.com/);
    expect(csp).toMatch(/frame-src[^;]*razorpay\.com/);
    expect(csp).toContain("frame-ancestors 'none'");
    expect(csp).toContain("object-src 'none'");
    // Still a real allowlist, not "allow everything":
    expect(csp).not.toContain("script-src *");
    expect(csp).not.toContain("default-src *");
  });

  it("still sets the pre-existing security headers alongside CSP (no regression)", async () => {
    const config = (await import("../next.config")).default;
    const headerGroups = await config.headers?.();
    const keys = headerGroups?.[0]?.headers.map((header) => header.key) ?? [];
    expect(keys).toEqual(expect.arrayContaining(["X-Content-Type-Options", "X-Frame-Options", "Content-Security-Policy"]));
  });
});
