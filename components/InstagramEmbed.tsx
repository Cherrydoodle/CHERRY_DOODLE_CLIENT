// Instagram's public "/embed/" iframe (distinct from the embed.js blockquote
// version) always renders its own profile header and a like/comment/share
// footer row around the video -- there is no supported flag to remove them.
// The header is a near-fixed pixel height regardless of embed width, so
// HEADER_CROP_PX shifts the iframe up to skip it. The footer, by contrast,
// doesn't need its own crop offset -- content below the wrapper's visible
// window is clipped by `overflow-hidden` no matter how tall the iframe is,
// so FOOTER_CROP_PX only needs to comfortably exceed the tallest real footer.
// The wrapper's own aspect ratio is what actually keeps the footer out of
// view: it must stay shorter than a real embedded video's height at this
// width, so the visible window never reaches past the video into the footer.
// Measured against a live reel embed at 1520px width: header ~54px, video
// ~1901px (a ~4:5 ratio, not the app's own 9:16), footer ~154px. These are
// the fragile part of this component -- verify in a real browser if Instagram
// changes its embed chrome, and fall back to a cover-image + lightbox tile
// if cropping ever proves unstable across different posts' aspect ratios.
const HEADER_CROP_PX = 56;
const FOOTER_CROP_PX = 300;

function parseEmbedUrl(permalink: string): string | null {
  const match = permalink.match(/^https:\/\/(?:www\.)?instagram\.com\/(reel|reels|p)\/([A-Za-z0-9_-]+)\/?/i);
  if (!match) return null;
  const type = match[1].toLowerCase() === "p" ? "p" : "reel";
  return `https://www.instagram.com/${type}/${match[2]}/embed/?hidecaption=true`;
}

export function InstagramEmbed({ url, caption }: { url: string; caption?: string | null }) {
  const embedUrl = parseEmbedUrl(url);

  if (!embedUrl) {
    return <InstagramFallback url={url} caption={caption} />;
  }

  return (
    <div className="relative aspect-[6/7] w-full overflow-hidden rounded-2xl border border-border bg-white shadow-soft">
      <iframe
        src={embedUrl}
        title={caption || "Instagram reel"}
        className="absolute left-0 w-full border-0"
        style={{ top: -HEADER_CROP_PX, height: `calc(100% + ${HEADER_CROP_PX + FOOTER_CROP_PX}px)` }}
        scrolling="no"
        loading="lazy"
        allow="encrypted-media; picture-in-picture"
        allowFullScreen
      />
    </div>
  );
}

function InstagramFallback({ url, caption }: { url: string; caption?: string | null }) {
  return (
    <a
      href={url}
      target="_blank"
      rel="noopener noreferrer"
      className="flex aspect-[6/7] w-full flex-col items-center justify-center gap-2 rounded-2xl border border-border bg-white p-6 text-center text-sm font-semibold text-primary shadow-soft"
    >
      <span className="text-3xl">📸</span>
      {caption || "View this reel on Instagram"}
    </a>
  );
}
