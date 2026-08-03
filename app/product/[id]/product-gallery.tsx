"use client";

import Image from "next/image";
import { useEffect, useRef, useState, type KeyboardEvent } from "react";
import { ChevronLeft, ChevronRight } from "lucide-react";

import { ProductBadges } from "@/components/ProductCard";
import type { ImageDTO } from "@/features/catalog/types";
import { useDocumentVisible } from "@/hooks/use-document-visible";
import { usePrefersReducedMotion } from "@/hooks/use-prefers-reduced-motion";
import { shimmerPlaceholder } from "@/lib/image/shimmer";

const AUTOPLAY_INTERVAL_MS = 5000;

export function ProductGallery({ images, badges }: { images: ImageDTO[]; badges: Array<"new" | "bestseller" | "sale"> }) {
  const [index, setIndex] = useState(0);
  const [paused, setPaused] = useState(false);
  const [tick, setTick] = useState(0);
  const [inView, setInView] = useState(false);
  const wrapperRef = useRef<HTMLDivElement | null>(null);
  const documentVisible = useDocumentVisible();
  const reducedMotion = usePrefersReducedMotion();

  const goTo = (nextIndex: number) => {
    setIndex(((nextIndex % images.length) + images.length) % images.length);
    setTick((value) => value + 1);
  };
  const next = () => goTo(index + 1);
  const prev = () => goTo(index - 1);

  useEffect(() => {
    const node = wrapperRef.current;
    if (!node || images.length < 2) return;
    const observer = new IntersectionObserver(([entry]) => setInView(entry.isIntersecting), { threshold: 0.25 });
    observer.observe(node);
    return () => observer.disconnect();
  }, [images.length]);

  useEffect(() => {
    if (images.length < 2 || paused || reducedMotion || !documentVisible || !inView) return;
    const timer = setInterval(() => {
      setIndex((current) => (current + 1) % images.length);
    }, AUTOPLAY_INTERVAL_MS);
    return () => clearInterval(timer);
    // `tick` restarts the countdown whenever a slide change was triggered manually
    // (arrow, thumbnail, keyboard), so autoplay never fires immediately after a user action.
  }, [images.length, paused, reducedMotion, documentVisible, inView, tick]);

  const handleKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (images.length < 2) return;
    if (event.key === "ArrowLeft") { event.preventDefault(); prev(); }
    if (event.key === "ArrowRight") { event.preventDefault(); next(); }
  };

  const active = images[index]!;

  return (
    <div>
      <div
        ref={wrapperRef}
        className="group relative rounded-3xl overflow-hidden bg-blush shadow-soft aspect-square outline-none"
        onMouseEnter={() => setPaused(true)}
        onMouseLeave={() => setPaused(false)}
        onFocus={() => setPaused(true)}
        onBlur={() => setPaused(false)}
        onKeyDown={handleKeyDown}
        tabIndex={images.length > 1 ? 0 : undefined}
        role={images.length > 1 ? "region" : undefined}
        aria-roledescription={images.length > 1 ? "carousel" : undefined}
        aria-label={images.length > 1 ? "Product images" : undefined}
      >
        <Image
          src={active.urls.detail}
          alt={active.alt}
          preload
          fill
          sizes="(min-width: 1024px) 50vw, 100vw"
          placeholder="blur"
          blurDataURL={shimmerPlaceholder(1200, 1200)}
          className="object-cover"
        />
        <ProductBadges badges={badges} />

        {images.length > 1 && (
          <>
            <button
              type="button"
              aria-label="Previous image"
              onClick={prev}
              className="absolute left-3 top-1/2 z-20 -translate-y-1/2 grid h-9 w-9 place-items-center rounded-full bg-white/70 text-foreground transition-all hover:bg-white/90 cursor-pointer opacity-100 sm:opacity-0 sm:group-hover:opacity-100 sm:focus-visible:opacity-100"
            >
              <ChevronLeft className="h-5 w-5" />
            </button>
            <button
              type="button"
              aria-label="Next image"
              onClick={next}
              className="absolute right-3 top-1/2 z-20 -translate-y-1/2 grid h-9 w-9 place-items-center rounded-full bg-white/70 text-foreground transition-all hover:bg-white/90 cursor-pointer opacity-100 sm:opacity-0 sm:group-hover:opacity-100 sm:focus-visible:opacity-100"
            >
              <ChevronRight className="h-5 w-5" />
            </button>
            <span aria-live="polite" className="sr-only">{`Image ${index + 1} of ${images.length}`}</span>
          </>
        )}
      </div>

      <div className="grid grid-cols-4 gap-3 mt-3">
        {images.map((image, thumbIndex) => (
          <button
            type="button"
            key={image.id}
            onClick={() => goTo(thumbIndex)}
            className={`relative aspect-square rounded-2xl overflow-hidden border-2 ${index === thumbIndex ? "border-primary" : "border-transparent"}`}
            aria-label={`Show product image ${thumbIndex + 1}`}
            aria-pressed={index === thumbIndex}
          >
            <Image src={image.urls.thumb} alt="" fill sizes="120px" placeholder="blur" blurDataURL={shimmerPlaceholder(160, 160)} className="object-cover" />
          </button>
        ))}
      </div>
    </div>
  );
}
