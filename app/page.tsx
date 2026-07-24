import Image from "next/image";
import Link from "next/link";
import { ArrowRight } from "lucide-react";

import { getHome, listReels } from "@/features/catalog/repository";
import { getStoreIdentity } from "@/features/store/identity";
import { HeroSlider } from "@/components/HeroSlider";
import { ProductCard } from "@/components/ProductCard";
import { ReelsSection } from "@/components/ReelsSection";
import { shimmerPlaceholder } from "@/lib/image/shimmer";

export default async function Home() {
  const [home, reels, identity] = await Promise.all([getHome(), listReels(), getStoreIdentity()]);

  return (
    <div>
      <HeroSlider banners={home.heroBanners} />

      <section className="mx-auto max-w-7xl px-4 sm:px-6 mt-16">
        <div className="flex items-end justify-between mb-6">
          <div>
            <h2 className="font-display text-3xl sm:text-4xl font-black">Shop by category</h2>
            <p className="text-muted-foreground mt-1">Find your next cute little thing.</p>
          </div>
        </div>
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-4">
          {home.categories.map((category) => (
            <Link
              key={category.slug}
              href={`/category/${category.slug}`}
              className="group relative overflow-hidden rounded-3xl shadow-sm border border-border/40 transition-all hover:-translate-y-1 hover:shadow-lg"
            >
              <div className="aspect-square w-full overflow-hidden relative">
                {category.image && (
                  <Image
                    src={category.image.urls.card}
                    alt={category.image.alt}
                    fill
                    sizes="(min-width: 1024px) 20vw, 33vw"
                    placeholder="blur"
                    blurDataURL={shimmerPlaceholder(800, 800)}
                    className="object-cover transition-transform duration-500 group-hover:scale-110"
                  />
                )}
              </div>
              <div className="absolute inset-0 bg-gradient-to-t from-black/65 via-black/10 to-transparent" />
              <div className="absolute bottom-0 left-0 right-0 p-3 text-center text-white">
                <div className="text-xl">{category.emoji}</div>
                <div className="mt-0.5 font-display text-xs font-bold leading-tight">{category.name}</div>
                <div className="mt-0.5 text-[10px] opacity-75">{category.subcategories.length} categories</div>
              </div>
            </Link>
          ))}
        </div>
      </section>

      <section className="mx-auto max-w-7xl px-4 sm:px-6 mt-16">
        <SectionHeader title="Bestsellers" subtitle="Everyone's favorites this month" />
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
        <SectionHeader title="New Arrivals" subtitle="Fresh drops for your desk" />
        <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-4 sm:gap-6">
          {home.newArrivals.map((product) => <ProductCard key={product.id} product={product} />)}
        </div>
      </section>

      <section className="mx-auto max-w-7xl px-4 sm:px-6 mt-16">
        <SectionHeader title="Featured for you" subtitle="Handpicked cute finds" />
        <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-4 sm:gap-6">
          {home.featured.map((product) => <ProductCard key={product.id} product={product} />)}
        </div>
      </section>

      <ReelsSection reels={reels} instagramUrl={identity.instagram} />

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

function SectionHeader({ title, subtitle }: { title: string; subtitle: string }) {
  return (
    <div className="flex items-end justify-between mb-6">
      <div>
        <h2 className="font-display text-3xl sm:text-4xl font-black">{title}</h2>
        <p className="text-muted-foreground mt-1">{subtitle}</p>
      </div>
    </div>
  );
}
