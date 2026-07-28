"use client";

import Image from "next/image";
import Link from "next/link";
import { useState } from "react";
import { Minus, Plus, ShoppingBag, Trash2 } from "lucide-react";

import { PriceDetails, FreeShippingNudge, type PriceDetailsData } from "@/app/checkout/price-details";
import type { CartDTO } from "@/features/cart/types";
import { formatMoney, variantOptionLabel } from "@/lib/format";
import { shimmerPlaceholder } from "@/lib/image/shimmer";
import { useShop } from "@/lib/store";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";

const warningCopy: Record<NonNullable<CartDTO["items"][number]["warning"]>, string> = {
  price_changed: "The price of this item has changed since you added it.",
  out_of_stock: "This item is no longer available and will be removed at checkout.",
  quantity_reduced: "We only have limited stock left — your quantity may be reduced at checkout.",
};

export function CartView() {
  const { cart, cartLoading, updateCartQuantity, removeFromCart } = useShop();
  const { items, summary } = cart;
  const [priceSheetOpen, setPriceSheetOpen] = useState(false);

  if (!cartLoading && items.length === 0) {
    return (
      <div className="mx-auto max-w-3xl px-6 py-20 text-center">
        <div className="text-6xl">🛍️</div>
        <h1 className="font-display text-3xl sm:text-4xl font-black mt-4">Your bag is empty</h1>
        <p className="text-muted-foreground mt-2">Add a little pink joy to get started.</p>
        <Link href="/" className="btn-primary mt-6 inline-flex">Continue Shopping</Link>
      </div>
    );
  }

  const priceData: PriceDetailsData = {
    currency: summary.currency,
    itemCount: summary.itemCount,
    listTotalCents: summary.subtotalBeforeDiscountCents,
    discountCents: summary.discountCents,
    shippingCents: summary.shippingCents,
    taxCents: 0,
    totalCents: summary.totalCents,
  };

  return (
    <div className="mx-auto max-w-6xl px-4 sm:px-6 py-10 pb-28 md:pb-10">
      <h1 className="font-display text-3xl sm:text-4xl font-black mb-2">Your bag</h1>
      <p className="text-muted-foreground mb-6">{items.length} item{items.length !== 1 ? "s" : ""} — freshly picked</p>

      {summary.freeShippingRemainingCents > 0 && (
        <FreeShippingNudge
          currency={summary.currency}
          thresholdCents={summary.freeShippingThresholdCents}
          remainingCents={summary.freeShippingRemainingCents}
          className="mb-6"
        />
      )}

      <div className="grid gap-8 lg:grid-cols-[1fr_360px]">
        <ul className="space-y-4">
          {items.map((item) => {
            const unitListCents = item.product.pricing.listCents;
            const discountPercent = unitListCents > item.unitPriceCents ? Math.round(((unitListCents - item.unitPriceCents) / unitListCents) * 100) : 0;
            return (
              <li key={item.id} className="card-soft p-4">
                <div className="grid grid-cols-[96px_1fr] sm:grid-cols-[120px_1fr] gap-4">
                  <Link href={`/product/${item.product.slug}`} className="relative aspect-square rounded-2xl overflow-hidden bg-blush">
                    <Image src={item.product.primaryImage.urls.thumb} alt={item.product.primaryImage.alt} fill sizes="120px" placeholder="blur" blurDataURL={shimmerPlaceholder(160, 160)} className="object-cover" />
                  </Link>
                  <div className="min-w-0">
                    <Link href={`/product/${item.product.slug}`} className="font-display font-bold hover:text-primary line-clamp-2">{item.product.name}</Link>
                    <div className="text-xs text-muted-foreground mt-1">
                      {variantOptionLabel(item.variant)} • {item.product.label}
                    </div>
                    {item.warning && <p className="mt-1 text-xs font-semibold text-sale">{warningCopy[item.warning]}</p>}
                    <div className="mt-2 flex flex-wrap items-baseline gap-2">
                      {discountPercent > 0 && <span className="text-sm font-bold text-emerald-700">&darr;{discountPercent}%</span>}
                      {item.lineTotalCents < item.originalLineTotalCents && (
                        <span className="text-sm text-muted-foreground line-through">{formatMoney(item.originalLineTotalCents, summary.currency)}</span>
                      )}
                      <span className="font-display font-black">{formatMoney(item.lineTotalCents, summary.currency)}</span>
                    </div>
                  </div>
                </div>
                <div className="mt-3 flex items-center justify-between border-t border-border/60 pt-3">
                  <div className="inline-flex items-center bg-muted rounded-full">
                    <button type="button" onClick={() => updateCartQuantity(item.id, item.quantity - 1)} disabled={item.quantity <= 1} className="h-9 w-9 grid place-items-center rounded-full hover:bg-blush disabled:opacity-40" aria-label="Decrease quantity"><Minus className="h-3.5 w-3.5" /></button>
                    <span className="w-8 text-center font-bold text-sm">{item.quantity}</span>
                    <button type="button" onClick={() => updateCartQuantity(item.id, item.quantity + 1)} className="h-9 w-9 grid place-items-center rounded-full hover:bg-blush" aria-label="Increase quantity"><Plus className="h-3.5 w-3.5" /></button>
                  </div>
                  <button type="button" onClick={() => removeFromCart(item.id)} className="text-xs text-muted-foreground hover:text-destructive inline-flex items-center gap-1">
                    <Trash2 className="h-3.5 w-3.5" /> Remove
                  </button>
                </div>
              </li>
            );
          })}
        </ul>

        <aside className="hidden h-fit lg:sticky lg:top-32 lg:block">
          <div className="card-soft p-6">
            <PriceDetails data={priceData} />

            <Link href="/checkout" className="btn-primary w-full mt-5">
              <ShoppingBag className="h-4 w-4" /> Secure Checkout
            </Link>
            <Link href="/" className="btn-ghost-pink w-full mt-2 block text-center">Continue Shopping</Link>
          </div>
        </aside>
      </div>

      {/* Mobile sticky action bar */}
      <div className="fixed inset-x-0 bottom-0 z-50 border-t border-border bg-background/95 px-4 py-3 backdrop-blur-md lg:hidden pb-[env(safe-area-inset-bottom)]">
        <div className="flex items-center justify-between gap-4">
          <div>
            {summary.subtotalBeforeDiscountCents > priceData.totalCents && (
              <p className="text-xs text-muted-foreground line-through">{formatMoney(summary.subtotalBeforeDiscountCents, summary.currency)}</p>
            )}
            <p className="font-display text-lg font-black">{formatMoney(priceData.totalCents, summary.currency)}</p>
            <button type="button" onClick={() => setPriceSheetOpen(true)} className="text-xs font-bold text-primary underline underline-offset-2">
              View price details
            </button>
          </div>
          <Link href="/checkout" className="btn-primary shrink-0">
            <ShoppingBag className="h-4 w-4" /> Secure Checkout
          </Link>
        </div>
      </div>

      <Sheet open={priceSheetOpen} onOpenChange={setPriceSheetOpen}>
        <SheetContent side="bottom" className="max-h-[80vh] overflow-y-auto rounded-t-3xl">
          <SheetHeader className="text-left">
            <SheetTitle className="font-display">Price Details</SheetTitle>
          </SheetHeader>
          <PriceDetails data={priceData} className="px-1 pb-4" />
        </SheetContent>
      </Sheet>
    </div>
  );
}
