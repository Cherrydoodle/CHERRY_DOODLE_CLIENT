function shimmerSvg(width: number, height: number) {
  return `<svg width="${width}" height="${height}" xmlns="http://www.w3.org/2000/svg">
  <defs>
    <linearGradient id="g">
      <stop stop-color="#f7e9ec" offset="20%" />
      <stop stop-color="#fdf5f6" offset="50%" />
      <stop stop-color="#f7e9ec" offset="70%" />
    </linearGradient>
  </defs>
  <rect width="${width}" height="${height}" fill="#f7e9ec" />
  <rect width="${width}" height="${height}" fill="url(#g)" />
</svg>`;
}

function toBase64(value: string) {
  if (typeof window === "undefined") return Buffer.from(value).toString("base64");
  return window.btoa(value);
}

// A cheap, network-free shimmer used as `blurDataURL` while a remote (Cloudinary)
// image loads. Generating a real low-res preview of the actual photo would need a
// server round trip per image; this gives the same anti-CLS/perceived-performance
// benefit without that cost.
export function shimmerPlaceholder(width = 400, height = 400) {
  return `data:image/svg+xml;base64,${toBase64(shimmerSvg(width, height))}`;
}
