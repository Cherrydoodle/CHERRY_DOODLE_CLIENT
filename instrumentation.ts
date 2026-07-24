import type { Instrumentation } from "next";

// Next.js boot hook. `register` runs once when a server instance starts and must
// complete before the server accepts requests. We use it to fail fast when the
// server environment is misconfigured, so a deploy with missing/placeholder secrets
// never serves traffic. See lib/env.server.ts#assertServerEnv.
export async function register() {
  // No live requests are served during `next build`'s static-generation phase
  // (or in the Edge runtime, which uses its own sentry.edge.config below), so
  // there's nothing for Sentry to instrument yet — skip it, same as the env
  // check below. This ordering also means a test that never sets NEXT_PHASE to
  // anything but the build phase (tests/env-validation.test.ts) never reaches
  // the Sentry import at all, regardless of what it does to process.env.
  if (process.env.NEXT_PHASE === "phase-production-build") return;

  // Sentry's Node auto-instrumentation (import-in-the-middle) hooks the module
  // loader in a way that hangs under Vitest's own loader — skip it under test.
  if (!process.env.VITEST) {
    if (process.env.NEXT_RUNTIME === "nodejs") {
      await import("./sentry.server.config");
    } else if (process.env.NEXT_RUNTIME === "edge") {
      await import("./sentry.edge.config");
    }
  }

  // Only validate in the Node.js server runtime — skip the Edge runtime.
  if (process.env.NEXT_RUNTIME !== "nodejs") return;

  const { assertServerEnv } = await import("./lib/env.server");
  assertServerEnv();
}

// Captures errors that escape Server Components, Route Handlers not wrapped by
// lib/http/route.ts#handleRoute, and Server Actions. handleRoute's catch block
// already reports API route errors directly (see its Sentry.captureException call),
// since it converts them into a normal Response and Next never sees them escape.
//
// @sentry/nextjs is imported lazily here (not as a static top-level import) so
// that merely importing this file — which tests/env-validation.test.ts does —
// doesn't eagerly cold-load the whole package; onRequestError is only ever
// actually invoked by a live Next.js server, never by the test runner.
export const onRequestError: Instrumentation.onRequestError = async (...args) => {
  const Sentry = await import("@sentry/nextjs");
  return Sentry.captureRequestError(...args);
};
