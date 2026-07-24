import type { CSSProperties } from "react";

// Matches the width envelope Instagram's own embed markup uses; embed.js swaps the
// inner content for an iframe once processed. The <a> is the graceful fallback shown
// while the script loads or if it is blocked (e.g. by cookie consent / an ad blocker).
const blockquoteStyle: CSSProperties = { background: "#FFF", border: 0, margin: 0, maxWidth: 540, minWidth: 280, padding: 0, width: "100%" };

export function InstagramEmbed({ url, caption }: { url: string; caption?: string | null }) {
  return (
    <blockquote
      className="instagram-media mx-auto w-full overflow-hidden rounded-2xl border border-border shadow-soft"
      data-instgrm-permalink={url}
      data-instgrm-version="14"
      style={blockquoteStyle}
    >
      <a
        href={url}
        target="_blank"
        rel="noopener noreferrer"
        className="flex min-h-[420px] flex-col items-center justify-center gap-2 p-6 text-center text-sm font-semibold text-primary"
      >
        <span className="text-3xl">📸</span>
        {caption || "View this reel on Instagram"}
      </a>
    </blockquote>
  );
}
