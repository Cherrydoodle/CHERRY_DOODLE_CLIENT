import { z } from "zod";

import { booleanParam, integerParam } from "@/lib/http/request";
import type { ProductFilters, ProductSort } from "@/features/catalog/types";

export const slugSchema = z.string().trim().min(2).max(120).regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/);
const sorts = ["featured", "newest", "price-asc", "price-desc", "rating", "relevance"] as const;

export function parseProductFilters(url: URL, search = false): ProductFilters {
  const sortCandidate = url.searchParams.get("sort") ?? (search ? "relevance" : "featured");
  const sort = z.enum(sorts).parse(sortCandidate) as ProductSort;
  const q = url.searchParams.get("q")?.trim();

  return {
    category: optionalSlug(url.searchParams.get("category")),
    sub: optionalSlug(url.searchParams.get("sub")),
    sale: booleanParam(url.searchParams.get("sale")),
    isNew: booleanParam(url.searchParams.get("new")),
    bestseller: booleanParam(url.searchParams.get("bestseller")),
    color: optionalSlug(url.searchParams.get("color")),
    priceMaxCents: url.searchParams.has("priceMaxCents")
      ? integerParam(url.searchParams.get("priceMaxCents"), 0, 1, 10_000_000)
      : undefined,
    q: q ? z.string().min(1).max(100).parse(q) : undefined,
    sort,
    limit: integerParam(url.searchParams.get("limit"), 24, 1, 100),
    cursor: url.searchParams.get("cursor")?.slice(0, 500) || undefined,
  };
}

function optionalSlug(value: string | null) {
  return value ? slugSchema.parse(value) : undefined;
}
