import { afterEach, describe, expect, it } from "vitest";

import { assertSameOrigin } from "@/lib/http/request";
import { enforceRateLimit } from "@/lib/http/rate-limit";
import { handleRoute } from "@/lib/http/route";

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

  // RZ-AUDIT L-5: a 429 with no Retry-After leaves the client guessing, and a
  // guessing client retries immediately — which is what caused the throttle.
  it("tells a throttled caller when to retry, and surfaces it as a Retry-After header", async () => {
    delete process.env.UPSTASH_REDIS_REST_URL;
    delete process.env.UPSTASH_REDIS_REST_TOKEN;
    const subject = `retry-after-${crypto.randomUUID()}`;

    await enforceRateLimit({ scope: "retry-after", subject, limit: 1, windowSeconds: 600 });
    await expect(enforceRateLimit({ scope: "retry-after", subject, limit: 1, windowSeconds: 600 }))
      .rejects.toMatchObject({ status: 429, retryAfterSeconds: expect.any(Number) });

    const response = await handleRoute(
      new Request("https://cherrydoodle.in/api/v1/anything", { method: "POST" }),
      async () => {
        await enforceRateLimit({ scope: "retry-after", subject, limit: 1, windowSeconds: 600 });
        return new Response("unreachable");
      },
    );
    expect(response.status).toBe(429);
    expect(Number(response.headers.get("retry-after"))).toBeGreaterThan(0);
  });
});

// RZ-AUDIT L-3: the request id is the trail an incident is reconstructed from. A
// client-chosen value lets any user collide with another request's id in the logs.
describe("request id is never adopted from the caller", () => {
  it("ignores a client-supplied x-request-id and issues its own", async () => {
    const supplied = "11111111-2222-4333-8444-555555555555";
    const response = await handleRoute(
      new Request("https://cherrydoodle.in/api/v1/anything", { method: "GET", headers: { "x-request-id": supplied } }),
      async ({ requestId }) => new Response(requestId),
    );
    const issued = response.headers.get("x-request-id");
    expect(issued).not.toBe(supplied);
    expect(issued).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i);
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
