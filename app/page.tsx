import Image from "next/image";
import Link from "next/link";
import { ArrowRight, Tag } from "lucide-react";

import { getHome, listReels } from "@/features/catalog/repository";
import { getStoreIdentity } from "@/features/store/identity";
import { HeroSlider } from "@/components/HeroSlider";
import { ProductCard } from "@/components/ProductCard";
import { ReelsSection } from "@/components/ReelsSection";
import { formatEndsDate } from "@/lib/format";
import { shimmerPlaceholder } from "@/lib/image/shimmer";

export default async function Home() {
  const [home, reels, identity] = await Promise.all([getHome(), listReels(), getStoreIdentity()]);
  const hasOffers = home.offerProducts.length > 0;
  const topCampaign = home.offers[0] ?? null;

  return (
    <div>
      <HeroSlider banners={home.heroBanners} />

      <div className="mx-auto max-w-7xl px-4 sm:px-6 mt-6 flex flex-wrap justify-center gap-3">
        {hasOffers && (
          <Link href="/offers" className="btn-primary">
            <Tag className="h-4 w-4" /> Shop the Offers
          </Link>
        )}
        <Link href="/collections/all" className="btn-ghost-pink">
          Shop All
        </Link>
      </div>

      <section className="mx-auto max-w-7xl px-4 sm:px-6 mt-16">
        <div className="flex items-end justify-between mb-6">
          <div>
            <h2 className="font-display text-3xl sm:text-4xl font-black">Shop by category</h2>
            <p className="text-muted-foreground mt-1">Find your next cute little thing.</p>
          </div>
        </div>
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-4 sm:gap-6">
          {home.categories.map((category) => (
            <Link
              key={category.slug}
              href={`/category/${category.slug}`}
              className="group block text-center transition-all hover:-translate-y-1"
            >
              <div className="aspect-square w-full overflow-hidden rounded-3xl border border-border/40 shadow-sm relative">
                {category.image && (
                  <Image
                    src={category.image.urls.card}
                    alt={category.image.alt}
                    fill
                    sizes="(min-width: 1024px) 20vw, 33vw"
                    placeholder="blur"
                    blurDataURL={shimmerPlaceholder(800, 800)}
                    className="object-cover transition-transform duration-500 group-hover:scale-105"
                  />
                )}
              </div>
              <div className="mt-3 font-display text-sm sm:text-base font-bold text-foreground group-hover:text-primary transition-colors">
                {category.name}
              </div>
            </Link>
          ))}
        </div>
      </section>

      {hasOffers && (
        <section className="mx-auto max-w-7xl px-4 sm:px-6 mt-16">
          <SectionHeader
            title="Offers"
            subtitle={
              topCampaign
                ? [
                    topCampaign.discountPercent !== null ? `${topCampaign.name} · ${topCampaign.discountPercent}% off` : topCampaign.name,
                    formatEndsDate(topCampaign.endsAt),
                  ].filter(Boolean).join(" · ")
                : "Limited-time prices on picks we love."
            }
            actionHref="/offers"
            actionLabel="View all offers"
          />
          <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-4 sm:gap-6">
            {home.offerProducts.map((product) => <ProductCard key={product.id} product={product} />)}
          </div>
        </section>
      )}

      <section className="mx-auto max-w-7xl px-4 sm:px-6 mt-16">
        <SectionHeader title="Bestsellers" subtitle="Everyone's favorites this month" actionHref="/collections/all?bestseller=true" actionLabel="View all" />
        <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-4 sm:gap-6">
          {home.bestsellers.map((product) => <ProductCard key={product.id} product={product} />)}
        </div>
      </section>

      <section className="mx-auto max-w-7xl px-4 sm:px-6 mt-16">
        <div className="relative overflow-hidden rounded-[2rem] bg-gradient-to-r from-cherry to-primary p-8 sm:p-12 text-white shadow-pillow">
          <div className="grid md:grid-cols-2 items-center gap-6">
            <div>
              <span className="chip bg-white/20 text-white">{home.saleBanner.eyebrow}</span>
              <h3 className="font-display text-3xl sm:text-4xl font-black mt-3">{home.saleBanner.title}</h3>
              <p className="mt-2 text-white/90">{home.saleBanner.body}</p>
              <Link href={home.saleBanner.primaryHref} className="mt-5 inline-flex items-center gap-2 bg-white text-cherry font-bold rounded-full px-6 py-3 hover:scale-[1.02] transition">
                {home.saleBanner.primaryLabel} <ArrowRight className="h-4 w-4" />
              </Link>
            </div>
            <div className="grid grid-cols-3 gap-3">
              {home.saleProducts.slice(0, 3).map((product) => (
                <Link key={product.id} href={`/product/${product.slug}`} className="relative aspect-square rounded-2xl overflow-hidden bg-white/20">
                  <Image src={product.primaryImage.urls.card} alt={product.primaryImage.alt} fill sizes="(min-width: 768px) 16vw, 33vw" placeholder="blur" blurDataURL={shimmerPlaceholder(800, 800)} className="object-cover hover:scale-105 transition" />
                </Link>
              ))}
            </div>
          </div>
        </div>
      </section>

      <section className="mx-auto max-w-7xl px-4 sm:px-6 mt-16">
        <SectionHeader title="New Arrivals" subtitle="Fresh drops for your desk" actionHref="/collections/all?new=true" actionLabel="View all" />
        <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-4 sm:gap-6">
          {home.newArrivals.map((product) => <ProductCard key={product.id} product={product} />)}
        </div>
      </section>

      <section className="mx-auto max-w-7xl px-4 sm:px-6 mt-16">
        <SectionHeader title="Featured for you" subtitle="Handpicked cute finds" actionHref="/collections/all" actionLabel="Shop All" />
        <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-4 sm:gap-6">
          {home.featured.map((product) => <ProductCard key={product.id} product={product} />)}
        </div>
      </section>

      <ReelsSection reels={reels} instagramUrl={identity.instagram} />

      <section className="mx-auto max-w-7xl px-4 sm:px-6 mt-16">
        <div className="rounded-[2rem] bg-gradient-to-r from-cherry to-primary p-8 sm:p-12 text-white shadow-pillow text-center">
          <h3 className="font-display text-3xl sm:text-4xl font-black">Explore the whole shop</h3>
          <p className="mt-2 text-white/90">Every category, every color, all in one place.</p>
          <div className="mt-6 flex flex-wrap justify-center gap-3">
            <Link href="/collections/all" className="inline-flex items-center gap-2 bg-white text-cherry font-bold rounded-full px-6 py-3 hover:scale-[1.02] transition">
              Shop All <ArrowRight className="h-4 w-4" />
            </Link>
            {hasOffers && (
              <Link href="/offers" className="inline-flex items-center gap-2 border-2 border-white/70 text-white font-bold rounded-full px-6 py-3 hover:bg-white/10 transition">
                Browse Offers
              </Link>
            )}
          </div>
        </div>
      </section>

      <section className="mx-auto max-w-7xl px-4 sm:px-6 mt-16">
        <div className="rounded-[2rem] bg-blush py-8 px-6 grid sm:grid-cols-3 gap-6 text-center">
          {home.serviceMessages.map((message) => (
            <div key={message.title}>
              <div className="text-2xl">{message.emoji}</div>
              <div className="font-display font-bold mt-2">{message.title}</div>
              <div className="text-xs text-muted-foreground">{message.body}</div>
            </div>
          ))}
        </div>
      </section>
    </div>
  );
}

function SectionHeader({
  title, subtitle, actionHref, actionLabel,
}: {
  title: string;
  subtitle: string;
  actionHref?: string;
  actionLabel?: string;
}) {
  return (
    <div className="flex items-end justify-between mb-6">
      <div>
        <h2 className="font-display text-3xl sm:text-4xl font-black">{title}</h2>
        <p className="text-muted-foreground mt-1">{subtitle}</p>
      </div>
      {actionHref && actionLabel && (
        <Link href={actionHref} className="inline-flex items-center gap-1 text-sm font-bold text-primary hover:underline shrink-0">
          {actionLabel} <ArrowRight className="h-3.5 w-3.5" />
        </Link>
      )}
    </div>
  );
}
