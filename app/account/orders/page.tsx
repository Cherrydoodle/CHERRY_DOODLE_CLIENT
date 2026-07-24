import type { Metadata } from "next";
import Link from "next/link";
import { connection } from "next/server";
import { PackageSearch } from "lucide-react";

import { listMyOrders } from "@/features/customer-orders/service";
import { formatMoney } from "@/lib/format";

export const metadata: Metadata = { title: "Your orders", robots: { index: false } };

export default async function AccountOrdersPage() {
  await connection();
  const { items } = await listMyOrders(1, 50);

  return (
    <section className="mx-auto mt-12 max-w-3xl px-6">
      <div className="flex items-center justify-between gap-4">
        <h1 className="font-display text-3xl font-black">Your orders</h1>
        <Link href="/account" className="text-sm text-primary hover:underline">Back to account</Link>
      </div>

      {items.length === 0 ? (
        <div className="mt-10 rounded-3xl border bg-white p-10 text-center">
          <PackageSearch className="mx-auto h-10 w-10 text-muted-foreground" />
          <p className="mt-3 text-muted-foreground">You haven&apos;t placed any orders yet.</p>
          <Link href="/" className="btn-primary mt-5 inline-block">Start shopping</Link>
        </div>
      ) : (
        <ul className="mt-7 space-y-3">
          {items.map((order) => (
            <li key={order.id}>
              <Link
                href={`/account/orders/${order.id}`}
                className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border bg-white p-5 shadow-soft transition hover:border-primary"
              >
                <div>
                  <div className="font-bold">{order.orderNumber}</div>
                  <div className="text-sm text-muted-foreground">{new Date(order.placedAt).toLocaleDateString("en-IN", { year: "numeric", month: "short", day: "numeric" })}</div>
                </div>
                <div className="flex items-center gap-4 text-sm">
                  <span className="capitalize text-muted-foreground">{order.status.replace(/_/g, " ")}</span>
                  <span className="font-semibold">{formatMoney(order.totalMinor, order.currency)}</span>
                </div>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
