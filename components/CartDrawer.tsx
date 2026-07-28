"use client";

import Image from "next/image";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Minus, Plus, ShoppingBag, Trash2 } from "lucide-react";
import type { MouseEvent } from "react";

import { Sheet, SheetContent, SheetFooter, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { formatMoney, variantOptionLabel } from "@/lib/format";
import { shimmerPlaceholder } from "@/lib/image/shimmer";
import { useShop } from "@/lib/store";

export function CartDrawer() {
  const { cart, cartDrawerOpen, closeCartDrawer, lastAddedItemId, updateCartQuantity, removeFromCart } = useShop();
  const { items, summary } = cart;
  const lastAddedItem = items.find((item) => item.id === lastAddedItemId);
  const router = useRouter();

  // Closing the drawer on click re-renders/unmounts this anchor before the
  // browser processes its default navigation, silently cancelling it. Driving
  // navigation through the router instead of the anchor's default click
  // behavior avoids that race — <Link> is kept only for correct href/prefetch/
  // accessibility semantics.
  const navigate = (event: MouseEvent<HTMLAnchorElement>, href: string) => {
    event.preventDefault();
    router.push(href);
    closeCartDrawer();
  };

  return (
    <Sheet open={cartDrawerOpen} onOpenChange={(open) => !open && closeCartDrawer()}>
      <SheetContent side="right" className="flex w-full flex-col gap-0 p-0 sm:max-w-md">
        {/* Announces additions to screen readers even when the drawer is already open,
            since the dialog title alone only gets read out on first focus. */}
        <div role="status" aria-live="polite" className="sr-only">
          {lastAddedItem ? `${lastAddedItem.product.name} added to bag` : ""}
        </div>
        <SheetHeader className="border-b border-border px-6 py-5 text-left">
          <SheetTitle className="font-display text-xl font-black">
            {items.length > 0 ? "Added to bag ✓" : "Your bag"}
          </SheetTitle>
        </SheetHeader>

        {items.length === 0 ? (
          <div className="flex flex-1 flex-col items-center justify-center gap-3 px-6 text-center">
            <div className="text-5xl">🛍️</div>
            <p className="text-muted-foreground">Your bag is empty — add a little pink joy to get started.</p>
            <button type="button" onClick={closeCartDrawer} className="btn-ghost-pink mt-2">
              Continue Shopping
            </button>
          </div>
        ) : (
          <>
            <ul className="flex-1 overflow-y-auto px-6 py-4 space-y-4">
              {items.map((item) => {
                const productHref = `/product/${item.product.slug}`;
                return (
                  <li
                    key={item.id}
                    className={`grid grid-cols-[64px_1fr_auto] gap-3 items-center rounded-2xl p-2 transition ${
                      item.id === lastAddedItemId ? "ring-2 ring-primary/50 bg-blush/40" : ""
                    }`}
                  >
                    <Link href={productHref} onClick={(event) => navigate(event, productHref)} className="relative aspect-square rounded-xl overflow-hidden bg-blush">
                      <Image src={item.product.primaryImage.urls.thumb} alt={item.product.primaryImage.alt} fill sizes="64px" placeholder="blur" blurDataURL={shimmerPlaceholder(160, 160)} className="object-cover" />
                    </Link>
                    <div className="min-w-0">
                      <Link href={productHref} onClick={(event) => navigate(event, productHref)} className="font-display font-bold text-sm hover:text-primary line-clamp-2">
                        {item.product.name}
                      </Link>
                      <div className="text-xs text-muted-foreground mt-0.5">{variantOptionLabel(item.variant)}</div>
                      <div className="mt-2 flex items-center gap-2">
                        <div className="inline-flex items-center bg-muted rounded-full">
                          <button type="button" onClick={() => updateCartQuantity(item.id, item.quantity - 1)} disabled={item.quantity <= 1} className="h-7 w-7 grid place-items-center rounded-full hover:bg-blush disabled:opacity-40" aria-label="Decrease quantity">
                            <Minus className="h-3 w-3" />
                          </button>
                          <span className="w-6 text-center font-bold text-xs">{item.quantity}</span>
                          <button type="button" onClick={() => updateCartQuantity(item.id, item.quantity + 1)} className="h-7 w-7 grid place-items-center rounded-full hover:bg-blush" aria-label="Increase quantity">
                            <Plus className="h-3 w-3" />
                          </button>
                        </div>
                        <button type="button" onClick={() => removeFromCart(item.id)} className="text-muted-foreground hover:text-destructive" aria-label="Remove item">
                          <Trash2 className="h-3.5 w-3.5" />
                        </button>
                      </div>
                    </div>
                    <div className="font-display font-black text-sm text-right self-start">
                      {formatMoney(item.lineTotalCents, summary.currency)}
                    </div>
                  </li>
                );
              })}
            </ul>

            <SheetFooter className="border-t border-border px-6 py-5 flex-col gap-3 sm:flex-col">
              <div className="w-full">
                <div className="flex justify-between font-display text-lg font-black">
                  <span>Subtotal</span>
                  <span>{formatMoney(summary.subtotalCents, summary.currency)}</span>
                </div>
                <p className={`mt-1 text-xs ${summary.shippingCents === 0 ? "text-emerald-700 font-semibold" : "text-muted-foreground"}`}>
                  {summary.shippingCents === 0 ? "Free delivery" : `+ ${formatMoney(summary.shippingCents, summary.currency)} delivery`}
                </p>
              </div>
              <Link href="/checkout" onClick={(event) => navigate(event, "/checkout")} className="btn-primary w-full">
                <ShoppingBag className="h-4 w-4" /> Secure Checkout
              </Link>
              <Link href="/cart" onClick={(event) => navigate(event, "/cart")} className="btn-ghost-pink w-full block text-center">
                View bag
              </Link>
            </SheetFooter>
          </>
        )}
      </SheetContent>
    </Sheet>
  );
}
