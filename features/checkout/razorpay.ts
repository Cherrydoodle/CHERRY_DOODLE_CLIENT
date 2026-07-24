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

export function verifyRazorpayWebhookSignature(rawBody: string, signature: string | null, secret: string) {
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

async function providerRequest<T>(path: string, init: RequestInit): Promise<T> {
  let response: Response;
  try {
    response = await fetch(`${API_BASE_URL}${path}`, {
      ...init,
      headers: { ...providerHeaders(), ...init.headers },
      cache: "no-store",
      signal: AbortSignal.timeout(12_000),
    });
  } catch {
    throw new ApiError(502, "PAYMENT_PROVIDER_UNAVAILABLE", "Razorpay could not be reached. Please try again.");
  }
  const body = await response.json().catch(() => null) as { error?: { description?: string } } | null;
  if (!response.ok) {
    const detail = body?.error?.description?.slice(0, 300) || "Razorpay rejected the payment request.";
    throw new ApiError(502, "PAYMENT_PROVIDER_ERROR", detail);
  }
  return body as T;
}

export async function createRazorpayOrder(input: { amount: number; currency: string; receipt: string; checkoutId: string }) {
  const order = await providerRequest<RazorpayOrder>("/orders", {
    method: "POST",
    body: JSON.stringify({
      amount: input.amount,
      currency: input.currency,
      receipt: input.receipt,
      // Force auto-capture instead of inheriting the dashboard's capture setting.
      // Without this, a merchant account left on manual/two-step capture would leave
      // payments in `authorized` state, `finalizeCapturedPayment` would reject them
      // as PAYMENT_NOT_CAPTURED indefinitely, and funds would sit uncaptured with no
      // order ever created.
      payment_capture: 1,
      notes: { checkout_id: input.checkoutId },
    }),
  });
  if (order.amount !== input.amount || order.currency !== input.currency || order.receipt !== input.receipt) {
    throw new ApiError(502, "PAYMENT_PROVIDER_MISMATCH", "Razorpay returned unexpected order details.");
  }
  return order;
}

export async function fetchRazorpayPayment(paymentId: string) {
  return providerRequest<RazorpayPayment>(`/payments/${encodeURIComponent(paymentId)}`, { method: "GET" });
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

export function validateRazorpayWebhook(rawBody: string, signature: string | null) {
  return verifyRazorpayWebhookSignature(rawBody, signature, requireRazorpayWebhookSecret());
}
