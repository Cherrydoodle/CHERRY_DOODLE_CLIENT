import { BadgePercent, Truck } from "lucide-react";

import { formatMoney } from "@/lib/format";

// Deliberately decoupled from CartDTO/StartCheckout's own field names (subtotalCents
// vs subtotalMinor, etc.) so this one component can render both the cart summary and
// the Razorpay session summary without either caller reshaping its data further than
// this thin adapter.
export type PriceDetailsData = {
  currency: string;
  itemCount: number;
  listTotalCents: number;
  discountCents: number;
  shippingCents: number;
  taxCents: number;
  totalCents: number;
};

export function PriceDetails({ data, className = "" }: { data: PriceDetailsData; className?: string }) {
  const { currency, itemCount, listTotalCents, discountCents, shippingCents, taxCents, totalCents } = data;
  const savingsCents = listTotalCents - totalCents;

  return (
    <div className={className}>
      <h2 className="font-display text-lg font-bold text-muted-foreground/80 tracking-wide uppercase text-xs">Price Details</h2>
      <dl className="mt-3 space-y-3 text-sm">
        <div className="flex justify-between">
          <dt>Price ({itemCount} item{itemCount !== 1 ? "s" : ""})</dt>
          <dd>{formatMoney(listTotalCents, currency)}</dd>
        </div>
        {discountCents > 0 && (
          <div className="flex justify-between text-sale font-semibold">
            <dt>Discount</dt>
            <dd>&minus;{formatMoney(discountCents, currency)}</dd>
          </div>
        )}
        <div className="flex justify-between">
          <dt className="text-muted-foreground">Delivery charges</dt>
          <dd className={shippingCents === 0 ? "font-semibold text-emerald-700" : undefined}>
            {shippingCents === 0 ? "Free" : formatMoney(shippingCents, currency)}
          </dd>
        </div>
        {taxCents > 0 && (
          <div className="flex justify-between text-muted-foreground">
            <dt>Tax</dt>
            <dd>{formatMoney(taxCents, currency)}</dd>
          </div>
        )}
        <div className="flex justify-between border-t border-dashed border-border pt-3 mt-3 font-display text-lg font-black">
          <dt>Total Amount</dt>
          <dd>{formatMoney(totalCents, currency)}</dd>
        </div>
      </dl>
      {savingsCents > 0 && (
        <div className="mt-4 flex items-center gap-2 rounded-2xl bg-emerald-50 p-3 text-xs font-bold text-emerald-800">
          <BadgePercent className="h-4 w-4 shrink-0 text-emerald-600" />
          You&apos;ll save {formatMoney(savingsCents, currency)} on this order!
        </div>
      )}
    </div>
  );
}

/** The "Add ₹X more for free delivery" band shown above the cart/checkout item list. */
export function FreeShippingNudge({
  currency, thresholdCents, remainingCents, className = "",
}: { currency: string; thresholdCents: number; remainingCents: number; className?: string }) {
  if (thresholdCents <= 0) return null;
  const qualified = remainingCents <= 0;
  const progress = qualified ? 100 : Math.min(100, Math.round(((thresholdCents - remainingCents) / thresholdCents) * 100));

  return (
    <div className={`rounded-2xl bg-blush/40 p-4 ${className}`}>
      <p className="flex items-center gap-2 text-sm font-bold">
        <Truck className="h-4 w-4 shrink-0 text-primary" />
        {qualified ? (
          <span className="text-emerald-700">Yay! You get free delivery on this order</span>
        ) : (
          <span>
            Add <span className="text-primary">{formatMoney(remainingCents, currency)}</span> more for free delivery
          </span>
        )}
      </p>
      <div className="mt-2.5 h-1.5 w-full overflow-hidden rounded-full bg-white/70">
        <div
          className={`h-full rounded-full transition-all ${qualified ? "bg-emerald-500" : "bg-primary"}`}
          style={{ width: `${progress}%` }}
        />
      </div>
    </div>
  );
}
