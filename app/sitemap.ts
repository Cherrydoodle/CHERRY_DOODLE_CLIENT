import type { MetadataRoute } from "next";

import { listCategories, listProducts } from "@/features/catalog/repository";
import { getSiteUrl } from "@/lib/site-url";

async function allProductSlugs() {
  const slugs: string[] = [];
  let cursor: string | null | undefined;
  do {
    const page = await listProducts({ sort: "featured", limit: 100, cursor: cursor ?? undefined });
    slugs.push(...page.items.map((item) => item.slug));
    cursor = page.nextCursor;
  } while (cursor);
  return slugs;
}

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const siteUrl = getSiteUrl();
  const entry = (path: string, priority: number): MetadataRoute.Sitemap[number] => ({
    url: new URL(path, siteUrl).toString(),
    changeFrequency: "weekly",
    priority,
  });

  const [categories, productSlugs] = await Promise.all([listCategories(), allProductSlugs()]);

  return [
    entry("/", 1),
    entry("/collections/all", 0.9),
    ...categories.map((category) => entry(`/category/${category.slug}`, 0.8)),
    ...productSlugs.map((slug) => entry(`/product/${slug}`, 0.7)),
  ];
}
