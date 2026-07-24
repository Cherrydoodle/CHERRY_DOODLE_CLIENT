import posthog from "posthog-js";

import { getPublicAnalyticsConfig } from "@/lib/public-env";

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

// Query params that are capability credentials and must never reach PostHog. The
// checkout success page carries `checkoutToken` in its URL (the RSC needs it to load
// the confirmation server-side), and PostHog auto-attaches `$current_url`/`$referrer`
// to every captured event — including our manual `purchase` event — so those URLs are
// scrubbed here before any event leaves the browser.
const SENSITIVE_QUERY_PARAMS = ["checkoutToken", "token"];

function scrubUrl(value: unknown): unknown {
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
