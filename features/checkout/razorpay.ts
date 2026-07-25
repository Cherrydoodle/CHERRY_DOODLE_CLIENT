import "server-only";

import { createHmac, timingSafeEqual } from "node:crypto";

import { requireRazorpayConfig, requireRazorpayWebhookSecret } from "@/lib/env.server";
import { ApiError } from "@/lib/http/problem";

const API_BASE_URL = "https://api.razorpay.com/v1";

export type RazorpayPayment = {
  id: string;
  order_id: string | null;
  amount: number;
  currency: string;
  status: "created" | "authorized" | "captured" | "refunded" | "failed";
  captured: boolean;
  method: string | null;
  error_code?: string | null;
  error_description?: string | null;
  created_at: number;
};

type RazorpayOrder = {
  id: string;
  amount: number;
  currency: string;
  receipt: string;
  status: "created" | "attempted" | "paid";
};

function secureHexEqual(expected: string, supplied: string) {
  if (!/^[a-f0-9]{64}$/i.test(expected) || !/^[a-f0-9]{64}$/i.test(supplied)) return false;
  return timingSafeEqual(Buffer.from(expected, "hex"), Buffer.from(supplied, "hex"));
}

export function verifyRazorpayPaymentSignature(orderId: string, paymentId: string, signature: string, secret: string) {
  const expected = createHmac("sha256", secret).update(`${orderId}|${paymentId}`).digest("hex");
  return secureHexEqual(expected, signature);
}

// Takes the raw bytes, not a decoded string: decoding first would replace any byte
// sequence that is not valid UTF-8 with U+FFFD, and the HMAC would then be computed
// over something Razorpay never sent. Signature verification must see exactly the
// bytes that arrived.
export function verifyRazorpayWebhookSignature(rawBody: Uint8Array, signature: string | null, secret: string) {
  if (!signature) return false;
  const expected = createHmac("sha256", secret).update(rawBody).digest("hex");
  return secureHexEqual(expected, signature);
}

function providerHeaders() {
  const { keyId, keySecret } = requireRazorpayConfig();
  return {
    authorization: `Basic ${Buffer.from(`${keyId}:${keySecret}`).toString("base64")}`,
    "content-type": "application/json",
  };
}

const DEFAULT_TIMEOUT_MS = 12_000;

// Razorpay expects a webhook to be acknowledged within about five seconds, and this
// call happens inline while the webhook request is still open. A 12s budget could
// therefore blow the delivery deadline on its own, producing retry storms and
// eventually a disabled endpoint. Interactive requests keep the longer budget.
export const WEBHOOK_TIMEOUT_MS = 3_500;

type ProviderOptions = { timeoutMs?: number };

async function providerRequest<T>(path: string, init: RequestInit, options: ProviderOptions = {}): Promise<T> {
  let response: Response;
  try {
    response = await fetch(`${API_BASE_URL}${path}`, {
      ...init,
      headers: { ...providerHeaders(), ...init.headers },
      cache: "no-store",
      signal: AbortSignal.timeout(options.timeoutMs ?? DEFAULT_TIMEOUT_MS),
    });
  } catch {
    throw new ApiError(502, "PAYMENT_PROVIDER_UNAVAILABLE", "Razorpay could not be reached. Please try again.");
  }
  const body = await response.json().catch(() => null) as { error?: { description?: string } } | null;
  if (!response.ok) {
    // Razorpay's own wording is kept for the server log and the ApiError `cause`,
    // but never handed to the client: it is provider-internal text we do not
    // control, and it has leaked implementation detail into customer-facing copy.
    const detail = body?.error?.description?.slice(0, 300) || "no description";
    throw new ApiError(
      502,
      "PAYMENT_PROVIDER_ERROR",
      "The payment provider rejected this request. Please try again.",
      undefined,
      { cause: new Error(`Razorpay ${response.status}: ${detail}`) },
    );
  }
  return body as T;
}

export async function createRazorpayOrder(input: { amount: number; currency: string; receipt: string; checkoutId: string }) {
  const order = await providerRequest<RazorpayOrder>("/orders", {
    method: "POST",
    // Only documented Create-Order parameters are sent. A `payment_capture: 1` field
    // used to be passed here with a comment claiming it forced auto-capture; it is
    // not part of the current Orders API (amount, currency, receipt, notes,
    // partial_payment, first_payment_min_amount), so it guaranteed nothing. Capture
    // is now handled explicitly instead — see captureRazorpayPayment below and
    // finalizeCapturedPayment in ./service.ts.
    body: JSON.stringify({
      amount: input.amount,
      currency: input.currency,
      receipt: input.receipt,
      notes: { checkout_id: input.checkoutId },
    }),
  });
  if (order.amount !== input.amount || order.currency !== input.currency || order.receipt !== input.receipt) {
    throw new ApiError(502, "PAYMENT_PROVIDER_MISMATCH", "Razorpay returned unexpected order details.");
  }
  return order;
}

export async function fetchRazorpayPayment(paymentId: string, options: { timeoutMs?: number } = {}) {
  return providerRequest<RazorpayPayment>(`/payments/${encodeURIComponent(paymentId)}`, { method: "GET" }, options);
}

/**
 * Captures an authorized payment. Razorpay requires the captured amount and
 * currency to equal the authorized ones, so the caller passes the values it has
 * already validated against the checkout session.
 *
 * Auto-capture is an account-level Dashboard setting, not something the Orders API
 * can force. Without this call, an account with auto-capture off would leave every
 * payment `authorized`, no order would ever be created, and Razorpay would auto-
 * refund the customer after its holding period — a silent, total revenue outage.
 * Calling capture explicitly makes the outcome independent of that setting.
 */
export async function captureRazorpayPayment(paymentId: string, amount: number, currency: string) {
  return providerRequest<RazorpayPayment>(`/payments/${encodeURIComponent(paymentId)}/capture`, {
    method: "POST",
    body: JSON.stringify({ amount, currency }),
  });
}

// Used only by the reconciliation sync (RZ-050) to recover a checkout whose
// webhook AND client callback were both lost, by asking Razorpay directly which
// payments exist for the order we created. Read-only.
export async function fetchRazorpayOrderPayments(orderId: string) {
  return providerRequest<{ count: number; items: RazorpayPayment[] }>(`/orders/${encodeURIComponent(orderId)}/payments`, { method: "GET" });
}

export type RazorpayRefund = {
  id: string;
  entity: "refund";
  amount: number;
  currency: string;
  payment_id: string;
  status: "pending" | "processed" | "failed";
};

// Idempotency key scopes the refund to our internal refund row id, so a retried
// request (e.g. after a network timeout) cannot create two Razorpay refunds for
// the same internal refund.
export async function createRazorpayRefund(input: { paymentId: string; amount: number; idempotencyKey: string; notes?: Record<string, string> }) {
  return providerRequest<RazorpayRefund>(`/payments/${encodeURIComponent(input.paymentId)}/refund`, {
    method: "POST",
    headers: { "X-Razorpay-Idempotency-Key": input.idempotencyKey },
    body: JSON.stringify({ amount: input.amount, notes: input.notes ?? {} }),
  });
}

export function getRazorpayPublicConfig() {
  const { keyId, mode } = requireRazorpayConfig();
  return { keyId, mode };
}

export function getRazorpaySecret() {
  return requireRazorpayConfig().keySecret;
}

/**
 * Verifies a webhook against the current secret and, when configured, the previous
 * one. Rotating `RAZORPAY_WEBHOOK_SECRET` is otherwise a lossy operation: deliveries
 * signed with the old secret between the dashboard change and the deploy are
 * rejected outright, and Razorpay eventually gives up retrying them. Set
 * `RAZORPAY_WEBHOOK_SECRET_PREVIOUS` for the overlap window, then remove it.
 */
export function validateRazorpayWebhook(rawBody: Uint8Array, signature: string | null) {
  const { current, previous } = requireRazorpayWebhookSecret();
  if (verifyRazorpayWebhookSignature(rawBody, signature, current)) return true;
  return previous ? verifyRazorpayWebhookSignature(rawBody, signature, previous) : false;
}
