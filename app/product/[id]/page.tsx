import type { Metadata } from "next";
import { notFound } from "next/navigation";

import { getProductDetail, listAllProductSlugs } from "@/features/catalog/repository";
import { getSiteUrl } from "@/lib/site-url";

import { ProductView } from "./product-view";

export async function generateStaticParams() {
  const slugs = await listAllProductSlugs();
  return slugs.map((id) => ({ id }));
}

export async function generateMetadata({ params }: { params: Promise<{ id: string }> }): Promise<Metadata> {
  const { id } = await params;
  const product = await getProductDetail(id);
  if (!product) return {};

  return {
    title: product.name,
    description: product.description,
    alternates: { canonical: `/product/${product.slug}` },
    openGraph: {
      title: product.name,
      description: product.description,
      images: [{ url: product.primaryImage.urls.detail, width: product.primaryImage.width, height: product.primaryImage.height, alt: product.primaryImage.alt }],
    },
    twitter: { card: "summary_large_image", images: [product.primaryImage.urls.detail] },
  };
}

export default async function ProductPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const product = await getProductDetail(id);
  if (!product) notFound();

  const siteUrl = getSiteUrl();
  const jsonLd = {
    "@context": "https://schema.org",
    "@type": "Product",
    name: product.name,
    description: product.description,
    image: [product.primaryImage.urls.detail],
    category: product.category.name,
    sku: product.variants[0]?.sku ?? product.slug,
    offers: {
      "@type": "Offer",
      priceCurrency: product.pricing.currency,
      price: (product.pricing.effectiveCents / 100).toFixed(2),
      availability: product.availability === "out_of_stock" ? "https://schema.org/OutOfStock" : "https://schema.org/InStock",
      url: new URL(`/product/${product.slug}`, siteUrl).toString(),
    },
  };

  return (
    <>
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd).replace(/</g, "\\u003c") }} />
      <ProductView product={product} />
    </>
  );
}
