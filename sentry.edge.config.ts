import * as Sentry from "@sentry/nextjs";

import { getPublicSentryConfig } from "@/lib/public-env";
import { scrubSentryEvent } from "@/lib/security/scrub-url";

const config = getPublicSentryConfig();

Sentry.init({
  dsn: config?.dsn,
  enabled: Boolean(config),
  tracesSampleRate: 0.1,
  // proxy.ts runs on the edge and sees /checkout/success URLs with their token.
  beforeSend: scrubSentryEvent,
  beforeSendTransaction: scrubSentryEvent,
});
