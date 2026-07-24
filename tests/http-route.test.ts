import { afterEach, describe, expect, it, vi } from "vitest";

import { ApiError } from "@/lib/http/problem";
import { handleRoute, jsonData } from "@/lib/http/route";

afterEach(() => vi.restoreAllMocks());

describe("HTTP route boundary", () => {
  it("accepts UUID request IDs and replaces unsafe values", async () => {
    vi.spyOn(console, "info").mockImplementation(() => undefined);
    const knownId = "0e15e465-c39a-478d-a867-30bda37f4aba";
    const accepted = await handleRoute(new Request("https://shop.example/api", { headers: { "x-request-id": knownId } }), async ({ requestId }) => jsonData({ ok: true }, requestId));
    expect(accepted.headers.get("x-request-id")).toBe(knownId);

    const replaced = await handleRoute(new Request("https://shop.example/api", { headers: { "x-request-id": "not-a-uuid" } }), async ({ requestId }) => jsonData({ ok: true }, requestId));
    expect(replaced.headers.get("x-request-id")).toMatch(/^[0-9a-f-]{36}$/);
    expect(replaced.headers.get("x-request-id")).not.toContain("log");
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
