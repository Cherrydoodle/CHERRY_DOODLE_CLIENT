"use client";

import { InstagramEmbed } from "@/components/InstagramEmbed";
import { Carousel, CarouselContent, CarouselItem, CarouselNext, CarouselPrevious } from "@/components/ui/carousel";
import type { ReelDTO } from "@/features/catalog/types";

export function ReelsSection({ reels, instagramUrl }: { reels: ReelDTO[]; instagramUrl: string | null }) {
  if (reels.length === 0) return null;

  const handle = instagramUrl?.replace(/\/+$/, "").split("/").pop();

  return (
    <section className="mx-auto max-w-7xl px-4 sm:px-6 py-12">
      <div className="mb-8 flex flex-col items-center text-center">
        <h2 className="font-display text-2xl sm:text-3xl font-black text-cherry">Instagram shop</h2>
        <span className="mt-3 h-1 w-24 rounded-full bg-cherry" />
        {instagramUrl && (
          <a href={instagramUrl} target="_blank" rel="noopener noreferrer" className="btn-ghost-pink text-sm whitespace-nowrap mt-4">
            @{handle}
          </a>
        )}
      </div>
      <Carousel opts={{ align: "start", loop: reels.length > 1 }} className="mx-auto max-w-5xl px-8 sm:px-12">
        <CarouselContent>
          {reels.map((reel) => (
            <CarouselItem key={reel.id} className="basis-2/3 sm:basis-1/2 lg:basis-1/3">
              <InstagramEmbed url={reel.reelUrl} caption={reel.caption} />
            </CarouselItem>
          ))}
        </CarouselContent>
        {reels.length > 1 && (
          <>
            <CarouselPrevious />
            <CarouselNext />
          </>
        )}
      </Carousel>
    </section>
  );
}
