import * as Sentry from "@sentry/nextjs";

import { getPublicSentryConfig } from "@/lib/public-env";

const config = getPublicSentryConfig();

Sentry.init({
  dsn: config?.dsn,
  enabled: Boolean(config),
  tracesSampleRate: 0.1,
});
