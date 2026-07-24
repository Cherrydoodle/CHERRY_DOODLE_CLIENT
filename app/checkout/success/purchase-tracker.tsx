"use client";

import { useEffect } from "react";

import { track } from "@/lib/analytics/posthog";

const FIRED_KEY_PREFIX = "cd_purchase_tracked_";

export function PurchaseTracker({
  orderId,
  orderNumber,
  totalMinor,
  currency,
  items,
}: {
  orderId: string;
  orderNumber: string;
  totalMinor: number;
  currency: string;
  items: Array<{ id: string; name: string; quantity: number; lineTotalMinor: number }>;
}) {
  useEffect(() => {
    const firedKey = `${FIRED_KEY_PREFIX}${orderId}`;
    // A reload or back-navigation to this page must not double-count the purchase.
    if (window.localStorage.getItem(firedKey)) return;
    track("purchase", {
      transaction_id: orderNumber,
      currency,
      value: totalMinor / 100,
      items: items.map((item) => ({ item_id: item.id, item_name: item.name, quantity: item.quantity, price: item.lineTotalMinor / 100 / item.quantity })),
    });
    window.localStorage.setItem(firedKey, "1");
  }, [orderId, orderNumber, totalMinor, currency, items]);

  return null;
}
