import "server-only";

import * as Sentry from "@sentry/nextjs";

// Placeholder cadences — confirm and adjust these to match whatever actually
// triggers these routes (Vercel Cron, an external scheduler, etc.) via the
// matching CRON_SCHEDULE_* env var below. Sentry only flags a "missed run"
// once its configured cadence stops arriving, so a wrong value here produces
// false-positive missed-run alerts, not silently wrong job behavior — it's
// safe to ship, but worth confirming against the real scheduler config.
const DEFAULT_SCHEDULES = {
  "checkout-cleanup": "*/15 * * * *",
  "email-dispatch": "*/5 * * * *",
  "media-cleanup": "0 * * * *",
  "payment-reconciliation": "0 * * * *",
  "offer-schedule": "*/5 * * * *",
  "delhivery-tracking": "*/15 * * * *",
} as const;

type MonitorSlug = keyof typeof DEFAULT_SCHEDULES;

export async function withCronMonitor<T>(slug: MonitorSlug, task: () => Promise<T>): Promise<T> {
  const envKey = `CRON_SCHEDULE_${slug.toUpperCase().replaceAll("-", "_")}`;
  const schedule = process.env[envKey]?.trim() || DEFAULT_SCHEDULES[slug];
  return Sentry.withMonitor(slug, () => task(), {
    schedule: { type: "crontab", value: schedule },
    checkinMargin: 5,
    maxRuntime: 15,
  });
}
