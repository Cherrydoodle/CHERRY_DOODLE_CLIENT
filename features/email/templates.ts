import "server-only";

import type { StoreIdentity } from "@/features/store/identity";
import { formatMoney } from "@/lib/format";

// Transactional email bodies. Deliberately plain, table-free, inline-styled HTML:
// it renders identically in Gmail/Outlook/Apple Mail without a build step, and
// every message also carries a text/plain alternative (which materially helps
// deliverability for a freshly-verified domain).
//
// Every value interpolated into HTML goes through `escapeHtml` -- customer names,
// product names and admin-authored notes are all attacker-influenceable strings.

export type EmailMessageType =
  | "newsletter_confirmation"
  | "order_confirmation"
  | "payment_requires_review"
  | "payment_auto_refunded"
  | "order_shipped";

export type RenderedEmail = { subject: string; html: string; text: string };

type LineItem = { name: string; quantity: number; lineTotalMinor: number };

function escapeHtml(value: unknown): string {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

// Only http(s) URLs may become an href. A payload value that somehow carried
// `javascript:` must never be rendered as a clickable link.
function safeUrl(value: unknown): string | null {
  if (typeof value !== "string" || !value) return null;
  try {
    const url = new URL(value);
    return url.protocol === "https:" || url.protocol === "http:" ? url.toString() : null;
  } catch {
    return null;
  }
}

function asLineItems(value: unknown): LineItem[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((raw) => {
    if (!raw || typeof raw !== "object") return [];
    const item = raw as Record<string, unknown>;
    const quantity = Number(item.quantity);
    const lineTotalMinor = Number(item.lineTotalMinor);
    if (!Number.isFinite(quantity) || !Number.isFinite(lineTotalMinor)) return [];
    return [{ name: String(item.name ?? "Item"), quantity, lineTotalMinor }];
  });
}

function money(minor: unknown, currency: string) {
  const value = Number(minor);
  return Number.isFinite(value) ? formatMoney(value, currency) : "";
}

function layout(store: StoreIdentity, heading: string, bodyHtml: string): string {
  return `<!doctype html>
<html lang="en"><body style="margin:0;padding:0;background:#fdf6f7;font-family:-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;color:#2b2b2b;">
  <div style="max-width:560px;margin:0 auto;padding:32px 20px;">
    <div style="font-size:20px;font-weight:800;color:#e85b81;margin-bottom:24px;">${escapeHtml(store.storeName)}</div>
    <div style="background:#ffffff;border-radius:18px;padding:28px;">
      <h1 style="margin:0 0 16px;font-size:22px;line-height:1.3;">${escapeHtml(heading)}</h1>
      ${bodyHtml}
    </div>
    <div style="margin-top:24px;font-size:12px;line-height:1.6;color:#7a6b6d;">
      <div>${escapeHtml(store.storeName)} &middot; ${escapeHtml(store.address)}</div>
      <div>Questions? Reply to this email or write to <a href="mailto:${escapeHtml(store.email)}" style="color:#e85b81;">${escapeHtml(store.email)}</a>.</div>
    </div>
  </div>
</body></html>`;
}

function button(href: string, label: string): string {
  return `<p style="margin:24px 0 0;"><a href="${escapeHtml(href)}" style="display:inline-block;background:#e85b81;color:#ffffff;text-decoration:none;padding:12px 22px;border-radius:999px;font-weight:700;">${escapeHtml(label)}</a></p>`;
}

function orderConfirmation(payload: Record<string, unknown>, store: StoreIdentity): RenderedEmail {
  const currency = String(payload.currency || store.currency || "INR");
  const orderNumber = String(payload.orderNumber ?? "");
  const customerName = String(payload.customerName ?? "there");
  const items = asLineItems(payload.items);
  const total = money(payload.totalMinor, currency);
  // The enqueue happens inside complete_razorpay_checkout, which has no idea what
  // the site's public URL is, so the link is built here instead.
  const orderUrl = safeUrl(payload.orderUrl) ?? safeUrl(`${process.env.NEXT_PUBLIC_SITE_URL ?? ""}/account/orders`);

  const itemsHtml = items
    .map(
      (item) =>
        `<tr><td style="padding:8px 0;border-bottom:1px solid #f1e6e8;">${escapeHtml(item.name)} <span style="color:#7a6b6d;">&times; ${escapeHtml(item.quantity)}</span></td><td style="padding:8px 0;border-bottom:1px solid #f1e6e8;text-align:right;white-space:nowrap;">${escapeHtml(formatMoney(item.lineTotalMinor, currency))}</td></tr>`,
    )
    .join("");

  const html = layout(
    store,
    "Your order is confirmed",
    `<p style="margin:0 0 8px;line-height:1.6;">Hi ${escapeHtml(customerName)}, thank you! We have received your payment and your order is now with our fulfilment team.</p>
     <p style="margin:0 0 20px;line-height:1.6;">Order number <strong>${escapeHtml(orderNumber)}</strong></p>
     <table style="width:100%;border-collapse:collapse;font-size:14px;">${itemsHtml}
       <tr><td style="padding:12px 0;font-weight:800;">Total paid</td><td style="padding:12px 0;text-align:right;font-weight:800;">${escapeHtml(total)}</td></tr>
     </table>
     ${orderUrl ? button(orderUrl, "View your order") : ""}`,
  );

  const text = [
    `Hi ${customerName}, thank you! We have received your payment.`,
    ``,
    `Order number: ${orderNumber}`,
    ...items.map((item) => `- ${item.name} x ${item.quantity} — ${formatMoney(item.lineTotalMinor, currency)}`),
    `Total paid: ${total}`,
    ...(orderUrl ? [``, `View your order: ${orderUrl}`] : []),
    ``,
    `${store.storeName} · ${store.email}`,
  ].join("\n");

  return { subject: `Order ${orderNumber} confirmed — ${store.storeName}`, html, text };
}

function paymentRequiresReview(payload: Record<string, unknown>, store: StoreIdentity): RenderedEmail {
  const currency = String(payload.currency || store.currency || "INR");
  const amount = money(payload.amountMinor, currency);
  const customerName = String(payload.customerName ?? "there");
  const reference = String(payload.razorpayPaymentId ?? "");

  const html = layout(
    store,
    "We're finishing your order",
    `<p style="margin:0 0 12px;line-height:1.6;">Hi ${escapeHtml(customerName)}, your payment of <strong>${escapeHtml(amount)}</strong> went through, but we need a moment to finalise the order on our side.</p>
     <p style="margin:0 0 12px;line-height:1.6;">Our team has already been notified and will confirm within one business day. You do not need to pay again, and you will not be charged twice.</p>
     ${reference ? `<p style="margin:0;line-height:1.6;color:#7a6b6d;font-size:13px;">Payment reference: ${escapeHtml(reference)}</p>` : ""}`,
  );

  const text = [
    `Hi ${customerName}, your payment of ${amount} went through, but we need a moment to finalise the order.`,
    `Our team has been notified and will confirm within one business day. Please do not pay again.`,
    ...(reference ? [`Payment reference: ${reference}`] : []),
    ``,
    `${store.storeName} · ${store.email}`,
  ].join("\n");

  return { subject: `We're finishing your order — ${store.storeName}`, html, text };
}

function paymentAutoRefunded(payload: Record<string, unknown>, store: StoreIdentity): RenderedEmail {
  const currency = String(payload.currency || store.currency || "INR");
  const amount = money(payload.amountMinor, currency);
  const customerName = String(payload.customerName ?? "there");
  const reference = String(payload.razorpayPaymentId ?? "");

  const html = layout(
    store,
    "Your payment has been refunded",
    `<p style="margin:0 0 12px;line-height:1.6;">Hi ${escapeHtml(customerName)}, your payment of <strong>${escapeHtml(amount)}</strong> arrived after your checkout had expired and the items were released back to stock, so we could not place the order.</p>
     <p style="margin:0 0 12px;line-height:1.6;">We have refunded the full amount. It typically reaches your account within 5-7 working days, depending on your bank.</p>
     <p style="margin:0 0 12px;line-height:1.6;">Sorry about that — the items may still be available, so do try again.</p>
     ${reference ? `<p style="margin:0;line-height:1.6;color:#7a6b6d;font-size:13px;">Payment reference: ${escapeHtml(reference)}</p>` : ""}`,
  );

  const text = [
    `Hi ${customerName}, your payment of ${amount} arrived after your checkout expired, so the order could not be placed.`,
    `We have refunded the full amount; it usually reaches your account within 5-7 working days.`,
    ...(reference ? [`Payment reference: ${reference}`] : []),
    ``,
    `${store.storeName} · ${store.email}`,
  ].join("\n");

  return { subject: `Refund issued — ${store.storeName}`, html, text };
}

function orderShipped(payload: Record<string, unknown>, store: StoreIdentity): RenderedEmail {
  const orderNumber = String(payload.orderNumber ?? "");
  const customerName = String(payload.customerName ?? "there");
  const trackingUrl = safeUrl(payload.trackingUrl);

  const html = layout(
    store,
    "Your order is on its way",
    `<p style="margin:0 0 8px;line-height:1.6;">Hi ${escapeHtml(customerName)}, good news — your order is now with our courier partner and on its way to you.</p>
     <p style="margin:0 0 20px;line-height:1.6;">Order number <strong>${escapeHtml(orderNumber)}</strong></p>
     ${trackingUrl ? button(trackingUrl, "Track your package") : ""}`,
  );

  const text = [
    `Hi ${customerName}, good news — your order is now with our courier partner and on its way to you.`,
    ``,
    `Order number: ${orderNumber}`,
    ...(trackingUrl ? [``, `Track your package: ${trackingUrl}`] : []),
    ``,
    `${store.storeName} · ${store.email}`,
  ].join("\n");

  return { subject: `Order ${orderNumber} is on its way — ${store.storeName}`, html, text };
}

function newsletterConfirmation(payload: Record<string, unknown>, store: StoreIdentity): RenderedEmail | null {
  const confirmUrl = safeUrl(payload.confirmUrl);
  if (!confirmUrl) return null;
  const unsubscribeUrl = safeUrl(payload.unsubscribeUrl);

  const html = layout(
    store,
    "Confirm your subscription",
    `<p style="margin:0;line-height:1.6;">Tap the button below to start receiving new drops and offers from ${escapeHtml(store.storeName)}.</p>
     ${button(confirmUrl, "Confirm subscription")}
     ${unsubscribeUrl ? `<p style="margin:20px 0 0;font-size:12px;color:#7a6b6d;">Didn't sign up? <a href="${escapeHtml(unsubscribeUrl)}" style="color:#7a6b6d;">Unsubscribe</a>.</p>` : ""}`,
  );

  const text = [
    `Confirm your ${store.storeName} subscription:`,
    confirmUrl,
    ...(unsubscribeUrl ? [``, `Didn't sign up? Unsubscribe: ${unsubscribeUrl}`] : []),
  ].join("\n");

  return { subject: `Confirm your ${store.storeName} subscription`, html, text };
}

/**
 * Returns null for an unknown message type or a payload missing what the template
 * needs. The caller treats null as a permanent failure (the row will never render,
 * so retrying it is pointless) rather than a transient one.
 */
export function renderEmail(messageType: string, payload: unknown, store: StoreIdentity): RenderedEmail | null {
  const data = (payload && typeof payload === "object" ? payload : {}) as Record<string, unknown>;
  switch (messageType) {
    case "order_confirmation":
      return orderConfirmation(data, store);
    case "payment_requires_review":
      return paymentRequiresReview(data, store);
    case "payment_auto_refunded":
      return paymentAutoRefunded(data, store);
    case "order_shipped":
      return orderShipped(data, store);
    case "newsletter_confirmation":
      return newsletterConfirmation(data, store);
    default:
      return null;
  }
}
