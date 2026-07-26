"use client";

import Script from "next/script";
import Image from "next/image";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { AlertTriangle, Clock, CreditCard, LockKeyhole, ShoppingBag } from "lucide-react";
import { useEffect, useRef, useState, type FormEvent } from "react";

import type { AddressDTO } from "@/features/addresses/service";
import { track } from "@/lib/analytics/posthog";
import { formatMoney, variantOptionLabel } from "@/lib/format";
import { shimmerPlaceholder } from "@/lib/image/shimmer";
import { useShop } from "@/lib/store";

type RazorpaySuccess = {
  razorpay_order_id: string;
  razorpay_payment_id: string;
  razorpay_signature: string;
};

type RazorpayFailure = { error?: { description?: string; reason?: string } };

type RazorpayOptions = {
  key: string;
  amount: number;
  currency: string;
  name: string;
  description: string;
  order_id: string;
  prefill: { name: string; email: string; contact: string };
  theme: { color: string };
  handler: (response: RazorpaySuccess) => void | Promise<void>;
  modal: { ondismiss: () => void };
};

type RazorpayInstance = {
  open: () => void;
  on: (event: "payment.failed", handler: (response: RazorpayFailure) => void) => void;
};

declare global {
  interface Window {
    Razorpay?: new (options: RazorpayOptions) => RazorpayInstance;
  }
}

type StartCheckout = {
  checkoutId: string;
  checkoutToken: string;
  expiresAt: string;
  summary: {
    currency: string;
    subtotalMinor: number;
    discountMinor: number;
    shippingMinor: number;
    taxMinor: number;
    totalMinor: number;
  };
  razorpay: {
    keyId: string;
    mode: "test" | "live";
    orderId: string;
    amount: number;
    currency: string;
    name: string;
    description: string;
    prefill: { name: string; email: string; contact: string };
  };
};

type CompletedOrder = {
  id: string;
  orderNumber: string;
  status: string;
  paymentStatus: string;
  totalMinor: number;
  currency: string;
};

class CheckoutError extends Error {
  constructor(public code: string, message: string) {
    super(message);
  }
}

// Errors that mean the bag's contents changed underneath the shopper (stock/price/availability).
// The safest recovery is to drop the stale checkout session and refresh the cart so they see current state.
const STALE_CART_CODES = new Set([
  "INSUFFICIENT_STOCK", "VARIANT_UNAVAILABLE", "PRODUCT_UNAVAILABLE", "MIXED_CURRENCY_CART", "EMPTY_CART",
]);
// PAYMENT_AUTO_REFUNDED belongs here too: the money has already gone back to the
// shopper, so the only sensible next step is a brand-new checkout session.
const STALE_SESSION_CODES = new Set(["CHECKOUT_EXPIRED", "CHECKOUT_NOT_FOUND", "PAYMENT_ORDER_MISMATCH", "PAYMENT_AUTO_REFUNDED"]);

const FRIENDLY_MESSAGES: Record<string, string> = {
  INSUFFICIENT_STOCK: "Some items in your bag just sold out or dropped in stock. We've refreshed your bag — please review it and try again.",
  VARIANT_UNAVAILABLE: "One of your selected colors is no longer available. We've refreshed your bag — please review it and try again.",
  PRODUCT_UNAVAILABLE: "One or more items in your bag are no longer available. We've refreshed your bag — please review it and try again.",
  MIXED_CURRENCY_CART: "Your bag contains items priced in different currencies. Please remove one and try again.",
  EMPTY_CART: "Your bag is empty.",
  CHECKOUT_EXPIRED: "Your checkout session expired. Please try again.",
  CHECKOUT_NOT_FOUND: "We couldn't find that checkout session. Please try again.",
  PAYMENT_ORDER_MISMATCH: "That payment session is no longer valid. Please try again.",
  PAYMENT_SIGNATURE_INVALID: "We couldn't verify that payment. If you were charged, please contact support with your order details.",
  PAYMENT_AMOUNT_MISMATCH: "Something looks off with that payment. If you were charged, please contact support.",
  PAYMENT_AUTO_REFUNDED: "That checkout had already expired, so your payment was refunded in full — it should reach your account in 5-7 working days. Please start a new order.",
  PAYMENT_NOT_CAPTURED: "Your payment is still being confirmed by your bank. Give it a moment and check your orders — we'll email you as soon as it's through.",
  PAYMENT_REQUIRES_REVIEW: "Your payment went through and we're finalising your order. We've emailed you the details.",
  ORDER_TOTAL_TOO_LOW: "Your order total is too low for payment. Please add another item to your bag.",
  RATE_LIMITED: "Too many attempts. Please wait a moment and try again.",
  SERVICE_UNAVAILABLE: "Checkout is temporarily unavailable. Please try again in a moment.",
  PAYMENT_PROVIDER_UNAVAILABLE: "Our payment provider could not be reached. Please try again.",
};

function describeCheckoutError(cause: unknown): string {
  if (cause instanceof CheckoutError) return FRIENDLY_MESSAGES[cause.code] ?? cause.message;
  return cause instanceof Error ? cause.message : "Something went wrong. Please try again.";
}

async function postApi<T>(path: string, body: unknown, idempotencyKey: string): Promise<T> {
  const response = await fetch(path, {
    method: "POST",
    headers: { "content-type": "application/json", "idempotency-key": idempotencyKey },
    body: JSON.stringify(body),
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) throw new CheckoutError(payload.code || "CHECKOUT_FAILED", payload.detail || "Checkout could not be completed.");
  return payload.data as T;
}

function formatCountdown(msRemaining: number) {
  const totalSeconds = Math.max(0, Math.floor(msRemaining / 1000));
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${minutes}:${seconds.toString().padStart(2, "0")}`;
}

export function CheckoutView({ isAuthenticated, savedAddresses, nonce }: { isAuthenticated: boolean; savedAddresses: AddressDTO[]; nonce: string | null }) {
  const router = useRouter();
  const { cart, cartLoading, clearCart, refreshCart } = useShop();
  const startKey = useRef<string | null>(null);
  const [session, setSession] = useState<StartCheckout | null>(null);
  const [now, setNow] = useState(() => Date.now());
  const [scriptReady, setScriptReady] = useState(false);
  const [processing, setProcessing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const defaultAddressId = savedAddresses.find((address) => address.isDefault)?.id ?? savedAddresses[0]?.id ?? "new";
  const [selectedAddressId, setSelectedAddressId] = useState<string>(defaultAddressId);
  const [billingSameAsShipping, setBillingSameAsShipping] = useState(true);
  const items = cart.items;
  const selectedAddress = savedAddresses.find((address) => address.id === selectedAddressId) ?? null;

  useEffect(() => {
    if (!session) return;
    const interval = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(interval);
  }, [session]);

  const msRemaining = session ? new Date(session.expiresAt).getTime() - now : null;
  const expired = msRemaining !== null && msRemaining <= 0;

  const resetSession = () => {
    setSession(null);
    startKey.current = null;
  };

  // Set the moment a payment is known to have succeeded, so nothing downstream
  // (modal dismissal, page unload) can release the stock that has just been bought.
  const settled = useRef(false);

  const CANCEL_ENDPOINT = "/api/v1/checkout/razorpay/cancel";

  // Fire-and-forget: hands the reservation back so the shopper can retry straight
  // away. Idempotent server-side, and never surfaces an error — abandoning a payment
  // is not a failure the shopper needs to be told about.
  const releaseCheckout = (checkout: StartCheckout) => {
    if (settled.current) return;
    fetch(CANCEL_ENDPOINT, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ checkoutId: checkout.checkoutId, checkoutToken: checkout.checkoutToken }),
      keepalive: true,
    }).catch(() => undefined);
  };

  // Covers the shopper who simply closes the tab mid-payment. sendBeacon survives
  // unload where a normal fetch would be cancelled.
  useEffect(() => {
    if (!session) return;
    const handlePageHide = () => {
      if (settled.current) return;
      const payload = JSON.stringify({ checkoutId: session.checkoutId, checkoutToken: session.checkoutToken });
      navigator.sendBeacon?.(CANCEL_ENDPOINT, new Blob([payload], { type: "application/json" }));
    };
    window.addEventListener("pagehide", handlePageHide);
    return () => window.removeEventListener("pagehide", handlePageHide);
  }, [session]);

  const verifyPayment = async (checkout: StartCheckout, payment: RazorpaySuccess) => {
    const verificationKey = `verify:${payment.razorpay_payment_id}`;
    for (let attempt = 0; attempt < 3; attempt += 1) {
      try {
        return await postApi<CompletedOrder>("/api/v1/checkout/razorpay/verify", {
          checkoutId: checkout.checkoutId,
          checkoutToken: checkout.checkoutToken,
          razorpayOrderId: payment.razorpay_order_id,
          razorpayPaymentId: payment.razorpay_payment_id,
          razorpaySignature: payment.razorpay_signature,
        }, verificationKey);
      } catch (cause) {
        if (!(cause instanceof CheckoutError) || cause.code !== "PAYMENT_NOT_CAPTURED" || attempt === 2) throw cause;
        await new Promise((resolve) => window.setTimeout(resolve, 900 * (attempt + 1)));
      }
    }
    throw new CheckoutError("PAYMENT_NOT_CAPTURED", "Payment confirmation is still pending.");
  };

  // The confirmation page always re-fetches from the DB using this capability
  // token pair (the same one /verify uses); it never trusts order details passed
  // through the URL, so a pending/failed/requires_review state is shown correctly
  // even if the client's local view of the payment result is stale or wrong.
  const goToSuccess = (checkout: StartCheckout) => {
    const params = new URLSearchParams({ checkoutId: checkout.checkoutId, checkoutToken: checkout.checkoutToken });
    router.push(`/checkout/success?${params.toString()}`);
  };

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!window.Razorpay || !scriptReady) {
      setError("Secure payment checkout is still loading. Please try again in a moment.");
      return;
    }
    setProcessing(true);
    setError(null);
    const form = new FormData(event.currentTarget);
    startKey.current ||= crypto.randomUUID();

    const termsAccepted = form.get("termsAccepted") === "on";
    if (!termsAccepted) {
      setError("Please accept the Terms & Conditions and Privacy Policy to continue.");
      setProcessing(false);
      return;
    }

    const shippingAddress = {
      line1: String(form.get("line1") || ""),
      line2: String(form.get("line2") || "") || undefined,
      city: String(form.get("city") || ""),
      state: String(form.get("state") || ""),
      postalCode: String(form.get("postalCode") || ""),
      country: String(form.get("country") || "IN"),
    };
    const billingAddress = billingSameAsShipping
      ? undefined
      : {
          line1: String(form.get("billingLine1") || ""),
          line2: String(form.get("billingLine2") || "") || undefined,
          city: String(form.get("billingCity") || ""),
          state: String(form.get("billingState") || ""),
          postalCode: String(form.get("billingPostalCode") || ""),
          country: String(form.get("billingCountry") || "IN"),
        };
    const saveNewAddress = isAuthenticated && selectedAddressId === "new" && form.get("saveAddress") === "on";

    try {
      const checkout = await postApi<StartCheckout>("/api/v1/checkout/razorpay/order", {
        customer: {
          name: String(form.get("name") || ""),
          email: String(form.get("email") || ""),
          phone: String(form.get("phone") || ""),
        },
        shippingAddress,
        billingAddress,
        termsAccepted: true,
        customerNote: String(form.get("note") || "") || undefined,
        items: items.map((item) => ({ productSlug: item.product.slug, variantId: item.variant.id, color: item.variant.color.name, quantity: item.quantity })),
      }, startKey.current);

      if (saveNewAddress) {
        // Best-effort, never blocks checkout: the shopper's payment must not fail
        // because saving a convenience address for next time failed.
        fetch("/api/v1/me/addresses", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            recipientName: String(form.get("name") || ""),
            phoneNumber: String(form.get("phone") || ""),
            line1: shippingAddress.line1,
            line2: shippingAddress.line2,
            city: shippingAddress.city,
            state: shippingAddress.state,
            postalCode: shippingAddress.postalCode,
            countryCode: shippingAddress.country,
            isDefault: savedAddresses.length === 0,
          }),
        }).catch(() => undefined);
      }
      setSession(checkout);
      setNow(Date.now());
      track("begin_checkout", {
        currency: checkout.summary.currency,
        value: checkout.summary.totalMinor / 100,
        items: items.map((item) => ({ item_id: item.product.id, item_name: item.product.name, price: item.unitPriceCents / 100, quantity: item.quantity })),
      });

      const razorpay = new window.Razorpay({
        key: checkout.razorpay.keyId,
        amount: checkout.razorpay.amount,
        currency: checkout.razorpay.currency,
        name: checkout.razorpay.name,
        description: checkout.razorpay.description,
        order_id: checkout.razorpay.orderId,
        prefill: checkout.razorpay.prefill,
        theme: { color: "#e85b81" },
        handler: async (payment) => {
          try {
            await verifyPayment(checkout, payment);
          } catch (cause) {
            // PAYMENT_REQUIRES_REVIEW means the money was taken and the order is
            // being finalised by hand — that is a success from the shopper's side,
            // so it goes to the confirmation page (which reads the real DB state).
            if (!(cause instanceof CheckoutError) || cause.code !== "PAYMENT_REQUIRES_REVIEW") {
              setError(describeCheckoutError(cause));
              if (cause instanceof CheckoutError && STALE_SESSION_CODES.has(cause.code)) resetSession();
              setProcessing(false);
              return;
            }
          }
          // Past this point the payment has succeeded. Emptying the bag is a
          // convenience, so it must never be able to turn a completed payment into
          // an on-screen error — the exact thing that makes shoppers pay twice.
          settled.current = true;
          await clearCart().catch(() => undefined);
          goToSuccess(checkout);
        },
        modal: {
          ondismiss: () => {
            if (settled.current) return;
            setProcessing(false);
            // Hand the reserved stock back immediately instead of holding it for the
            // full 20-minute window, which would otherwise make an instant retry hit
            // INSUFFICIENT_STOCK against the shopper's own reservation.
            releaseCheckout(checkout);
            resetSession();
          },
        },
      });
      razorpay.on("payment.failed", (failure) => {
        setError(failure.error?.description || failure.error?.reason || "Payment failed. You can try again.");
        setProcessing(false);
      });
      razorpay.open();
    } catch (cause) {
      setError(describeCheckoutError(cause));
      if (cause instanceof CheckoutError && (STALE_CART_CODES.has(cause.code) || STALE_SESSION_CODES.has(cause.code))) {
        resetSession();
        if (STALE_CART_CODES.has(cause.code)) await refreshCart();
      }
      setProcessing(false);
    }
  };

  if (!cartLoading && !items.length) {
    return (
      <section className="mx-auto max-w-2xl px-6 py-24 text-center">
        <ShoppingBag className="mx-auto h-12 w-12 text-primary" />
        <h1 className="mt-4 font-display text-4xl font-black">Your bag is empty</h1>
        <p className="mt-2 text-muted-foreground">Add something lovely before checking out.</p>
        <Link href="/" className="btn-primary mt-6 inline-flex">Continue shopping</Link>
      </section>
    );
  }

  const summary = session?.summary;
  const currency = summary?.currency ?? cart.summary.currency;

  return (
    <>
      <Script
        src="https://checkout.razorpay.com/v1/checkout.js"
        strategy="afterInteractive"
        nonce={nonce ?? undefined}
        onLoad={() => setScriptReady(true)}
        onError={() => setError("Secure payment checkout could not be loaded.")}
      />
      <div className="mx-auto max-w-6xl px-4 py-10 sm:px-6">
        <div className="mb-8">
          <p className="text-sm font-bold text-primary">Secure checkout</p>
          <h1 className="font-display text-3xl font-black sm:text-4xl">Delivery and payment</h1>
          <p className="mt-2 text-sm text-muted-foreground">Your final price and stock are verified securely before Razorpay opens.</p>
        </div>

        <form onSubmit={submit} onChange={() => { if (!session) startKey.current = null; }} className="grid gap-8 lg:grid-cols-[1fr_380px]">
          <div className="space-y-6">
            <section className="card-soft p-5 sm:p-7">
              <h2 className="font-display text-xl font-bold">Contact details</h2>
              <div className="mt-5 grid gap-4 sm:grid-cols-2">
                <Field label="Full name" name="name" autoComplete="name" minLength={2} maxLength={120} />
                <Field label="Email" name="email" type="email" autoComplete="email" maxLength={320} />
                <Field label="Phone" name="phone" type="tel" autoComplete="tel" minLength={7} maxLength={20} className="sm:col-span-2" placeholder="+91 98765 43210" />
              </div>
            </section>

            <section className="card-soft p-5 sm:p-7">
              <h2 className="font-display text-xl font-bold">Shipping address</h2>

              {savedAddresses.length > 0 && (
                <div className="mt-4 space-y-2">
                  {savedAddresses.map((address) => (
                    <label
                      key={address.id}
                      className={`flex items-start gap-2.5 rounded-2xl border p-3 text-sm ${selectedAddressId === address.id ? "border-primary bg-blush/40" : "border-border"}`}
                    >
                      <input
                        type="radio"
                        name="savedAddressChoice"
                        checked={selectedAddressId === address.id}
                        onChange={() => setSelectedAddressId(address.id)}
                        className="mt-1 accent-primary"
                      />
                      <span>
                        <strong>{address.label}</strong> — {address.recipientName}
                        <br />
                        <span className="text-muted-foreground">
                          {[address.line1, address.line2, address.city, address.state, address.postalCode].filter(Boolean).join(", ")}
                        </span>
                      </span>
                    </label>
                  ))}
                  <label className={`flex items-center gap-2.5 rounded-2xl border p-3 text-sm ${selectedAddressId === "new" ? "border-primary bg-blush/40" : "border-border"}`}>
                    <input type="radio" name="savedAddressChoice" checked={selectedAddressId === "new"} onChange={() => setSelectedAddressId("new")} className="accent-primary" />
                    Use a new address
                  </label>
                </div>
              )}

              <div key={selectedAddressId} className="mt-5 grid gap-4 sm:grid-cols-2">
                <Field label="Address line 1" name="line1" autoComplete="address-line1" minLength={3} maxLength={200} className="sm:col-span-2" defaultValue={selectedAddress?.line1} />
                <Field label="Address line 2 (optional)" name="line2" autoComplete="address-line2" maxLength={200} required={false} className="sm:col-span-2" defaultValue={selectedAddress?.line2 ?? undefined} />
                <Field label="City" name="city" autoComplete="address-level2" minLength={2} maxLength={100} defaultValue={selectedAddress?.city} />
                <Field label="State" name="state" autoComplete="address-level1" minLength={2} maxLength={100} defaultValue={selectedAddress?.state} />
                <Field label="Postal code" name="postalCode" autoComplete="postal-code" minLength={3} maxLength={20} defaultValue={selectedAddress?.postalCode} />
                <Field label="Country code" name="country" autoComplete="country" minLength={2} maxLength={2} defaultValue={selectedAddress?.countryCode ?? "IN"} />
                {isAuthenticated && selectedAddressId === "new" && (
                  <label className="sm:col-span-2 flex items-center gap-2 text-sm">
                    <input type="checkbox" name="saveAddress" defaultChecked className="h-4 w-4 accent-primary" />
                    Save this address for next time
                  </label>
                )}
                <label className="sm:col-span-2 text-sm font-bold">
                  Order note (optional)
                  <textarea name="note" maxLength={2000} rows={3} className="mt-1.5 w-full resize-none rounded-2xl border bg-white px-4 py-3 font-normal outline-none focus:border-primary" />
                </label>
              </div>
            </section>

            <section className="card-soft p-5 sm:p-7">
              <h2 className="font-display text-xl font-bold">Billing address</h2>
              <label className="mt-3 flex items-center gap-2 text-sm">
                <input
                  type="checkbox"
                  checked={billingSameAsShipping}
                  onChange={(event) => setBillingSameAsShipping(event.target.checked)}
                  className="h-4 w-4 accent-primary"
                />
                Same as shipping address
              </label>
              {!billingSameAsShipping && (
                <div className="mt-4 grid gap-4 sm:grid-cols-2">
                  <Field label="Address line 1" name="billingLine1" autoComplete="billing address-line1" minLength={3} maxLength={200} className="sm:col-span-2" />
                  <Field label="Address line 2 (optional)" name="billingLine2" autoComplete="billing address-line2" maxLength={200} required={false} className="sm:col-span-2" />
                  <Field label="City" name="billingCity" autoComplete="billing address-level2" minLength={2} maxLength={100} />
                  <Field label="State" name="billingState" autoComplete="billing address-level1" minLength={2} maxLength={100} />
                  <Field label="Postal code" name="billingPostalCode" autoComplete="billing postal-code" minLength={3} maxLength={20} />
                  <Field label="Country code" name="billingCountry" autoComplete="billing country" minLength={2} maxLength={2} defaultValue="IN" />
                </div>
              )}
            </section>
          </div>

          <aside className="card-soft h-fit p-6 lg:sticky lg:top-28">
            <h2 className="font-display text-xl font-bold">Order summary</h2>
            <ul className="mt-4 max-h-72 space-y-3 overflow-auto pr-1">
              {items.map((item) => (
                <li key={item.id} className="flex gap-3">
                  <div className="relative h-16 w-16 shrink-0 overflow-hidden rounded-xl bg-blush">
                    <Image src={item.product.primaryImage.urls.thumb} alt="" fill sizes="64px" placeholder="blur" blurDataURL={shimmerPlaceholder(160, 160)} className="object-cover" />
                  </div>
                  <div className="min-w-0 flex-1 text-sm">
                    <p className="line-clamp-1 font-bold">{item.product.name}</p>
                    <p className="text-xs text-muted-foreground">{variantOptionLabel(item.variant)} · Qty {item.quantity}</p>
                  </div>
                  <p className="text-sm font-bold">{formatMoney(item.lineTotalCents, currency)}</p>
                </li>
              ))}
            </ul>
            <div className="mt-5 space-y-2 border-t pt-4 text-sm">
              <div className="flex justify-between"><span>Subtotal</span><span>{formatMoney(summary?.subtotalMinor ?? cart.summary.subtotalBeforeDiscountCents, currency)}</span></div>
              {(summary ? summary.discountMinor > 0 : cart.summary.discountCents > 0) && (
                <div className="flex justify-between text-sale font-semibold"><span>Discount</span><span>-{formatMoney(summary?.discountMinor ?? cart.summary.discountCents, currency)}</span></div>
              )}
              <div className="flex justify-between text-muted-foreground">
                <span>Shipping</span>
                <span>{summary ? (summary.shippingMinor === 0 ? "Free" : formatMoney(summary.shippingMinor, currency)) : "Calculated securely"}</span>
              </div>
              {summary && summary.taxMinor > 0 && (
                <div className="flex justify-between text-muted-foreground"><span>Tax</span><span>{formatMoney(summary.taxMinor, currency)}</span></div>
              )}
              <div className="flex justify-between border-t border-border pt-3 mt-3 font-display text-lg font-black">
                <span>Total</span><span>{formatMoney(summary?.totalMinor ?? cart.summary.subtotalCents, currency)}</span>
              </div>
              {!summary && <p className="text-xs text-muted-foreground">The server recalculates prices, discounts, shipping, and stock before payment.</p>}
            </div>

            {session && msRemaining !== null && (
              <div className={`mt-4 flex items-center gap-2 rounded-2xl p-3 text-xs font-semibold ${expired ? "bg-red-50 text-red-700" : "bg-blush text-foreground/80"}`}>
                <Clock className="h-3.5 w-3.5 shrink-0" />
                {expired
                  ? "Your reserved items have been released. Start checkout again to reserve them."
                  : `Items reserved for ${formatCountdown(msRemaining)} — complete payment before then.`}
              </div>
            )}

            {error && (
              <div role="alert" className="mt-4 flex gap-2 rounded-2xl border border-red-200 bg-red-50 p-3 text-sm text-red-700">
                <AlertTriangle className="h-4 w-4 shrink-0 mt-0.5" /> <span>{error}</span>
              </div>
            )}

            <label className="mt-4 flex items-start gap-2.5 text-xs text-muted-foreground">
              <input type="checkbox" name="termsAccepted" required className="mt-0.5 h-4 w-4 shrink-0 accent-primary" />
              <span>
                I agree to the{" "}
                <Link href="/terms" target="_blank" className="text-primary hover:underline">Terms &amp; Conditions</Link>,{" "}
                <Link href="/privacy" target="_blank" className="text-primary hover:underline">Privacy Policy</Link>,{" "}
                <Link href="/shipping" target="_blank" className="text-primary hover:underline">Shipping Policy</Link>, and{" "}
                <Link href="/refund" target="_blank" className="text-primary hover:underline">Cancellation &amp; Refund Policy</Link>.
              </span>
            </label>

            <button
              type="submit"
              disabled={processing || !scriptReady || expired}
              className="btn-primary mt-3 w-full disabled:cursor-not-allowed disabled:opacity-60"
            >
              <CreditCard className="h-4 w-4" />
              {processing ? "Opening secure payment…" : !scriptReady ? "Loading payment…" : expired ? "Reservation expired" : "Pay securely"}
            </button>
            <div className="mt-3 flex items-center justify-center gap-1.5 text-xs text-muted-foreground">
              <LockKeyhole className="h-3.5 w-3.5" /> Payment handled by Razorpay
            </div>
            <Link href="/cart" className="btn-ghost-pink mt-3 block w-full text-center">Back to bag</Link>
          </aside>
        </form>
      </div>
    </>
  );
}

function Field({ label, className = "", required = true, ...props }: {
  label: string;
  name: string;
  className?: string;
  required?: boolean;
  type?: string;
  autoComplete?: string;
  minLength?: number;
  maxLength?: number;
  placeholder?: string;
  defaultValue?: string;
}) {
  return (
    <label className={`text-sm font-bold ${className}`}>
      {label}
      <input {...props} required={required} className="mt-1.5 w-full rounded-2xl border bg-white px-4 py-3 font-normal outline-none focus:border-primary" />
    </label>
  );
}
