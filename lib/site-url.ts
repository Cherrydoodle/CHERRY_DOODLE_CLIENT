const LOCAL_URL = "http://localhost:3000";

export function getSiteUrl() {
  const configuredUrl = process.env.NEXT_PUBLIC_SITE_URL?.trim();
  const vercelUrl = process.env.VERCEL_PROJECT_PRODUCTION_URL ?? process.env.VERCEL_URL;
  const value = configuredUrl || (vercelUrl ? `https://${vercelUrl}` : LOCAL_URL);

  try {
    const url = new URL(value);
    if (url.protocol !== "http:" && url.protocol !== "https:") throw new Error("unsupported protocol");
    return url;
  } catch {
    throw new Error(`Invalid site URL: ${value}. Set NEXT_PUBLIC_SITE_URL to an absolute http(s) URL.`);
  }
}
