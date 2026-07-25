import * as Sentry from "@sentry/nextjs";

import { initPosthogClient, track } from "@/lib/analytics/posthog";
import { getPublicSentryConfig } from "@/lib/public-env";
import { scrubSentryEvent } from "@/lib/security/scrub-url";

const sentryConfig = getPublicSentryConfig();

Sentry.init({
  dsn: sentryConfig?.dsn,
  enabled: Boolean(sentryConfig),
  tracesSampleRate: 0.1,
  // Same capability-token redaction PostHog gets — the checkout confirmation URL
  // must not reach a third party intact from the browser either.
  beforeSend: scrubSentryEvent,
  beforeSendTransaction: scrubSentryEvent,
});

initPosthogClient();

// PostHog's own pageview autocapture doesn't see client-side App Router
// navigations; this hook fires on every route transition instead.
export function onRouterTransitionStart(url: string) {
  track("$pageview", { $current_url: url });
}
