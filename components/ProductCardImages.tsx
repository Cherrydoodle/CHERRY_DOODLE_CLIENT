"use client";

import Image from "next/image";
import { useEffect, useRef, useState } from "react";

import type { ImageDTO } from "@/features/catalog/types";
import { usePrefersReducedMotion } from "@/hooks/use-prefers-reduced-motion";
import { shimmerPlaceholder } from "@/lib/image/shimmer";

const ROTATE_INTERVAL_MS = 3000;

/**
 * Renders a product card's primary image, cross-fading through up to 3 additional
 * gallery images every 3s once the card scrolls into view. Off-screen cards render
 * only the first image and request nothing extra; once the gallery has loaded it
 * stays mounted (rotation just pauses) so scrolling away and back doesn't re-fetch it.
 */
export function ProductCardImages({ images }: { images: ImageDTO[] }) {
  const [visible, setVisible] = useState(false);
  const [hasBeenVisible, setHasBeenVisible] = useState(false);
  const [activeIndex, setActiveIndex] = useState(0);
  const reducedMotion = usePrefersReducedMotion();
  const wrapperRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    const node = wrapperRef.current;
    if (!node || images.length < 2) return;
    const observer = new IntersectionObserver(([entry]) => {
      setVisible(entry.isIntersecting);
      if (entry.isIntersecting) setHasBeenVisible(true);
    }, { threshold: 0.25 });
    observer.observe(node);
    return () => observer.disconnect();
  }, [images.length]);

  useEffect(() => {
    if (!visible || images.length < 2 || reducedMotion) return;
    const timer = setInterval(() => {
      setActiveIndex((current) => (current + 1) % images.length);
    }, ROTATE_INTERVAL_MS);
    return () => clearInterval(timer);
  }, [visible, images.length, reducedMotion]);

  const rendered = hasBeenVisible ? images : [images[0]];

  return (
    <div ref={wrapperRef} className="relative h-full w-full">
      {rendered.map((image, index) => (
        <Image
          key={image.id}
          src={image.urls.card}
          alt={image.alt}
          fill
          aria-hidden={index !== activeIndex}
          sizes="(min-width: 1024px) 25vw, 50vw"
          placeholder="blur"
          blurDataURL={shimmerPlaceholder(800, 800)}
          className={`object-cover transition duration-700 ease-in-out group-hover:scale-105 ${
            index === activeIndex ? "opacity-100" : "opacity-0"
          }`}
        />
      ))}
    </div>
  );
}
