"use client";

type LoaderArgs = { src: string; width: number; quality?: number };

const UPLOAD_MARKER = "/upload/";

// Rewrites the transformation segment of an already-built Cloudinary delivery URL
// (see features/media/delivery.ts, which always emits f_auto,q_auto) to request the
// specific width Next wants for its responsive srcset, instead of letting
// /_next/image re-fetch and re-encode an already-optimized Cloudinary image --
// avoiding double compression and a second round of hosting cost for the same byte.
// Non-Cloudinary sources (local/static assets) are returned unchanged.
export default function cloudinaryLoader({ src, width, quality }: LoaderArgs): string {
  const markerIndex = src.indexOf(UPLOAD_MARKER);
  if (markerIndex === -1) return src;

  const prefix = src.slice(0, markerIndex + UPLOAD_MARKER.length);
  const rest = src.slice(markerIndex + UPLOAD_MARKER.length);
  const slashIndex = rest.indexOf("/");
  if (slashIndex === -1) return src;

  const transformSegment = rest.slice(0, slashIndex);
  const path = rest.slice(slashIndex + 1);
  const params = transformSegment.split(",").filter(Boolean);
  const isFixedCrop = params.some((param) => param === "c_fill" || param === "c_fit" || param === "c_thumb");

  const kept = params.filter((param) => !/^[wh]_\d+$/.test(param) && !param.startsWith("q_") && !param.startsWith("f_"));
  const next = [
    "f_auto",
    ...kept,
    `w_${width}`,
    ...(isFixedCrop ? [`h_${width}`] : []),
    `q_${quality ?? "auto"}`,
  ];

  return `${prefix}${next.join(",")}/${path}`;
}
