export type PublicSupabaseConfig = {
  url: string;
  publishableKey: string;
};

export function getPublicSupabaseConfig(): PublicSupabaseConfig | null {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL?.trim();
  const publishableKey = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY?.trim();

  if (!url || !publishableKey) return null;

  try {
    const parsed = new URL(url);
    if (parsed.protocol !== "https:" && parsed.hostname !== "localhost" && parsed.hostname !== "127.0.0.1") {
      return null;
    }
  } catch {
    return null;
  }

  return { url, publishableKey };
}

export type PublicAnalyticsConfig = {
  posthogKey: string;
  posthogHost: string;
};

export function getPublicAnalyticsConfig(): PublicAnalyticsConfig | null {
  const posthogKey = process.env.NEXT_PUBLIC_POSTHOG_KEY?.trim();
  const posthogHost = process.env.NEXT_PUBLIC_POSTHOG_HOST?.trim();

  if (!posthogKey || !posthogHost) return null;

  try {
    if (new URL(posthogHost).protocol !== "https:") return null;
  } catch {
    return null;
  }

  return { posthogKey, posthogHost };
}

export type PublicSentryConfig = {
  dsn: string;
};

export function getPublicSentryConfig(): PublicSentryConfig | null {
  const dsn = process.env.NEXT_PUBLIC_SENTRY_DSN?.trim();
  if (!dsn) return null;

  try {
    if (new URL(dsn).protocol !== "https:") return null;
  } catch {
    return null;
  }

  return { dsn };
}
