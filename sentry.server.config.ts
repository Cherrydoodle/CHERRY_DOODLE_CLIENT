import * as Sentry from "@sentry/nextjs";

import { getPublicSentryConfig } from "@/lib/public-env";
import { scrubSentryEvent } from "@/lib/security/scrub-url";

const config = getPublicSentryConfig();

Sentry.init({
  dsn: config?.dsn,
  enabled: Boolean(config),
  tracesSampleRate: 0.1,
  // /checkout/success carries a live capability token in its query string, and
  // Sentry records the full request URL on both errors and performance
  // transactions. Neither may leave the app un-redacted.
  beforeSend: scrubSentryEvent,
  beforeSendTransaction: scrubSentryEvent,
});
