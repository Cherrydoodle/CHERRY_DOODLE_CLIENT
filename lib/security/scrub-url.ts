// Query parameters that are capability credentials and must never leave the app
// inside telemetry. `/checkout/success` carries `checkoutToken` in its URL because
// the server component needs it to load the confirmation, and both PostHog and
// Sentry attach the current URL to everything they send.
//
// Dependency-free on purpose: this is imported by the browser analytics module, by
// the Sentry browser config, and by the Sentry server config, so it must not drag
// posthog-js (or anything else) into a bundle that does not already have it.
export const SENSITIVE_QUERY_PARAMS = ["checkoutToken", "token"];

export function scrubUrl(value: unknown): unknown {
  if (typeof value !== "string" || !value) return value;
  try {
    const url = new URL(value);
    let changed = false;
    for (const key of SENSITIVE_QUERY_PARAMS) {
      if (url.searchParams.has(key)) {
        url.searchParams.set(key, "[redacted]");
        changed = true;
      }
    }
    return changed ? url.toString() : value;
  } catch {
    return value;
  }
}

type SentryEventLike = {
  request?: { url?: unknown };
  transaction?: unknown;
  breadcrumbs?: Array<{ data?: Record<string, unknown> | undefined }> | undefined;
};

/**
 * Strips capability tokens from a Sentry event before it is sent. Sentry records
 * the full request URL on errors and on performance transactions, so without this
 * a single render error on the confirmation page would ship a live checkout token
 * to a third-party service (and into its search index and alert emails).
 */
export function scrubSentryEvent<T extends SentryEventLike>(event: T): T {
  if (event.request?.url) event.request.url = scrubUrl(event.request.url) as string;
  if (typeof event.transaction === "string") event.transaction = scrubUrl(event.transaction) as string;
  for (const breadcrumb of event.breadcrumbs ?? []) {
    if (breadcrumb.data && typeof breadcrumb.data.url === "string") {
      breadcrumb.data.url = scrubUrl(breadcrumb.data.url) as string;
    }
    if (breadcrumb.data && typeof breadcrumb.data.to === "string") {
      breadcrumb.data.to = scrubUrl(breadcrumb.data.to) as string;
    }
    if (breadcrumb.data && typeof breadcrumb.data.from === "string") {
      breadcrumb.data.from = scrubUrl(breadcrumb.data.from) as string;
    }
  }
  return event;
}
