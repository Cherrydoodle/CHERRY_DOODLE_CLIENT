"use client";

import { useEffect, useState } from "react";
import Image from "next/image";
import Link from "next/link";
import { ArrowRight, ChevronLeft, ChevronRight, Sparkles } from "lucide-react";

import heroBanner from "@/assets/hero-banner.jpg";
import type { HeroBannerDTO } from "@/features/catalog/types";
import { usePrefersReducedMotion } from "@/hooks/use-prefers-reduced-motion";
import { shimmerPlaceholder } from "@/lib/image/shimmer";

const AUTOPLAY_INTERVAL_MS = 3000;

export function HeroSlider({ banners }: { banners: HeroBannerDTO[] }) {
  const [activeIndex, setActiveIndex] = useState(0);
  const [paused, setPaused] = useState(false);
  const [tick, setTick] = useState(0);
  const reducedMotion = usePrefersReducedMotion();

  const goTo = (index: number) => {
    setActiveIndex(((index % banners.length) + banners.length) % banners.length);
    setTick((value) => value + 1);
  };
  const next = () => goTo(activeIndex + 1);
  const prev = () => goTo(activeIndex - 1);

  useEffect(() => {
    if (banners.length < 2 || paused || reducedMotion) return;
    const timer = setInterval(() => {
      setActiveIndex((current) => (current + 1) % banners.length);
    }, AUTOPLAY_INTERVAL_MS);
    return () => clearInterval(timer);
    // `tick` restarts the countdown whenever a slide change was triggered manually
    // (arrow, dot, keyboard), so autoplay never fires immediately after a user action.
  }, [banners.length, paused, reducedMotion, tick]);

  const handleKeyDown = (event: React.KeyboardEvent<HTMLDivElement>) => {
    if (banners.length < 2) return;
    if (event.key === "ArrowLeft") { event.preventDefault(); prev(); }
    if (event.key === "ArrowRight") { event.preventDefault(); next(); }
  };

  return (
    <section className="mx-auto max-w-7xl px-4 sm:px-6 pt-6">
      <div
        className="group relative overflow-hidden rounded-[2rem] sm:rounded-[3rem] shadow-pillow h-[420px] sm:h-[520px] md:h-[600px] outline-none"
        onMouseEnter={() => setPaused(true)}
        onMouseLeave={() => setPaused(false)}
        onKeyDown={handleKeyDown}
        tabIndex={banners.length > 1 ? 0 : undefined}
        role={banners.length > 1 ? "region" : undefined}
        aria-roledescription={banners.length > 1 ? "carousel" : undefined}
        aria-label={banners.length > 1 ? "Featured promotions" : undefined}
      >
        {banners.map((banner, index) => {
          const isActive = index === activeIndex;
          return (
            <div
              key={banner.id}
              aria-hidden={!isActive}
              className={`absolute inset-0 transition-opacity duration-700 ease-in-out ${
                isActive ? "opacity-100 z-10" : "opacity-0 z-0 pointer-events-none"
              }`}
            >
              <Image
                src={banner.image?.urls.detail ?? heroBanner}
                alt={banner.image?.alt ?? "Cute Korean stationery flat lay in soft pink"}
                preload={index === 0}
                fill
                sizes="100vw"
                placeholder="blur"
                blurDataURL={shimmerPlaceholder(1600, 900)}
                className="object-cover"
              />
              <div className="absolute inset-0 bg-gradient-to-r from-blush/95 via-blush/50 to-transparent" />
              <div className="absolute inset-0 flex flex-col justify-center px-6 sm:px-12 md:px-20 max-w-2xl">
                <span className="chip bg-white/90 text-cherry w-fit mb-4">
                  <Sparkles className="h-3 w-3" /> {banner.eyebrow}
                </span>
                <h1 className="font-display text-4xl sm:text-5xl md:text-6xl font-black leading-[1.05] text-foreground">
                  {banner.title}
                </h1>
                <p className="mt-4 text-base sm:text-lg text-foreground/80 max-w-md">
                  {banner.body}
                </p>
                <div className="mt-6 flex flex-wrap gap-3">
                  <Link href={banner.primaryHref} tabIndex={isActive ? undefined : -1} className="btn-primary">
                    {banner.primaryLabel} <ArrowRight className="h-4 w-4" />
                  </Link>
                  {banner.secondaryLabel && banner.secondaryHref && (
                    <Link href={banner.secondaryHref} tabIndex={isActive ? undefined : -1} className="btn-ghost-pink">
                      {banner.secondaryLabel}
                    </Link>
                  )}
                </div>
              </div>
            </div>
          );
        })}

        {banners.length > 1 && (
          <>
            <button
              type="button"
              aria-label="Previous slide"
              onClick={prev}
              className="absolute left-3 sm:left-5 top-1/2 z-20 -translate-y-1/2 grid h-9 w-9 sm:h-10 sm:w-10 place-items-center rounded-full bg-white/50 text-foreground transition-all hover:bg-white/80 cursor-pointer opacity-100 sm:opacity-0 sm:group-hover:opacity-100 sm:focus-visible:opacity-100"
            >
              <ChevronLeft className="h-5 w-5" />
            </button>
            <button
              type="button"
              aria-label="Next slide"
              onClick={next}
              className="absolute right-3 sm:right-5 top-1/2 z-20 -translate-y-1/2 grid h-9 w-9 sm:h-10 sm:w-10 place-items-center rounded-full bg-white/50 text-foreground transition-all hover:bg-white/80 cursor-pointer opacity-100 sm:opacity-0 sm:group-hover:opacity-100 sm:focus-visible:opacity-100"
            >
              <ChevronRight className="h-5 w-5" />
            </button>
          </>
        )}

        {banners.length > 1 && (
          <div className="absolute bottom-5 left-1/2 z-20 flex -translate-x-1/2 gap-2">
            {banners.map((banner, index) => (
              <button
                key={banner.id}
                type="button"
                aria-label={`Go to slide ${index + 1}`}
                aria-current={index === activeIndex}
                onClick={() => goTo(index)}
                className={`h-2 rounded-full transition-all duration-300 cursor-pointer ${
                  index === activeIndex ? "w-7 bg-white" : "w-2 bg-white/50 hover:bg-white/80"
                }`}
              />
            ))}
          </div>
        )}
      </div>
    </section>
  );
}
