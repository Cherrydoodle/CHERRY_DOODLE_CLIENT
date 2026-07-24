import type { MetadataRoute } from "next";

import { getStoreIdentity } from "@/features/store/identity";

export default async function manifest(): Promise<MetadataRoute.Manifest> {
  const identity = await getStoreIdentity();
  return {
    name: `${identity.storeName} — Cute Korean Stationery`,
    short_name: identity.storeName,
    description: "Cute Korean stationery made for everyday joy.",
    start_url: "/",
    display: "standalone",
    background_color: "#fffaf9",
    theme_color: "#f8e1e6",
    icons: identity.favicon
      ? [{ src: identity.favicon.urls.card, sizes: "any" }]
      : [{ src: "/favicon.ico", sizes: "any", type: "image/x-icon" }],
  };
}
