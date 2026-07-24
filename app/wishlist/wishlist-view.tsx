"use client";

import Image from "next/image";
import Link from "next/link";
import { Heart, ShoppingBag, X } from "lucide-react";

import { formatMoney } from "@/lib/format";
import { shimmerPlaceholder } from "@/lib/image/shimmer";
import { useShop } from "@/lib/store";
import { ProductBadges } from "@/components/ProductCard";

export function WishlistView() {
  const { wishlist, wishlistLoading, toggleWishlist, moveToCart } = useShop();

  if (!wishlistLoading && wishlist.length === 0) {
    return (
      <div className="mx-auto max-w-3xl px-6 py-20 text-center">
        <div className="text-6xl">💗</div>
        <h1 className="font-display text-3xl sm:text-4xl font-black mt-4">Your wishlist is empty</h1>
        <p className="text-muted-foreground mt-2">Save your favorites by tapping the heart on any product.</p>
        <Link href="/" className="btn-primary mt-6 inline-flex">Discover cute things</Link>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-7xl px-4 sm:px-6 py-10">
      <h1 className="font-display text-3xl sm:text-4xl font-black mb-2 flex items-center gap-3">
        <Heart className="h-8 w-8 fill-cherry text-cherry" /> Wishlist
      </h1>
      <p className="text-muted-foreground mb-8">{wishlist.length} saved treasure{wishlist.length !== 1 ? "s" : ""}</p>

      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-4 sm:gap-6">
        {wishlist.map((product) => (
          <div key={product.id} className="card-soft flex flex-col overflow-hidden relative">
            <div className="block relative aspect-square bg-blush">
              <Link href={`/product/${product.slug}`} className="relative block h-full w-full" aria-label={`View ${product.name}`}>
                <Image src={product.primaryImage.urls.card} alt={product.primaryImage.alt} fill sizes="(min-width: 1024px) 25vw, 50vw" placeholder="blur" blurDataURL={shimmerPlaceholder(800, 800)} className="object-cover" />
              </Link>
              <ProductBadges badges={product.badges} />
            </div>
            <button
              type="button"
              onClick={() => toggleWishlist(product)}
              className="absolute top-3 right-3 h-9 w-9 grid place-items-center rounded-full bg-white/90 shadow-soft"
              aria-label="Remove"
            >
              <X className="h-4 w-4" />
            </button>
            <div className="p-4 flex flex-col gap-2">
              <Link href={`/product/${product.slug}`} className="font-display font-bold line-clamp-2 hover:text-primary">{product.name}</Link>
              <div className="font-bold">
                {product.pricing.saleCents !== null ? (
                  <>
                    <span className="text-sale">{formatMoney(product.pricing.saleCents, product.pricing.currency)}</span>
                    <span className="ml-2 text-sm line-through text-muted-foreground">{formatMoney(product.pricing.listCents, product.pricing.currency)}</span>
                  </>
                ) : (
                  <>{formatMoney(product.pricing.listCents, product.pricing.currency)}</>
                )}
              </div>
              <button type="button" onClick={() => moveToCart(product.id)} disabled={product.availability === "out_of_stock"} className="btn-primary text-sm mt-1 disabled:cursor-not-allowed disabled:opacity-60">
                <ShoppingBag className="h-4 w-4" /> {product.availability === "out_of_stock" ? "Out of stock" : "Move to bag"}
              </button>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
