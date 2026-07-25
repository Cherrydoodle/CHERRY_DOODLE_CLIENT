import posthog from "posthog-js";

import { getPublicAnalyticsConfig } from "@/lib/public-env";
import { scrubUrl } from "@/lib/security/scrub-url";

const CONSENT_KEY = "cd_cookie_consent";

export type AnalyticsConsent = "granted" | "denied";

export function getAnalyticsConsent(): AnalyticsConsent | null {
  if (typeof window === "undefined") return null;
  try {
    const value = window.localStorage.getItem(CONSENT_KEY);
    return value === "granted" || value === "denied" ? value : null;
  } catch {
    return null;
  }
}

export function setAnalyticsConsent(value: AnalyticsConsent) {
  try {
    window.localStorage.setItem(CONSENT_KEY, value);
  } catch {}
  if (value === "granted") initPosthogClient();
}

function shouldTrack(): boolean {
  return Boolean(getPublicAnalyticsConfig()) && getAnalyticsConsent() === "granted";
}

// PostHog auto-attaches `$current_url`/`$referrer` to every captured event —
// including our manual `purchase` event — so those URLs are scrubbed of capability
// tokens before anything leaves the browser. The scrubber is shared with the Sentry
// configs (see lib/security/scrub-url.ts) so the two cannot drift apart.
const URL_PROPERTY_KEYS = ["$current_url", "$referrer", "$initial_current_url", "$initial_referrer"];

export function initPosthogClient() {
  if (!shouldTrack()) return;
  const config = getPublicAnalyticsConfig()!;
  posthog.init(config.posthogKey, {
    api_host: config.posthogHost,
    capture_pageview: false,
    person_profiles: "identified_only",
    sanitize_properties: (properties) => {
      for (const key of URL_PROPERTY_KEYS) {
        if (key in properties) properties[key] = scrubUrl(properties[key]);
      }
      return properties;
    },
  });
}

export function track(event: string, properties?: Record<string, unknown>) {
  if (!shouldTrack()) return;
  posthog.capture(event, properties);
}
