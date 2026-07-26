import type { Metadata } from "next";
import Link from "next/link";
import { CheckCircle2, Clock, XCircle } from "lucide-react";

import { getCheckoutConfirmation } from "@/features/checkout/service";
import { getStoreIdentity } from "@/features/store/identity";
import { formatMoney } from "@/lib/format";

import { PurchaseTracker } from "./purchase-tracker";

export const metadata: Metadata = {
  title: "Order confirmed",
  robots: { index: false, follow: false },
};

type SuccessParams = { checkoutId?: string; checkoutToken?: string };

type ShippingAddress = {
  line1?: string;
  line2?: string;
  city?: string;
  state?: string;
  postalCode?: string;
  country?: string;
};

export default async function CheckoutSuccessPage({ searchParams }: { searchParams: Promise<SuccessParams> }) {
  const { checkoutId, checkoutToken } = await searchParams;
  const store = await getStoreIdentity();
  const supportLine = (
    <>
      contact us at{" "}
      <a className="text-primary hover:underline" href={`mailto:${store.email}`}>{store.email}</a>
    </>
  );

  // Everything shown below comes from the database via the checkout capability
  // token pair, never from client-supplied URL data — a closed tab, a stale link,
  // or a manually edited URL can only ever reflect the true DB state or show
  // nothing at all.
  const confirmation =
    checkoutId && checkoutToken
      ? await getCheckoutConfirmation({ checkoutId, checkoutToken }).catch(() => null)
      : null;

  if (!confirmation) {
    return (
      <section className="mx-auto max-w-2xl px-6 py-24 text-center">
        <XCircle className="mx-auto h-16 w-16 text-muted-foreground" />
        <h1 className="mt-5 font-display text-4xl font-black">We couldn&apos;t find that order</h1>
        <p className="mt-3 text-muted-foreground">
          This confirmation link is invalid or has expired. If you were charged, check your account or {supportLine}.
        </p>
        <div className="mt-8 flex flex-wrap justify-center gap-3">
          <Link href="/account/orders" className="btn-primary">View your orders</Link>
          <Link href="/" className="btn-ghost-pink">Continue shopping</Link>
        </div>
      </section>
    );
  }

  if (confirmation.status === "completed") {
    const { order } = confirmation;
    const address = order.shippingAddress as ShippingAddress | null;
    const addressLine = address
      ? [address.line1, address.line2, address.city, address.state, address.postalCode, address.country].filter(Boolean).join(", ")
      : null;

    return (
      <section className="mx-auto max-w-2xl px-6 py-16">
        <PurchaseTracker orderId={order.id} orderNumber={order.orderNumber} totalMinor={order.totalMinor} currency={order.currency} items={order.items} />
        <div className="text-center">
          <CheckCircle2 className="mx-auto h-16 w-16 text-emerald-500" />
          <p className="mt-5 text-sm font-bold text-emerald-700">Payment captured</p>
          <h1 className="mt-2 font-display text-4xl font-black">Your order is confirmed!</h1>
          <p className="mt-3 text-muted-foreground">We have received your payment and sent the order to our fulfilment team.</p>
        </div>

        <div className="mx-auto mt-8 max-w-md rounded-2xl bg-blush px-5 py-4 text-sm space-y-1 text-center">
          <div>Order number <strong>{order.orderNumber}</strong></div>
          <div>Total <strong>{formatMoney(order.totalMinor, order.currency)}</strong></div>
          <div className="text-muted-foreground capitalize">Status: {order.status.replace(/_/g, " ")}</div>
          <div className="text-muted-foreground capitalize">Payment: {order.paymentStatus.replace(/_/g, " ")}</div>
        </div>

        <div className="mt-10 rounded-3xl border bg-white p-6">
          <h2 className="font-bold">Items</h2>
          <ul className="mt-3 divide-y">
            {order.items.map((item) => (
              <li key={item.id} className="flex items-center justify-between gap-4 py-3 text-sm">
                <div>
                  <div className="font-medium">{item.name}</div>
                  <div className="text-muted-foreground">
                    Qty {item.quantity}
                    {item.variantLabel ? ` · ${item.variantLabel}` : ""}
                    {item.sku ? ` · SKU ${item.sku}` : ""}
                  </div>
                </div>
                <div className="font-semibold">{formatMoney(item.lineTotalMinor, order.currency)}</div>
              </li>
            ))}
          </ul>
        </div>

        {addressLine && (
          <div className="mt-6 rounded-3xl border bg-white p-6 text-sm">
            <h2 className="font-bold">Shipping address</h2>
            <p className="mt-2 text-muted-foreground">{addressLine}</p>
          </div>
        )}

        {order.statusHistory.length > 0 && (
          <div className="mt-6 rounded-3xl border bg-white p-6 text-sm">
            <h2 className="font-bold">Order timeline</h2>
            <ul className="mt-2 space-y-1 text-muted-foreground">
              {order.statusHistory.map((event) => (
                <li key={event.id} className="capitalize">
                  {event.toStatus.replace(/_/g, " ")} — {new Date(event.createdAt).toLocaleString("en-IN")}
                </li>
              ))}
            </ul>
          </div>
        )}

        <p className="mt-8 text-center text-sm text-muted-foreground">Need help? {supportLine}.</p>

        <div className="mt-6 flex flex-wrap justify-center gap-3">
          <Link href="/account/orders" className="btn-primary">View your orders</Link>
          <Link href="/" className="btn-ghost-pink">Continue shopping</Link>
        </div>
      </section>
    );
  }

  if (confirmation.status === "failed" || confirmation.status === "expired") {
    return (
      <section className="mx-auto max-w-2xl px-6 py-24 text-center">
        <XCircle className="mx-auto h-16 w-16 text-muted-foreground" />
        <h1 className="mt-5 font-display text-4xl font-black">Payment did not complete</h1>
        <p className="mt-3 text-muted-foreground">
          This checkout was not completed and you have not been charged. You can return to your cart and try again,
          or {supportLine} if you think this is a mistake.
        </p>
        <div className="mt-8 flex flex-wrap justify-center gap-3">
          <Link href="/cart" className="btn-primary">Back to cart</Link>
          <Link href="/" className="btn-ghost-pink">Continue shopping</Link>
        </div>
      </section>
    );
  }

  return (
    <section className="mx-auto max-w-2xl px-6 py-24 text-center">
      <Clock className="mx-auto h-16 w-16 text-primary" />
      <p className="mt-5 text-sm font-bold text-primary">Payment received</p>
      <h1 className="mt-2 font-display text-4xl font-black">We&apos;re confirming your order</h1>
      <p className="mt-3 text-muted-foreground">
        Your payment went through and your order is being finalized. This can take a few minutes — refresh this
        page shortly, or check your account. If you don&apos;t hear from us within an hour, {supportLine} with your
        payment reference.
      </p>
      <div className="mt-8 flex flex-wrap justify-center gap-3">
        <Link href="/account/orders" className="btn-primary">View your orders</Link>
        <Link href="/" className="btn-ghost-pink">Continue shopping</Link>
      </div>
    </section>
  );
}
