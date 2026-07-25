import "server-only";

import { createHash } from "node:crypto";
import type { StaticImageData } from "next/image";

import heroBanner from "@/assets/hero-banner.jpg";
import { categories, products, type Product } from "@/lib/products";
import { decodeCursor, encodeCursor } from "@/features/catalog/cursor";
import type { CategoryDTO, HomeDTO, ImageDTO, ProductDetailDTO, ProductFilters, ProductListDTO, ProductSummaryDTO } from "@/features/catalog/types";

// Placeholder USD->INR rate used only by the static fallback catalog so its prices
// match the DB catalog (RZ-030). The live catalog reads real INR prices from Supabase.
const INR_RATE = 83;

function stableUuid(value: string) {
  const hex = createHash("sha256").update(value).digest("hex").slice(0, 32).split("");
  hex[12] = "4";
  hex[16] = ((Number.parseInt(hex[16]!, 16) & 0x3) | 0x8).toString(16);
  const joined = hex.join("");
  return `${joined.slice(0, 8)}-${joined.slice(8, 12)}-${joined.slice(12, 16)}-${joined.slice(16, 20)}-${joined.slice(20)}`;
}

function colorSlug(name: string) {
  return name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
}

function imageDto(image: StaticImageData, id: string, alt: string): ImageDTO {
  return { id: stableUuid(`image:${id}`), alt, width: image.width, height: image.height, urls: { thumb: image.src, card: image.src, detail: image.src } };
}

export function staticProductSummary(product: Product): ProductSummaryDTO {
  return {
    id: stableUuid(`product:${product.id}`),
    slug: product.id,
    name: product.name,
    label: product.label,
    pricing: {
      currency: "INR",
      listCents: product.price * 100 * INR_RATE,
      saleCents: product.salePrice === undefined ? null : product.salePrice * 100 * INR_RATE,
      effectiveCents: (product.salePrice ?? product.price) * 100 * INR_RATE,
    },
    primaryImage: imageDto(product.image, product.id, product.name),
    colors: product.colors.map((color) => ({ id: stableUuid(`color:${color.name}`), name: color.name, slug: colorSlug(color.name), hex: color.hex })),
    defaultVariantId: null,
    rating: { average: product.rating, count: product.reviews },
    badges: [...product.badges],
    availability: "in_stock",
  };
}

export function staticCategories(): CategoryDTO[] {
  return categories.map((category) => ({
    id: stableUuid(`category:${category.slug}`),
    slug: category.slug,
    name: category.name,
    description: `Browse our ${category.name.toLowerCase()} collection.`,
    emoji: category.emoji,
    image: imageDto(category.image, category.slug, category.name),
    seo: { title: category.name, description: `Shop cute ${category.name.toLowerCase()} from Cherry Doodle.` },
    subcategories: category.subcategories.map((subcategory) => ({
      id: stableUuid(`category:${subcategory.slug}`), slug: subcategory.slug, name: subcategory.name,
    })),
  }));
}

export function staticListProducts(filters: ProductFilters): ProductListDTO {
  let list = [...products];
  if (filters.category) list = list.filter((product) => product.category === filters.category);
  if (filters.sub) list = list.filter((product) => product.subcategory === filters.sub);
  if (filters.sale) list = list.filter((product) => product.salePrice !== undefined);
  // The static fallback catalog (used when Supabase isn't configured) carries no
  // offer data, so an offer-only filter always yields an empty list rather than
  // silently ignoring the filter and returning everything.
  if (filters.offer) list = [];
  if (filters.isNew) list = list.filter((product) => product.badges.includes("new"));
  if (filters.bestseller) list = list.filter((product) => product.badges.includes("bestseller"));
  if (filters.color) list = list.filter((product) => product.colors.some((color) => colorSlug(color.name) === filters.color));
  if (filters.priceMaxCents) list = list.filter((product) => (product.salePrice ?? product.price) * 100 <= filters.priceMaxCents!);
  if (filters.q) {
    const needle = filters.q.toLowerCase();
    list = list.filter((product) => [product.name, product.label, product.description, product.category, product.subcategory].some((value) => value.toLowerCase().includes(needle)));
  }
  if (filters.sort === "newest") list.sort((a, b) => Number(b.badges.includes("new")) - Number(a.badges.includes("new")));
  if (filters.sort === "price-asc") list.sort((a, b) => (a.salePrice ?? a.price) - (b.salePrice ?? b.price));
  if (filters.sort === "price-desc") list.sort((a, b) => (b.salePrice ?? b.price) - (a.salePrice ?? a.price));
  if (filters.sort === "rating") list.sort((a, b) => b.rating - a.rating);
  const total = list.length;
  const offset = decodeCursor(filters.cursor);
  const page = list.slice(offset, offset + filters.limit).map(staticProductSummary);
  return { items: page, total, nextCursor: offset + page.length < total ? encodeCursor(offset + page.length) : null };
}

export function staticProductDetail(slug: string): ProductDetailDTO | null {
  const product = products.find((item) => item.id === slug);
  if (!product) return null;
  const category = categories.find((item) => item.slug === product.category);
  const subcategory = category?.subcategories.find((item) => item.slug === product.subcategory);
  if (!category || !subcategory) return null;
  const summary = staticProductSummary(product);
  const gallery = product.gallery?.length ? product.gallery : [product.image];
  return {
    ...summary,
    description: product.description,
    material: product.material,
    size: product.size,
    category: { slug: subcategory.slug, name: subcategory.name, parent: { slug: category.slug, name: category.name } },
    gallery: gallery.map((image, index) => imageDto(image, `${product.id}:${index}`, product.name)),
    variants: product.colors.map((color, index) => ({
      id: stableUuid(`variant:${product.id}:${color.name}`),
      sku: `STATIC-${product.id}-${index + 1}`,
      color: { id: stableUuid(`color:${color.name}`), name: color.name, slug: colorSlug(color.name), hex: color.hex },
      availability: "in_stock",
      maxQuantity: 99,
    })),
    shippingMessage: "Shipping is calculated at checkout. We ship across India via Delhivery, dispatched in 1–2 business days.",
    returnsMessage: "Returns within 7 days for unused items in original packaging (damaged or wrong items).",
    related: products.filter((item) => item.category === product.category && item.id !== product.id).slice(0, 4).map(staticProductSummary),
  };
}

// Mirrors the backfill in features/catalog/repository.ts#getHome so Bestsellers/New
// Arrivals still show exactly 4 cards when fewer than 4 static products carry the badge.
function backfillTo(primary: ProductSummaryDTO[], pool: ProductSummaryDTO[], target: number): ProductSummaryDTO[] {
  if (primary.length >= target) return primary.slice(0, target);
  const seen = new Set(primary.map((product) => product.id));
  const filled = [...primary];
  for (const product of pool) {
    if (filled.length >= target) break;
    if (seen.has(product.id)) continue;
    seen.add(product.id);
    filled.push(product);
  }
  return filled;
}

export function staticHome(): HomeDTO {
  const list = (predicate: (product: Product) => boolean, limit: number) => products.filter(predicate).slice(0, limit).map(staticProductSummary);
  const featuredPool = products.slice(0, 24).map(staticProductSummary);
  return {
    heroBanners: [{
      id: stableUuid("content-block:home.hero"),
      eyebrow: "New Arrivals", title: "New Arrivals for a sweeter desk",
      body: "Cute Korean stationery made for everyday joy — pens, stickers, notebooks, and pastel little things.",
      primaryLabel: "Shop New Arrivals", primaryHref: "/category/paper-goods",
      secondaryLabel: "Explore Stickers", secondaryHref: "/category/stickers-deco",
      image: imageDto(heroBanner, "home-hero", "Cherry Doodle stationery collection"),
    }],
    saleBanner: {
      eyebrow: "Limited time", title: "Sweet Sale — up to 30% off",
      body: "Blush bottles, heart pouches, dreamy sticker kits and more.", primaryLabel: "Shop the Sale",
      primaryHref: "/category/bottles-lifestyle?sale=true", image: null,
    },
    categories: staticCategories(),
    bestsellers: backfillTo(list((product) => product.badges.includes("bestseller"), 4), featuredPool, 4),
    newArrivals: backfillTo(list((product) => product.badges.includes("new"), 4), featuredPool, 4),
    saleProducts: list((product) => product.salePrice !== undefined, 4),
    featured: featuredPool.slice(0, 8),
    serviceMessages: [
      { emoji: "🚚", title: "Ships across India", body: "Dispatched in 1–2 business days" },
      { emoji: "🎀", title: "Free gift on your first order", body: "A surprise sticker sheet inside" },
      { emoji: "💌", title: "Cute customer care", body: "We reply in 24 hours, with hearts" },
    ],
  };
}
