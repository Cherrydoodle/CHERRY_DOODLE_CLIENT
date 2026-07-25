import { afterEach, describe, expect, it, vi } from "vitest";

import { ApiError } from "@/lib/http/problem";
import { handleRoute, jsonData } from "@/lib/http/route";

afterEach(() => vi.restoreAllMocks());

describe("HTTP route boundary", () => {
  // RZ-AUDIT L-3: this used to adopt a client-supplied UUID as the request id. The
  // request id is the trail an incident is reconstructed from, so a caller must not
  // be able to choose it — and therefore must not be able to collide with, or
  // impersonate, another request's id in the logs. A caller's own correlation id is
  // still logged, as a separate `upstreamRequestId` field.
  it("always issues its own request ID, never the caller's", async () => {
    vi.spyOn(console, "info").mockImplementation(() => undefined);
    const suppliedId = "0e15e465-c39a-478d-a867-30bda37f4aba";
    const response = await handleRoute(
      new Request("https://shop.example/api", { headers: { "x-request-id": suppliedId } }),
      async ({ requestId }) => jsonData({ ok: true }, requestId),
    );
    expect(response.headers.get("x-request-id")).not.toBe(suppliedId);
    expect(response.headers.get("x-request-id")).toMatch(/^[0-9a-f-]{36}$/);
  });

  it("records the caller's correlation id separately instead of trusting it", async () => {
    const info = vi.spyOn(console, "info").mockImplementation(() => undefined);
    await handleRoute(
      new Request("https://shop.example/api", { headers: { "x-request-id": "upstream-trace-42" } }),
      async ({ requestId }) => jsonData({ ok: true }, requestId),
    );
    const logged = JSON.parse(String(info.mock.calls.at(-1)?.[0])) as { requestId: string; upstreamRequestId?: string };
    expect(logged.upstreamRequestId).toBe("upstream-trace-42");
    expect(logged.requestId).not.toBe("upstream-trace-42");
  });

  it("ignores a caller correlation id with unsafe characters", async () => {
    const info = vi.spyOn(console, "info").mockImplementation(() => undefined);
    await handleRoute(
      new Request("https://shop.example/api", { headers: { "x-request-id": 'evil","level":"fatal' } }),
      async ({ requestId }) => jsonData({ ok: true }, requestId),
    );
    const logged = JSON.parse(String(info.mock.calls.at(-1)?.[0])) as { upstreamRequestId?: string };
    expect(logged.upstreamRequestId).toBeUndefined();
  });

  it("maps domain failures to problem responses", async () => {
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    const response = await handleRoute(new Request("https://shop.example/api/v1/test"), async () => {
      throw new ApiError(409, "VERSION_CONFLICT", "The record changed.");
    });
    const body = await response.json();
    expect(response.status).toBe(409);
    expect(response.headers.get("content-type")).toContain("application/problem+json");
    expect(body).toMatchObject({ code: "VERSION_CONFLICT", instance: "/api/v1/test" });
  });
});
