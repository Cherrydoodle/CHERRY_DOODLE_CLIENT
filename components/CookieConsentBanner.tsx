"use client";

import Link from "next/link";
import { useEffect, useState } from "react";

import { getAnalyticsConsent, setAnalyticsConsent, type AnalyticsConsent } from "@/lib/analytics/posthog";
import { getPublicAnalyticsConfig } from "@/lib/public-env";

export function CookieConsentBanner() {
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    // Nothing to ask consent for if analytics isn't even configured.
    if (!getPublicAnalyticsConfig()) return;
    // eslint-disable-next-line react-hooks/set-state-in-effect -- localStorage isn't available during SSR, so this must render null first (matching the server) and only decide to show the banner after hydration.
    if (getAnalyticsConsent() === null) setVisible(true);
  }, []);

  if (!visible) return null;

  const decide = (value: AnalyticsConsent) => {
    setAnalyticsConsent(value);
    setVisible(false);
  };

  return (
    <div
      role="dialog"
      aria-label="Cookie preferences"
      className="fixed inset-x-0 bottom-16 z-[60] border-t border-border bg-background/95 px-4 py-4 shadow-pillow backdrop-blur md:bottom-0 sm:px-6"
    >
      <div className="mx-auto flex max-w-4xl flex-col items-center gap-3 sm:flex-row sm:justify-between">
        <p className="text-sm text-muted-foreground">
          We use privacy-friendly analytics to understand how shoppers use Cherry Doodle — no ads, no cross-site tracking.{" "}
          <Link href="/privacy" className="underline hover:text-foreground">Learn more</Link>
        </p>
        <div className="flex shrink-0 gap-2">
          <button type="button" onClick={() => decide("denied")} className="btn-ghost-pink">Decline</button>
          <button type="button" onClick={() => decide("granted")} className="btn-primary">Accept</button>
        </div>
      </div>
    </div>
  );
}
