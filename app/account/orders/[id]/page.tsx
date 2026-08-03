import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { connection } from "next/server";

import { getMyOrder } from "@/features/customer-orders/service";
import { getStoreIdentity } from "@/features/store/identity";
import { ApiError } from "@/lib/http/problem";
import { formatMoney } from "@/lib/format";

import { OrderActions } from "./order-actions";

export const metadata: Metadata = { title: "Order details", robots: { index: false } };

type ShippingAddress = {
  line1?: string;
  line2?: string;
  city?: string;
  state?: string;
  postalCode?: string;
  country?: string;
};

export default async function AccountOrderDetailPage({ params }: { params: Promise<{ id: string }> }) {
  await connection();
  const { id } = await params;

  const [order, store] = await Promise.all([
    getMyOrder(id).catch((error: unknown) => {
      if (error instanceof ApiError && error.status === 404) notFound();
      throw error;
    }),
    getStoreIdentity(),
  ]);

  const address = order.shippingAddress as ShippingAddress | null;
  const addressLine = address
    ? [address.line1, address.line2, address.city, address.state, address.postalCode, address.country].filter(Boolean).join(", ")
    : null;

  return (
    <section className="mx-auto mt-12 max-w-2xl px-6 pb-16">
      <div className="flex items-center justify-between gap-4">
        <h1 className="font-display text-3xl font-black">{order.orderNumber}</h1>
        <Link href="/account/orders" className="text-sm text-primary hover:underline">Back to your orders</Link>
      </div>
      <p className="mt-1 text-sm text-muted-foreground">
        Placed {new Date(order.placedAt).toLocaleDateString("en-IN", { year: "numeric", month: "long", day: "numeric" })}
      </p>

      <div className="mt-6 flex flex-wrap gap-3 text-sm">
        <span className="chip bg-blush capitalize">Status: {order.status.replace(/_/g, " ")}</span>
        <span className="chip bg-mint capitalize">Payment: {order.paymentStatus.replace(/_/g, " ")}</span>
        {order.returnStatus !== "none" && (
          <span className="chip bg-lilac capitalize">Return: {order.returnStatus.replace(/_/g, " ")}</span>
        )}
      </div>

      <div className="mt-8 rounded-3xl border bg-white p-6">
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
        <dl className="mt-4 space-y-1 border-t pt-4 text-sm">
          <div className="flex justify-between"><dt className="text-muted-foreground">Subtotal</dt><dd>{formatMoney(order.subtotalMinor, order.currency)}</dd></div>
          {order.discountMinor > 0 && <div className="flex justify-between"><dt className="text-muted-foreground">Discount</dt><dd>-{formatMoney(order.discountMinor, order.currency)}</dd></div>}
          <div className="flex justify-between"><dt className="text-muted-foreground">Shipping</dt><dd>{formatMoney(order.shippingMinor, order.currency)}</dd></div>
          {order.taxMinor > 0 && <div className="flex justify-between"><dt className="text-muted-foreground">Tax</dt><dd>{formatMoney(order.taxMinor, order.currency)}</dd></div>}
          <div className="flex justify-between font-bold"><dt>Total</dt><dd>{formatMoney(order.totalMinor, order.currency)}</dd></div>
        </dl>
      </div>

      {addressLine && (
        <div className="mt-6 rounded-3xl border bg-white p-6 text-sm">
          <h2 className="font-bold">Shipping address</h2>
          <p className="mt-2 text-muted-foreground">{addressLine}</p>
        </div>
      )}

      {(order.carrier || order.trackingNumber) && (
        <div className="mt-6 rounded-3xl border bg-white p-6 text-sm">
          <h2 className="font-bold">Delivery tracking</h2>
          <dl className="mt-2 space-y-1 text-muted-foreground">
            {order.carrier && <div className="flex justify-between"><dt>Carrier</dt><dd className="font-medium text-foreground">{order.carrier}</dd></div>}
            {order.trackingNumber && <div className="flex justify-between"><dt>Tracking number</dt><dd className="font-medium text-foreground">{order.trackingNumber}</dd></div>}
          </dl>
          {order.trackingUrl && (
            <a href={order.trackingUrl} target="_blank" rel="noopener noreferrer" className="mt-3 inline-block text-primary hover:underline">
              Track your package →
            </a>
          )}
          {order.shipmentScans.length > 0 && (
            <ol className="mt-4 space-y-3 border-t pt-4">
              {order.shipmentScans.slice().reverse().map((scan, index) => (
                <li key={`${scan.scannedAt}-${index}`} className="flex justify-between gap-3">
                  <div>
                    <p className="font-medium text-foreground">{scan.status}</p>
                    {scan.location && <p className="text-xs text-muted-foreground">{scan.location}</p>}
                  </div>
                  <time dateTime={scan.scannedAt} className="shrink-0 text-xs text-muted-foreground">
                    {new Date(scan.scannedAt).toLocaleString()}
                  </time>
                </li>
              ))}
            </ol>
          )}
        </div>
      )}

      {order.customerNote && (
        <div className="mt-6 rounded-3xl border bg-white p-6 text-sm">
          <h2 className="font-bold">Order note</h2>
          <p className="mt-2 text-muted-foreground">{order.customerNote}</p>
        </div>
      )}

      {order.returnStatus !== "none" && (
        <div className="mt-6 rounded-3xl border bg-white p-6 text-sm">
          <h2 className="font-bold">Return status</h2>
          <p className="mt-2 capitalize text-muted-foreground">{order.returnStatus.replace(/_/g, " ")}</p>
          {order.returnReason && <p className="mt-1 text-muted-foreground">Your reason: {order.returnReason}</p>}
          {order.returnResolutionNote && <p className="mt-1 text-muted-foreground">Note from us: {order.returnResolutionNote}</p>}
        </div>
      )}

      {order.refunds.length > 0 && (
        <div className="mt-6 rounded-3xl border bg-white p-6 text-sm">
          <h2 className="font-bold">Refunds</h2>
          <ul className="mt-2 space-y-1 text-muted-foreground">
            {order.refunds.map((refund) => (
              <li key={refund.id} className="flex justify-between gap-4">
                <span className="capitalize">{refund.status} — {refund.reason}</span>
                <span className="font-semibold text-foreground">{formatMoney(refund.amountMinor, refund.currency)}</span>
              </li>
            ))}
          </ul>
        </div>
      )}

      <OrderActions orderId={order.id} status={order.status} returnStatus={order.returnStatus} />

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

      <p className="mt-8 text-sm text-muted-foreground">
        Questions about this order? Contact us at{" "}
        <a className="text-primary hover:underline" href={`mailto:${store.email}`}>{store.email}</a> or see our{" "}
        <Link href="/refund" className="text-primary hover:underline">Cancellation &amp; Refund Policy</Link>.
      </p>
    </section>
  );
}
