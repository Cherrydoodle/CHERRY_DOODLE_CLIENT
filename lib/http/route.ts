import "server-only";

import { logger } from "@/lib/observability/logger";
import { toProblem } from "@/lib/http/problem";

export type RequestContext = { requestId: string };

export async function handleRoute(
  request: Request,
  handler: (context: RequestContext) => Promise<Response>,
): Promise<Response> {
  const suppliedRequestId = request.headers.get("x-request-id")?.trim();
  const requestId = suppliedRequestId && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(suppliedRequestId)
    ? suppliedRequestId
    : crypto.randomUUID();
  const startedAt = performance.now();

  try {
    const response = await handler({ requestId });
    response.headers.set("x-request-id", requestId);
    logger.info("http_request", {
      requestId,
      method: request.method,
      path: new URL(request.url).pathname,
      status: response.status,
      durationMs: Math.round(performance.now() - startedAt),
    });
    return response;
  } catch (error) {
    const problem = toProblem(error, request, requestId);
    logger.error("http_request_failed", {
      requestId,
      method: request.method,
      path: new URL(request.url).pathname,
      status: problem.status,
      durationMs: Math.round(performance.now() - startedAt),
      errorName: error instanceof Error ? error.name : "UnknownError",
      errorMessage: error instanceof Error ? error.message : "Unknown error",
    });
    // Only 5xx is a real incident worth alerting on — expected 4xx (validation,
    // stale cart, not-found, etc.) is normal request flow, not something to page on.
    // Imported lazily (and skipped under Vitest): @sentry/nextjs's Node auto-
    // instrumentation hooks the module loader in a way that conflicts with
    // Vitest's own loader if pulled in at module scope of a file this many
    // tests import transitively (see instrumentation.ts for the same guard).
    if (problem.status >= 500 && !process.env.VITEST) {
      const Sentry = await import("@sentry/nextjs");
      Sentry.captureException(error, { tags: { requestId, path: new URL(request.url).pathname } });
    }
    return Response.json(problem.body, {
      status: problem.status,
      headers: { "content-type": "application/problem+json", "cache-control": "private, no-store", "x-request-id": requestId },
    });
  }
}

export function jsonData<T>(data: T, requestId: string, init: ResponseInit = {}) {
  const headers = new Headers(init.headers);
  headers.set("cache-control", headers.get("cache-control") ?? "private, no-store");
  headers.set("x-request-id", requestId);
  return Response.json({ data, meta: { requestId } }, { ...init, headers });
}

export function jsonList<T>(data: T[], requestId: string, options: { total: number; nextCursor: string | null }) {
  return Response.json(
    { data, meta: { requestId, total: options.total, nextCursor: options.nextCursor } },
    { headers: { "cache-control": "public, s-maxage=60, stale-while-revalidate=300", "x-request-id": requestId } },
  );
}
