"use client";

import Image from "next/image";
import Link from "next/link";
import { Heart, ShoppingBag } from "lucide-react";
import { useState } from "react";

import type { ProductSummaryDTO } from "@/features/catalog/types";
import { formatMoney } from "@/lib/format";
import { shimmerPlaceholder } from "@/lib/image/shimmer";
import { useShop } from "@/lib/store";

export function ProductBadges({ badges }: { badges: ProductSummaryDTO["badges"] }) {
  return (
    <div className="absolute top-3 left-3 flex flex-col gap-1.5">
      {badges.includes("new") && <span className="chip bg-mint text-foreground/80">New</span>}
      {badges.includes("bestseller") && <span className="chip bg-lilac text-foreground/80">Bestseller</span>}
      {badges.includes("sale") && <span className="chip bg-sale text-white">Sale</span>}
    </div>
  );
}

export function ProductCard({ product }: { product: ProductSummaryDTO }) {
  const { toggleWishlist, isWished, addToCart } = useShop();
  const wished = isWished(product.id);
  const hasSale = product.pricing.saleCents !== null;
  const canQuickAdd = Boolean(product.defaultVariantId) && product.availability !== "out_of_stock";
  const [adding, setAdding] = useState(false);

  const handleQuickAdd = async () => {
    if (adding || !product.defaultVariantId) return;
    setAdding(true);
    try {
      await addToCart(product.defaultVariantId, 1);
    } catch {
      // Surfaced via the global toast in useShop().addToCart.
    } finally {
      setAdding(false);
    }
  };

  return (
    <div className="card-soft group relative flex flex-col overflow-hidden">
      <div className="relative block aspect-square bg-blush overflow-hidden">
        <Link href={`/product/${product.slug}`} className="relative block h-full w-full" aria-label={`View ${product.name}`}>
          <Image
            src={product.primaryImage.urls.card}
            alt={product.primaryImage.alt}
            fill
            sizes="(min-width: 1024px) 25vw, 50vw"
            placeholder="blur"
            blurDataURL={shimmerPlaceholder(800, 800)}
            className="object-cover transition-transform duration-500 group-hover:scale-105"
          />
        </Link>
        <ProductBadges badges={product.badges} />
        <button
          type="button"
          onClick={() => toggleWishlist(product)}
          className="absolute top-3 right-3 h-9 w-9 grid place-items-center rounded-full bg-white/90 shadow-soft hover:scale-110 transition"
          aria-label="Wishlist"
          aria-pressed={wished}
        >
          <Heart className={`h-4 w-4 ${wished ? "fill-cherry text-cherry" : "text-foreground"}`} />
        </button>
      </div>

      {/* flex-1 fills the stretched card height (grid rows default to equal-height
          siblings), so mt-auto below always pins the button to the same bottom edge
          regardless of a 1- vs 2-line name or a missing color/sale row. */}
      <div className="p-4 flex flex-1 flex-col gap-2">
        <div className="text-[10px] uppercase tracking-wider text-muted-foreground font-semibold">{product.label}</div>
        <Link href={`/product/${product.slug}`} className="font-display text-lg font-bold leading-tight line-clamp-2 hover:text-primary transition">
          {product.name}
        </Link>
        <div className="flex items-center gap-2 mt-1">
          {hasSale ? (
            <>
              <span className="font-bold text-sale">{formatMoney(product.pricing.saleCents!, product.pricing.currency)}</span>
              <span className="text-sm line-through text-muted-foreground">{formatMoney(product.pricing.listCents, product.pricing.currency)}</span>
            </>
          ) : (
            <span className="font-bold">{formatMoney(product.pricing.listCents, product.pricing.currency)}</span>
          )}
        </div>
        <div className="flex items-center gap-1.5 mt-1">
          {product.colors.slice(0, 4).map((color) => (
            <span key={color.id} title={color.name} className="h-4 w-4 rounded-full border border-border shadow-sm" style={{ background: color.hex }} />
          ))}
          {product.colors.length > 4 && <span className="text-[10px] text-muted-foreground">+{product.colors.length - 4}</span>}
        </div>
        {canQuickAdd && (
          <button
            type="button"
            onClick={handleQuickAdd}
            disabled={adding}
            className="mt-auto flex items-center justify-center gap-2 rounded-2xl bg-primary px-4 py-2.5 text-sm font-bold text-primary-foreground shadow-pillow transition hover:brightness-105 disabled:opacity-60"
          >
            <ShoppingBag className="h-4 w-4" />
            {adding ? "Adding…" : "Add to Cart"}
          </button>
        )}
      </div>
    </div>
  );
}
