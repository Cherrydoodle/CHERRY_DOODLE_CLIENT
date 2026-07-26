"use client";

import Image from "next/image";
import Link from "next/link";
import { Minus, Plus, ShoppingBag, Trash2 } from "lucide-react";

import type { CartDTO } from "@/features/cart/types";
import { formatMoney, variantOptionLabel } from "@/lib/format";
import { shimmerPlaceholder } from "@/lib/image/shimmer";
import { useShop } from "@/lib/store";

const warningCopy: Record<NonNullable<CartDTO["items"][number]["warning"]>, string> = {
  price_changed: "The price of this item has changed since you added it.",
  out_of_stock: "This item is no longer available and will be removed at checkout.",
  quantity_reduced: "We only have limited stock left — your quantity may be reduced at checkout.",
};

export function CartView() {
  const { cart, cartLoading, updateCartQuantity, removeFromCart } = useShop();
  const { items, summary } = cart;

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

  return (
    <div className="mx-auto max-w-6xl px-4 sm:px-6 py-10">
      <h1 className="font-display text-3xl sm:text-4xl font-black mb-2">Your bag</h1>
      <p className="text-muted-foreground mb-8">{items.length} item{items.length !== 1 ? "s" : ""} — freshly picked</p>

      <div className="grid gap-8 lg:grid-cols-[1fr_360px]">
        <ul className="space-y-4">
          {items.map((item) => (
            <li key={item.id} className="card-soft p-4 grid grid-cols-[96px_1fr_auto] sm:grid-cols-[120px_1fr_auto] gap-4 items-center">
              <Link href={`/product/${item.product.slug}`} className="relative aspect-square rounded-2xl overflow-hidden bg-blush">
                <Image src={item.product.primaryImage.urls.thumb} alt={item.product.primaryImage.alt} fill sizes="120px" placeholder="blur" blurDataURL={shimmerPlaceholder(160, 160)} className="object-cover" />
              </Link>
              <div className="min-w-0">
                <Link href={`/product/${item.product.slug}`} className="font-display font-bold hover:text-primary line-clamp-2">{item.product.name}</Link>
                <div className="text-xs text-muted-foreground mt-1">
                  {variantOptionLabel(item.variant)} • {item.product.label}
                </div>
                {item.warning && <p className="mt-1 text-xs font-semibold text-sale">{warningCopy[item.warning]}</p>}
                <div className="mt-3 flex items-center gap-3">
                  <div className="inline-flex items-center bg-muted rounded-full">
                    <button type="button" onClick={() => updateCartQuantity(item.id, item.quantity - 1)} disabled={item.quantity <= 1} className="h-9 w-9 grid place-items-center rounded-full hover:bg-blush disabled:opacity-40" aria-label="Decrease quantity"><Minus className="h-3.5 w-3.5" /></button>
                    <span className="w-8 text-center font-bold text-sm">{item.quantity}</span>
                    <button type="button" onClick={() => updateCartQuantity(item.id, item.quantity + 1)} className="h-9 w-9 grid place-items-center rounded-full hover:bg-blush" aria-label="Increase quantity"><Plus className="h-3.5 w-3.5" /></button>
                  </div>
                  <button type="button" onClick={() => removeFromCart(item.id)} className="text-xs text-muted-foreground hover:text-destructive inline-flex items-center gap-1">
                    <Trash2 className="h-3.5 w-3.5" /> Remove
                  </button>
                </div>
              </div>
              <div className="text-right">
                <div className="font-display font-black">{formatMoney(item.lineTotalCents, summary.currency)}</div>
                {item.lineTotalCents < item.originalLineTotalCents && (
                  <div className="text-xs line-through text-muted-foreground">{formatMoney(item.originalLineTotalCents, summary.currency)}</div>
                )}
              </div>
            </li>
          ))}
        </ul>

        <aside className="card-soft p-6 h-fit lg:sticky lg:top-32">
          <h2 className="font-display text-xl font-bold mb-4">Order summary</h2>
          <dl className="space-y-2 text-sm">
            <div className="flex justify-between"><dt>Subtotal</dt><dd>{formatMoney(summary.subtotalBeforeDiscountCents, summary.currency)}</dd></div>
            {summary.discountCents > 0 && (
              <div className="flex justify-between text-sale font-semibold"><dt>Discount</dt><dd>-{formatMoney(summary.discountCents, summary.currency)}</dd></div>
            )}
            <div className="flex justify-between text-muted-foreground"><dt>Shipping</dt><dd>Calculated at checkout</dd></div>
            <div className="flex justify-between border-t border-border pt-3 mt-3 font-display text-lg font-black">
              <dt>Total</dt><dd>{formatMoney(summary.subtotalCents, summary.currency)}</dd>
            </div>
          </dl>

          <div className="mt-5 rounded-2xl bg-blush p-3 text-xs text-center text-foreground/80">
            Prices and availability are verified securely before payment.
          </div>

          <Link href="/checkout" className="btn-primary w-full mt-4">
            <ShoppingBag className="h-4 w-4" /> Secure Checkout
          </Link>
          <Link href="/" className="btn-ghost-pink w-full mt-2 block text-center">Continue Shopping</Link>
        </aside>
      </div>
    </div>
  );
}
