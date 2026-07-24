export type Availability = "in_stock" | "low_stock" | "out_of_stock";

export type ImageDTO = {
  id: string;
  alt: string;
  width: number;
  height: number;
  urls: { thumb: string; card: string; detail: string };
};

export type MoneyDTO = {
  currency: string;
  listCents: number;
  saleCents: number | null;
  effectiveCents: number;
};

export type ColorDTO = { id: string; name: string; slug: string; hex: string };

export type MarqueeItemDTO = { id: string; text: string; link: string | null };
export type ReelDTO = { id: string; reelUrl: string; caption: string | null };

export type ProductSummaryDTO = {
  id: string;
  slug: string;
  name: string;
  label: string;
  pricing: MoneyDTO;
  primaryImage: ImageDTO;
  colors: ColorDTO[];
  /** The first in-stock variant, for one-click "quick add" flows that don't show a color picker. */
  defaultVariantId: string | null;
  rating: { average: number; count: number };
  badges: Array<"new" | "bestseller" | "sale">;
  availability: Availability;
};

export type ProductDetailDTO = ProductSummaryDTO & {
  description: string;
  material: string;
  size: string;
  category: { slug: string; name: string; parent: { slug: string; name: string } };
  gallery: ImageDTO[];
  variants: Array<{
    id: string;
    sku: string;
    color: ColorDTO;
    availability: Availability;
    maxQuantity: number;
  }>;
  shippingMessage: string;
  returnsMessage: string;
  related: ProductSummaryDTO[];
};

export type CategoryDTO = {
  id: string;
  slug: string;
  name: string;
  description: string;
  emoji: string | null;
  image: ImageDTO | null;
  seo: { title: string | null; description: string | null };
  subcategories: Array<{ id: string; slug: string; name: string }>;
};

export type ProductSort = "featured" | "newest" | "price-asc" | "price-desc" | "rating" | "relevance";

export type ProductFilters = {
  category?: string;
  sub?: string;
  sale?: boolean;
  isNew?: boolean;
  bestseller?: boolean;
  color?: string;
  priceMaxCents?: number;
  q?: string;
  sort: ProductSort;
  limit: number;
  cursor?: string;
};

export type ProductListDTO = { items: ProductSummaryDTO[]; total: number; nextCursor: string | null };

export type HeroBannerDTO = {
  id: string;
  eyebrow: string;
  title: string;
  body: string;
  primaryLabel: string;
  primaryHref: string;
  secondaryLabel: string | null;
  secondaryHref: string | null;
  image: ImageDTO | null;
};

export type HomeDTO = {
  heroBanners: HeroBannerDTO[];
  saleBanner: {
    eyebrow: string;
    title: string;
    body: string;
    primaryLabel: string;
    primaryHref: string;
    image: ImageDTO | null;
  };
  categories: CategoryDTO[];
  bestsellers: ProductSummaryDTO[];
  newArrivals: ProductSummaryDTO[];
  saleProducts: ProductSummaryDTO[];
  featured: ProductSummaryDTO[];
  serviceMessages: Array<{ title: string; body: string; emoji: string }>;
};
