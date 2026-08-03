"use client";

import Script from "next/script";
import Image from "next/image";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { AlertTriangle, ChevronLeft, Clock, CreditCard, LockKeyhole, ShoppingBag } from "lucide-react";
import { useEffect, useRef, useState, type FormEvent } from "react";

import type { AddressDTO } from "@/features/addresses/service";
import { track } from "@/lib/analytics/posthog";
import { formatMoney, variantOptionLabel } from "@/lib/format";
import { shimmerPlaceholder } from "@/lib/image/shimmer";
import { useShop } from "@/lib/store";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";

import { CheckoutStepper, type CheckoutStep } from "./checkout-stepper";
import { DeliverToCard, type DeliverToAddress } from "./deliver-to-card";
import { FreeShippingNudge, PriceDetails, type PriceDetailsData } from "./price-details";

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
  const formRef = useRef<HTMLFormElement>(null);
  const step1Ref = useRef<HTMLDivElement>(null);
  const [session, setSession] = useState<StartCheckout | null>(null);
  const [now, setNow] = useState(() => Date.now());
  const [scriptReady, setScriptReady] = useState(false);
  const [processing, setProcessing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [step, setStep] = useState<CheckoutStep>(1);
  const [draftAddress, setDraftAddress] = useState<DeliverToAddress | null>(null);
  const [priceSheetOpen, setPriceSheetOpen] = useState(false);
  const defaultAddressId = savedAddresses.find((address) => address.isDefault)?.id ?? savedAddresses[0]?.id ?? "new";
  const [selectedAddressId, setSelectedAddressId] = useState<string>(defaultAddressId);
  const [billingSameAsShipping, setBillingSameAsShipping] = useState(true);
  const items = cart.items;
  const selectedAddress = savedAddresses.find((address) => address.id === selectedAddressId) ?? null;

  // Live pincode serviceability, checked as the shopper types/selects an address so
  // an unshippable pincode is caught before they advance past step 1 (the server
  // enforces the same check again in startRazorpayCheckout -- this is purely a
  // faster, friendlier signal, not the source of truth).
  const [shippingPostalCode, setShippingPostalCode] = useState(selectedAddress?.postalCode ?? "");
  const [shippingCountry, setShippingCountry] = useState(selectedAddress?.countryCode ?? "IN");
  const [serviceability, setServiceability] = useState<"idle" | "checking" | "serviceable" | "not-serviceable">("idle");

  // Resets the controlled fields to match a different saved address the shopper
  // just picked (an external UI action, not state derivable from props during render).
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setShippingPostalCode(selectedAddress?.postalCode ?? "");
    setShippingCountry(selectedAddress?.countryCode ?? "IN");
  }, [selectedAddress]);

  // Mirrors the debounced fetch below's status into state; there is no way to
  // compute this during render since it depends on an in-flight network request.
  useEffect(() => {
    if (shippingCountry !== "IN" || !/^[1-9][0-9]{5}$/.test(shippingPostalCode.replace(/\s/g, ""))) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setServiceability("idle");
      return;
    }
    setServiceability("checking");
    const controller = new AbortController();
    const timeout = window.setTimeout(() => {
      fetch(`/api/v1/shipping/serviceability?pincode=${encodeURIComponent(shippingPostalCode)}`, { signal: controller.signal })
        .then((response) => response.json())
        .then((payload) => setServiceability(payload?.data?.serviceable ? "serviceable" : "not-serviceable"))
        // A failed/unreachable check must not block the shopper from continuing --
        // the server's own fail-open gate is the real backstop.
        .catch(() => setServiceability("idle"));
    }, 500);
    return () => {
      window.clearTimeout(timeout);
      controller.abort();
    };
  }, [shippingPostalCode, shippingCountry]);

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

  // Steps stay mounted (CSS-hidden, never unmounted) so the address fields keep
  // their values when the shopper moves forward/back — a real unmount would drop
  // the uncontrolled inputs submit() later reads via `new FormData(event.currentTarget)`.
  const goToStep2 = () => {
    const container = step1Ref.current;
    if (container) {
      const controls = container.querySelectorAll<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>("input, textarea, select");
      for (const control of controls) {
        if (!control.reportValidity()) {
          control.focus();
          return;
        }
      }
    }
    // The inline "not serviceable" banner in the shipping-address section (below)
    // is already visible at this point -- this just stops the advance to step 2.
    if (serviceability === "not-serviceable") return;
    if (formRef.current) {
      const form = new FormData(formRef.current);
      const label = isAuthenticated && selectedAddressId !== "new" ? selectedAddress?.label ?? null : null;
      setDraftAddress({
        label,
        recipientName: String(form.get("name") || ""),
        phone: String(form.get("phone") || ""),
        line1: String(form.get("line1") || ""),
        line2: String(form.get("line2") || "") || undefined,
        city: String(form.get("city") || ""),
        state: String(form.get("state") || ""),
        postalCode: String(form.get("postalCode") || ""),
      });
    }
    setStep(2);
    window.scrollTo({ top: 0, behavior: "smooth" });
  };

  const goToStep = (target: CheckoutStep) => {
    setStep(target);
    window.scrollTo({ top: 0, behavior: "smooth" });
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
  const priceData: PriceDetailsData = {
    currency,
    itemCount: items.reduce((sum, item) => sum + item.quantity, 0),
    listTotalCents: summary?.subtotalMinor ?? cart.summary.subtotalBeforeDiscountCents,
    discountCents: summary?.discountMinor ?? cart.summary.discountCents,
    shippingCents: summary?.shippingMinor ?? cart.summary.shippingCents,
    taxCents: summary?.taxMinor ?? 0,
    totalCents: summary?.totalMinor ?? cart.summary.totalCents,
  };

  return (
    <>
      <Script
        src="https://checkout.razorpay.com/v1/checkout.js"
        strategy="afterInteractive"
        nonce={nonce ?? undefined}
        onLoad={() => setScriptReady(true)}
        onError={() => setError("Secure payment checkout could not be loaded.")}
      />
      <div className="mx-auto max-w-6xl px-4 py-10 pb-28 sm:px-6 md:pb-10">
        <div className="mb-6">
          <p className="text-sm font-bold text-primary">Secure checkout</p>
          <h1 className="font-display text-3xl font-black sm:text-4xl">Delivery and payment</h1>
        </div>

        <CheckoutStepper current={step} onStepClick={goToStep} />

        <form
          ref={formRef}
          id="checkout-form"
          onSubmit={submit}
          onChange={() => { if (!session) startKey.current = null; }}
          onKeyDown={(event) => {
            // Textareas don't implicitly submit on Enter (it just inserts a newline),
            // so only text inputs need guarding against jumping straight to payment.
            if (event.key === "Enter" && step !== 3 && (event.target as HTMLElement).tagName !== "TEXTAREA") event.preventDefault();
          }}
          className="grid gap-8 lg:grid-cols-[1fr_380px]"
        >
          <div className="space-y-6">
            {/* Step 1 · Address — always mounted, CSS-hidden so field values survive step changes */}
            <div ref={step1Ref} className={step === 1 ? "space-y-6" : "hidden"}>
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
                  <label className="text-sm font-bold">
                    Postal code
                    <input
                      name="postalCode" autoComplete="postal-code" minLength={3} maxLength={20} required
                      value={shippingPostalCode} onChange={(event) => setShippingPostalCode(event.target.value)}
                      className="mt-1.5 w-full rounded-2xl border bg-white px-4 py-3 font-normal outline-none focus:border-primary"
                    />
                  </label>
                  <label className="text-sm font-bold">
                    Country code
                    <input
                      name="country" autoComplete="country" minLength={2} maxLength={2} required
                      value={shippingCountry} onChange={(event) => setShippingCountry(event.target.value.toUpperCase())}
                      className="mt-1.5 w-full rounded-2xl border bg-white px-4 py-3 font-normal outline-none focus:border-primary"
                    />
                  </label>
                  {serviceability === "not-serviceable" && (
                    <div role="alert" className="sm:col-span-2 flex gap-2 rounded-2xl border border-red-200 bg-red-50 p-3 text-sm text-red-700">
                      <AlertTriangle className="h-4 w-4 shrink-0 mt-0.5" />
                      <span>We can&apos;t deliver to this pincode yet. Please double-check it or use a different address.</span>
                    </div>
                  )}
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

            {/* Step 2 · Order Summary */}
            {step === 2 && draftAddress && (
              <div className="space-y-6">
                <DeliverToCard address={draftAddress} onChange={() => goToStep(1)} />
                {!summary && cart.summary.freeShippingRemainingCents > 0 && (
                  <FreeShippingNudge
                    currency={cart.summary.currency}
                    thresholdCents={cart.summary.freeShippingThresholdCents}
                    remainingCents={cart.summary.freeShippingRemainingCents}
                    className="lg:hidden"
                  />
                )}
                <section className="card-soft p-5 sm:p-7">
                  <h2 className="font-display text-xl font-bold">Order summary</h2>
                  <ul className="mt-4 space-y-4">
                    {items.map((item) => (
                      <li key={item.id} className="flex gap-3 border-b border-border/60 pb-4 last:border-0 last:pb-0">
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
                </section>
                <PriceDetails data={priceData} className="card-soft p-5 sm:p-7 lg:hidden" />
              </div>
            )}

            {/* Step 3 · Payment */}
            {step === 3 && draftAddress && (
              <div className="space-y-6">
                <button type="button" onClick={() => goToStep(2)} className="inline-flex items-center gap-1 text-sm font-bold text-muted-foreground hover:text-primary">
                  <ChevronLeft className="h-4 w-4" /> Back to order summary
                </button>
                <DeliverToCard address={draftAddress} onChange={() => goToStep(1)} />

                <section className="card-soft p-5 sm:p-7">
                  <h2 className="font-display text-xl font-bold">Payment</h2>
                  <p className="mt-2 text-sm text-muted-foreground">Your final price and stock are verified securely before Razorpay opens.</p>

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

                  <div className="mt-3 flex items-center justify-center gap-1.5 text-xs text-muted-foreground">
                    <LockKeyhole className="h-3.5 w-3.5" /> Payment handled by Razorpay
                  </div>
                </section>
              </div>
            )}
          </div>

          <aside className="hidden h-fit lg:sticky lg:top-28 lg:block">
            {cart.summary.freeShippingRemainingCents > 0 && !summary && (
              <FreeShippingNudge
                currency={cart.summary.currency}
                thresholdCents={cart.summary.freeShippingThresholdCents}
                remainingCents={cart.summary.freeShippingRemainingCents}
                className="mb-4"
              />
            )}
            <div className="card-soft p-6">
              <PriceDetails data={priceData} />

              <button
                type={step === 3 ? "submit" : "button"}
                onClick={step === 1 ? goToStep2 : step === 2 ? () => goToStep(3) : undefined}
                disabled={(step === 1 && serviceability === "not-serviceable") || (step === 3 && (processing || !scriptReady || expired))}
                className="btn-primary mt-5 w-full disabled:cursor-not-allowed disabled:opacity-60"
              >
                {step === 1 && "Deliver here"}
                {step === 2 && "Continue"}
                {step === 3 && (
                  <>
                    <CreditCard className="h-4 w-4" />
                    {processing ? "Opening secure payment…" : !scriptReady ? "Loading payment…" : expired ? "Reservation expired" : "Pay securely"}
                  </>
                )}
              </button>
              <Link href="/cart" className="btn-ghost-pink mt-3 block w-full text-center">Back to bag</Link>
            </div>
          </aside>
        </form>
      </div>

      {/* Mobile sticky action bar — sits above content but never above BottomNav, which
          hides itself on /checkout so the two bars can't stack. */}
      <div className="fixed inset-x-0 bottom-0 z-50 border-t border-border bg-background/95 px-4 py-3 backdrop-blur-md md:hidden pb-[env(safe-area-inset-bottom)]">
        <div className="flex items-center justify-between gap-4">
          <div>
            {cart.summary.subtotalBeforeDiscountCents > priceData.totalCents && (
              <p className="text-xs text-muted-foreground line-through">{formatMoney(cart.summary.subtotalBeforeDiscountCents, currency)}</p>
            )}
            <p className="font-display text-lg font-black">{formatMoney(priceData.totalCents, currency)}</p>
            <button type="button" onClick={() => setPriceSheetOpen(true)} className="text-xs font-bold text-primary underline underline-offset-2">
              View price details
            </button>
          </div>
          <button
            type={step === 3 ? "submit" : "button"}
            form="checkout-form"
            onClick={step === 1 ? goToStep2 : step === 2 ? () => goToStep(3) : undefined}
            disabled={(step === 1 && serviceability === "not-serviceable") || (step === 3 && (processing || !scriptReady || expired))}
            className="btn-primary shrink-0 disabled:cursor-not-allowed disabled:opacity-60"
          >
            {step === 1 && "Deliver here"}
            {step === 2 && "Continue"}
            {step === 3 && (processing ? "Processing…" : !scriptReady ? "Loading…" : expired ? "Expired" : "Pay securely")}
          </button>
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
