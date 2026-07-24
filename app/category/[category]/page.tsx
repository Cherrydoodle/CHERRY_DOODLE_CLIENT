import type { Metadata } from "next";
import { notFound } from "next/navigation";

import { getCategoryFacets, listAllCategorySlugs, listCategories, listProducts } from "@/features/catalog/repository";
import { categoryFilterParams, sortOptions, type CategoryFilters, type SortOption } from "@/lib/category-filters";

import { CategoryView } from "./category-view";

const PAGE_SIZE = 24;

type RawSearchParams = Record<string, string | string[] | undefined>;

function first(value: string | string[] | undefined) {
  return Array.isArray(value) ? value[0] : value;
}

function parseSort(value: string | undefined): SortOption {
  return sortOptions.includes(value as SortOption) ? (value as SortOption) : "featured";
}

function parsePriceMax(value: string | undefined): number | undefined {
  if (value === undefined) return undefined;
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? Math.floor(parsed) : undefined;
}

export async function generateStaticParams() {
  const slugs = await listAllCategorySlugs();
  return slugs.map((category) => ({ category }));
}

export async function generateMetadata({ params }: { params: Promise<{ category: string }> }): Promise<Metadata> {
  const { category: slug } = await params;
  const category = (await listCategories()).find((item) => item.slug === slug);
  if (!category) return {};
  const description = category.seo.description ?? `Shop cute ${category.name.toLowerCase()} from Cherry Doodle.`;
  return {
    title: category.seo.title ?? category.name,
    description,
    alternates: { canonical: `/category/${category.slug}` },
    openGraph: {
      title: category.name,
      description,
      images: category.image ? [{ url: category.image.urls.detail, width: category.image.width, height: category.image.height, alt: category.name }] : undefined,
    },
  };
}

export default async function CategoryPage({ params, searchParams }: { params: Promise<{ category: string }>; searchParams: Promise<RawSearchParams> }) {
  const [{ category: slug }, rawSearch, categories] = await Promise.all([params, searchParams, listCategories()]);
  const category = categories.find((item) => item.slug === slug);
  if (!category) notFound();

  const requestedSubcategory = first(rawSearch.sub);
  const requestedColor = first(rawSearch.color);
  const filters: CategoryFilters = {
    sub: category.subcategories.some((item) => item.slug === requestedSubcategory) ? requestedSubcategory : undefined,
    sort: parseSort(first(rawSearch.sort)),
    sale: first(rawSearch.sale) === "true",
    color: requestedColor || undefined,
    priceMaxCents: parsePriceMax(first(rawSearch.priceMaxCents)),
    isNew: first(rawSearch.new) === "true",
    bestseller: first(rawSearch.bestseller) === "true",
  };

  const [productList, facets] = await Promise.all([
    listProducts({
      category: category.slug,
      sub: filters.sub,
      sale: filters.sale || undefined,
      isNew: filters.isNew || undefined,
      bestseller: filters.bestseller || undefined,
      color: filters.color,
      priceMaxCents: filters.priceMaxCents,
      sort: filters.sort,
      limit: PAGE_SIZE,
    }),
    getCategoryFacets({ category: category.slug, sub: filters.sub }),
  ]);

  const query = categoryFilterParams(category.slug, filters, PAGE_SIZE).toString();

  return (
    <CategoryView
      category={category}
      otherCategories={categories.filter((item) => item.slug !== category.slug)}
      filters={filters}
      facets={facets}
      initialItems={productList.items}
      nextCursor={productList.nextCursor}
      total={productList.total}
      query={query}
    />
  );
}
