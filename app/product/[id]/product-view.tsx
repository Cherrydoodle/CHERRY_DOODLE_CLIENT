"use client";

import Image from "next/image";
import Link from "next/link";
import { ChevronRight, Heart, Minus, Plus, ShoppingBag, Truck, Undo2 } from "lucide-react";
import { useEffect, useState, type ReactNode } from "react";

import { ProductCard, ProductBadges } from "@/components/ProductCard";
import { track } from "@/lib/analytics/posthog";
import type { ProductDetailDTO } from "@/features/catalog/types";
import { formatMoney } from "@/lib/format";
import { shimmerPlaceholder } from "@/lib/image/shimmer";
import { ShopApiError, useShop } from "@/lib/store";

export function ProductView({ product }: { product: ProductDetailDTO }) {
  const [variantId, setVariantId] = useState(product.variants.find((item) => item.availability !== "out_of_stock")?.id ?? product.variants[0]?.id);
  const [qty, setQty] = useState(1);
  const [added, setAdded] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const { addToCart, toggleWishlist, isWished } = useShop();
  const [main, setMain] = useState(0);

  const variant = product.variants.find((item) => item.id === variantId) ?? product.variants[0];
  const outOfStock = !variant || variant.availability === "out_of_stock";
  // A variant with its own images swaps the whole gallery; otherwise it falls back
  // to the product's shared gallery, unchanged from before variants had images.
  const gallery = variant?.images.length ? variant.images : product.gallery.length ? product.gallery : [product.primaryImage];

  useEffect(() => {
    const price = product.pricing.saleCents ?? product.pricing.listCents;
    track("view_item", {
      currency: product.pricing.currency,
      value: price / 100,
      items: [{ item_id: product.id, item_name: product.name, price: price / 100 }],
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps -- fire once per product page visit; re-selecting a color variant shouldn't recount it.
  }, [product.id]);

  const handleAdd = async () => {
    if (!variant) return;
    setError(null);
    try {
      await addToCart(variant.id, qty);
      setAdded(true);
      window.setTimeout(() => setAdded(false), 1600);
    } catch (cause) {
      setError(cause instanceof ShopApiError ? cause.message : "Could not add this to your bag. Please try again.");
    }
  };

  return (
    <div className="mx-auto max-w-7xl px-4 sm:px-6 py-6 sm:py-10">
      <nav className="flex items-center gap-1 text-xs text-muted-foreground mb-6 flex-wrap" aria-label="Breadcrumb">
        <Link href="/" className="hover:text-primary">Home</Link>
        <ChevronRight className="h-3 w-3" />
        <Link href={`/category/${product.category.parent.slug}`} className="hover:text-primary">{product.category.parent.name}</Link>
        <ChevronRight className="h-3 w-3" />
        <span className="text-foreground font-semibold">{product.name}</span>
      </nav>

      <div className="grid gap-8 lg:grid-cols-2">
        <div>
          <div className="relative rounded-3xl overflow-hidden bg-blush shadow-soft aspect-square">
            <Image src={gallery[main]!.urls.detail} alt={gallery[main]!.alt} preload fill sizes="(min-width: 1024px) 50vw, 100vw" placeholder="blur" blurDataURL={shimmerPlaceholder(1200, 1200)} className="object-cover" />
            <ProductBadges badges={product.badges} />
          </div>
          <div className="grid grid-cols-4 gap-3 mt-3">
            {gallery.map((image, index) => (
              <button
                type="button"
                key={image.id}
                onClick={() => setMain(index)}
                className={`relative aspect-square rounded-2xl overflow-hidden border-2 ${main === index ? "border-primary" : "border-transparent"}`}
                aria-label={`Show product image ${index + 1}`}
                aria-pressed={main === index}
              >
                <Image src={image.urls.thumb} alt="" fill sizes="120px" placeholder="blur" blurDataURL={shimmerPlaceholder(160, 160)} className="object-cover" />
              </button>
            ))}
          </div>
        </div>

        <div>
          <div className="text-xs uppercase tracking-wider text-muted-foreground font-semibold">{product.label}</div>
          <h1 className="font-display text-3xl sm:text-4xl font-black mt-2">{product.name}</h1>

          <div className="flex items-baseline gap-3 mt-5">
            {product.pricing.saleCents !== null ? (
              <>
                <span className="font-display text-3xl font-black text-sale">{formatMoney(product.pricing.saleCents, product.pricing.currency)}</span>
                <span className="text-lg line-through text-muted-foreground">{formatMoney(product.pricing.listCents, product.pricing.currency)}</span>
                <span className="chip bg-sale text-white">Save {formatMoney(product.pricing.listCents - product.pricing.saleCents, product.pricing.currency)}</span>
              </>
            ) : (
              <span className="font-display text-3xl font-black">{formatMoney(product.pricing.listCents, product.pricing.currency)}</span>
            )}
          </div>

          <p className="mt-5 text-muted-foreground leading-relaxed">{product.description}</p>

          <div className="mt-6">
            <div className="text-sm font-semibold mb-2">Option: <span className="text-muted-foreground">{variant?.label ?? "Unavailable"}</span></div>
            <div className="flex gap-2 flex-wrap">
              {product.variants.map((option) => (
                <button
                  type="button"
                  key={option.id}
                  onClick={() => { setVariantId(option.id); setQty(1); setMain(0); }}
                  disabled={option.availability === "out_of_stock"}
                  className={`flex items-center gap-2 rounded-full border-2 px-3 py-1.5 disabled:opacity-30 disabled:cursor-not-allowed ${variantId === option.id ? "border-primary ring-2 ring-primary/30" : "border-border"}`}
                  title={option.availability === "out_of_stock" ? `${option.label} (out of stock)` : option.label}
                  aria-label={option.label}
                  aria-pressed={variantId === option.id}
                >
                  <span className="h-4 w-4 shrink-0 rounded-full border border-border/40" style={{ background: option.color.hex }} />
                  <span className="text-xs font-semibold">{option.label}</span>
                </button>
              ))}
            </div>
            {variant?.availability === "low_stock" && (
              <p className="mt-2 text-xs font-semibold text-sale">Only a few left in this option.</p>
            )}
          </div>

          <div className="mt-6 flex items-center gap-4">
            <div className="inline-flex items-center bg-muted rounded-full">
              <button type="button" onClick={() => setQty((value) => Math.max(1, value - 1))} className="h-11 w-11 grid place-items-center hover:bg-blush rounded-full" aria-label="Decrease quantity"><Minus className="h-4 w-4" /></button>
              <span className="w-10 text-center font-bold">{qty}</span>
              <button type="button" onClick={() => setQty((value) => Math.min(variant?.maxQuantity ?? 99, value + 1))} className="h-11 w-11 grid place-items-center hover:bg-blush rounded-full" aria-label="Increase quantity"><Plus className="h-4 w-4" /></button>
            </div>
            <button type="button" onClick={handleAdd} disabled={outOfStock} className="btn-primary flex-1 disabled:cursor-not-allowed disabled:opacity-60">
              <ShoppingBag className="h-4 w-4" />
              {outOfStock ? "Out of stock" : added ? "Added! 💕" : "Add to bag"}
            </button>
            <button
              type="button"
              onClick={() => toggleWishlist(product)}
              className="h-12 w-12 grid place-items-center rounded-full border border-border bg-white hover:bg-blush transition"
              aria-label="Wishlist"
              aria-pressed={isWished(product.id)}
            >
              <Heart className={`h-5 w-5 ${isWished(product.id) ? "fill-cherry text-cherry" : ""}`} />
            </button>
          </div>
          {error && <p role="alert" className="mt-3 text-sm text-destructive">{error}</p>}

          <div className="mt-8 grid sm:grid-cols-2 gap-3">
            <div className="rounded-2xl bg-blush/60 p-4 flex gap-3">
              <Truck className="h-5 w-5 text-primary shrink-0" />
              <div>
                <div className="font-semibold text-sm">{product.shippingMessage}</div>
                <div className="text-xs text-muted-foreground">Ships in 1–2 days</div>
              </div>
            </div>
            <div className="rounded-2xl bg-blush/60 p-4 flex gap-3">
              <Undo2 className="h-5 w-5 text-primary shrink-0" />
              <div>
                <div className="font-semibold text-sm">{product.returnsMessage}</div>
                <div className="text-xs text-muted-foreground">Change of heart? No problem.</div>
              </div>
            </div>
          </div>

          <div className="mt-8 divide-y divide-border border-y border-border">
            <Details title="Product details">
              <ul className="space-y-1 text-sm text-muted-foreground">
                <li><strong className="text-foreground">Material:</strong> {product.material}</li>
                <li><strong className="text-foreground">Size:</strong> {product.size}</li>
                <li><strong className="text-foreground">Options:</strong> {product.variants.map((option) => option.label).join(", ")}</li>
                <li>Made for school, journaling, desk setup, and gifting.</li>
                <li>Cute Korean-inspired stationery style.</li>
              </ul>
            </Details>
            <Details title="Shipping & returns">
              <p className="text-sm text-muted-foreground">{product.shippingMessage} {product.returnsMessage}</p>
            </Details>
          </div>
        </div>
      </div>

      <div className="mt-16">
        <h3 className="font-display text-2xl sm:text-3xl font-black mb-6">You might also love</h3>
        <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-4 sm:gap-6">
          {product.related.map((item) => <ProductCard key={item.id} product={item} />)}
        </div>
      </div>
    </div>
  );
}

function Details({ title, children }: { title: string; children: ReactNode }) {
  const [open, setOpen] = useState(true);
  return (
    <div className="py-4">
      <button type="button" className="w-full flex items-center justify-between font-display font-bold" onClick={() => setOpen((value) => !value)}>
        {title}
        <span className="text-muted-foreground">{open ? "−" : "+"}</span>
      </button>
      {open && <div className="mt-3">{children}</div>}
    </div>
  );
}
