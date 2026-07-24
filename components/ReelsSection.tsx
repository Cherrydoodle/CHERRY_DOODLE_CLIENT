"use client";

import { useEffect } from "react";

import { InstagramEmbed } from "@/components/InstagramEmbed";
import type { ReelDTO } from "@/features/catalog/types";

declare global {
  interface Window {
    instgrm?: { Embeds: { process: () => void } };
  }
}

const EMBED_SCRIPT_SRC = "https://www.instagram.com/embed.js";
let embedScriptPromise: Promise<void> | null = null;

// Load Instagram's embed.js exactly once per document, then let callers process().
function loadEmbedScript(): Promise<void> {
  if (typeof window === "undefined") return Promise.resolve();
  if (window.instgrm) return Promise.resolve();
  if (embedScriptPromise) return embedScriptPromise;
  embedScriptPromise = new Promise<void>((resolve) => {
    const existing = document.querySelector<HTMLScriptElement>(`script[src="${EMBED_SCRIPT_SRC}"]`);
    if (existing) {
      existing.addEventListener("load", () => resolve(), { once: true });
      if (window.instgrm) resolve();
      return;
    }
    const script = document.createElement("script");
    script.src = EMBED_SCRIPT_SRC;
    script.async = true;
    script.addEventListener("load", () => resolve(), { once: true });
    script.addEventListener("error", () => resolve(), { once: true });
    document.body.appendChild(script);
  });
  return embedScriptPromise;
}

export function ReelsSection({ reels, instagramUrl }: { reels: ReelDTO[]; instagramUrl: string | null }) {
  useEffect(() => {
    if (reels.length === 0) return;
    let active = true;
    loadEmbedScript().then(() => {
      if (active) window.instgrm?.Embeds.process();
    });
    return () => {
      active = false;
    };
  }, [reels]);

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
      <div className="grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
        {reels.map((reel) => (
          <InstagramEmbed key={reel.id} url={reel.reelUrl} caption={reel.caption} />
        ))}
      </div>
    </section>
  );
}
