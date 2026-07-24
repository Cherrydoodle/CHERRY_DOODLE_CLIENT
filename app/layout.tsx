import type { Metadata, Viewport } from "next";
import { Fraunces, Nunito } from "next/font/google";

import heroBanner from "@/assets/hero-banner.jpg";
import { BottomNav } from "@/components/BottomNav";
import { Footer } from "@/components/Footer";
import { Header } from "@/components/Header";
import { listCategories, listMarquee } from "@/features/catalog/repository";
import { getStoreIdentity } from "@/features/store/identity";
import { getSiteUrl } from "@/lib/site-url";

import "./globals.css";
import { Providers } from "./providers";

const fraunces = Fraunces({
  variable: "--font-fraunces",
  subsets: ["latin"],
  display: "swap",
});

const nunito = Nunito({
  variable: "--font-nunito",
  subsets: ["latin"],
  display: "swap",
});

const description =
  "Soft pastel Korean stationery: gel pens, stickers, notebooks, and cute lifestyle accessories made for everyday joy.";
const siteUrl = getSiteUrl();

// Async so an admin-configured favicon (features/store/identity.ts) can be
// reflected in <head> — getStoreIdentity is deduped via React cache, so this
// doesn't add a second database round trip on top of RootLayout's own call.
//
// The favicon must be driven entirely from here, not app/favicon.ico: Next's
// file-based icon convention always injects its own <link rel="icon"> and
// takes precedence over (rather than being replaced by) metadata.icons, so
// the two can't coexist for a dynamically-configurable favicon. The static
// fallback file now lives at public/favicon.ico (a plain asset, no
// auto-injection) and is only referenced here when no admin favicon is set.
export async function generateMetadata(): Promise<Metadata> {
  const identity = await getStoreIdentity();
  const title = `${identity.storeName} — Cute Korean Stationery`;
  return {
    metadataBase: siteUrl,
    applicationName: identity.storeName,
    title: {
      default: title,
      template: `%s | ${identity.storeName}`,
    },
    description,
    icons: { icon: identity.favicon?.urls.thumb ?? "/favicon.ico" },
    openGraph: {
      type: "website",
      siteName: identity.storeName,
      title,
      description,
      images: [{ url: heroBanner.src, width: heroBanner.width, height: heroBanner.height, alt: `${identity.storeName} stationery collection` }],
    },
    twitter: {
      card: "summary_large_image",
      title,
      description,
      images: [heroBanner.src],
    },
  };
}

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  themeColor: "#f8e1e6",
};

export default async function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  const [categories, identity, marquee] = await Promise.all([listCategories(), getStoreIdentity(), listMarquee()]);
  const organizationJsonLd = {
    "@context": "https://schema.org",
    "@type": "Organization",
    name: identity.storeName,
    url: identity.website,
    email: identity.email,
    telephone: identity.phone,
    address: { "@type": "PostalAddress", streetAddress: identity.address, addressCountry: "IN" },
    ...(identity.instagram ? { sameAs: [identity.instagram] } : {}),
    ...(identity.logo ? { logo: identity.logo.urls.detail } : {}),
  };
  return (
    <html lang="en" className={`${fraunces.variable} ${nunito.variable}`}>
      <body>
        <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(organizationJsonLd) }} />
        <Providers>
          <div className="flex min-h-screen flex-col">
            <Header categories={categories} marquee={marquee} storeName={identity.storeName} logo={identity.logo} />
            <main className="flex-1 pb-16 md:pb-0">{children}</main>
            <Footer categories={categories} identity={{ email: identity.email, phone: identity.phone, address: identity.address, instagram: identity.instagram }} />
          </div>
          <BottomNav />
        </Providers>
      </body>
    </html>
  );
}
