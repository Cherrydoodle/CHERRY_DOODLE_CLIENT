import "server-only";

import { requireDelhiveryConfig } from "@/lib/env.server";
import { ApiError } from "@/lib/http/problem";

import {
  manifestResponseSchema,
  pincodeServiceabilityResponseSchema,
  trackingResponseSchema,
} from "@/features/delhivery/schemas";

// Thin HTTP wrapper around Delhivery's Express API, mirroring the shape of
// features/checkout/razorpay.ts#providerRequest: a fixed timeout, `cache: "no-store"`,
// and the provider's own error text kept only in `ApiError.cause` (server logs /
// Sentry), never handed to the client as-is.

const DEFAULT_TIMEOUT_MS = 15_000;

type ProviderOptions = { timeoutMs?: number };

function authHeaders() {
  const { apiToken } = requireDelhiveryConfig();
  return { Authorization: `Token ${apiToken}`, Accept: "application/json" };
}

async function providerFetch(path: string, init: RequestInit, options: ProviderOptions = {}): Promise<Response> {
  const { baseUrl } = requireDelhiveryConfig();
  try {
    return await fetch(`${baseUrl}${path}`, {
      ...init,
      headers: { ...authHeaders(), ...init.headers },
      cache: "no-store",
      signal: AbortSignal.timeout(options.timeoutMs ?? DEFAULT_TIMEOUT_MS),
    });
  } catch {
    throw new ApiError(502, "SHIPPING_PROVIDER_UNAVAILABLE", "The shipping provider could not be reached. Please try again.");
  }
}

async function providerJson<T>(path: string, init: RequestInit, options: ProviderOptions = {}): Promise<T> {
  const response = await providerFetch(path, init, options);
  const text = await response.text();
  let body: unknown = null;
  try {
    body = text ? JSON.parse(text) : null;
  } catch {
    body = null;
  }
  if (!response.ok) {
    const remark = body && typeof body === "object" && "rmk" in body ? String((body as Record<string, unknown>).rmk) : null;
    const detail = (remark || text || "no description").slice(0, 300);
    throw new ApiError(
      502,
      "SHIPPING_PROVIDER_ERROR",
      "The shipping provider rejected this request. Please try again.",
      undefined,
      { cause: new Error(`Delhivery ${response.status}: ${detail}`) },
    );
  }
  return body as T;
}

export async function checkPincode(pin: string) {
  const raw = await providerJson<unknown>(`/c/api/pin-codes/json/?filter_codes=${encodeURIComponent(pin)}`, { method: "GET" });
  return pincodeServiceabilityResponseSchema.parse(raw);
}

export async function fetchWaybills(count: number): Promise<string[]> {
  const { clientName } = requireDelhiveryConfig();
  const raw = await providerJson<unknown>(`/waybill/api/bulk/json/?cl=${encodeURIComponent(clientName)}&count=${count}`, { method: "GET" });
  // Observed response shapes differ by account: a JSON array of waybill strings,
  // or a single comma-separated string.
  const waybills = Array.isArray(raw)
    ? raw.map(String)
    : typeof raw === "string"
      ? raw.split(",").map((value) => value.trim()).filter(Boolean)
      : [];
  if (waybills.length === 0) throw new ApiError(502, "SHIPPING_PROVIDER_ERROR", "The shipping provider returned no waybills.");
  return waybills;
}

export async function createManifest(input: { shipments: Array<Record<string, unknown>>; pickupLocation: Record<string, unknown> }) {
  // Delhivery's manifest API is not JSON-bodied: the payload is a JSON document
  // urlencoded into a single `data` form field, prefixed with `format=json&data=`.
  const body = `format=json&data=${encodeURIComponent(JSON.stringify({ shipments: input.shipments, pickup_location: input.pickupLocation }))}`;
  const raw = await providerJson<unknown>("/api/cmu/create.json", {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body,
  });
  return manifestResponseSchema.parse(raw);
}

export async function trackWaybills(waybills: string[]) {
  const raw = await providerJson<unknown>(`/api/v1/packages/json/?waybill=${waybills.map(encodeURIComponent).join(",")}`, { method: "GET" });
  return trackingResponseSchema.parse(raw);
}

/** Returns the raw bytes and content-type Delhivery served, unmodified: the docs
 * describe a JSON packing-slip response but `pdf=true` is documented to change
 * that, so the route streams back whatever Delhivery actually sent rather than
 * assuming a format. */
export async function fetchPackingSlip(waybills: string[]) {
  const response = await providerFetch(
    `/api/p/packing_slip?wbns=${waybills.map(encodeURIComponent).join(",")}&pdf=true&pdf_size=4R`,
    { method: "GET" },
    { timeoutMs: 20_000 },
  );
  if (!response.ok) throw new ApiError(502, "SHIPPING_PROVIDER_ERROR", "The shipping label could not be retrieved.");
  return {
    contentType: response.headers.get("content-type") ?? "application/octet-stream",
    bytes: new Uint8Array(await response.arrayBuffer()),
  };
}

export async function createPickupRequest(input: { pickupDate: string; pickupTime: string; expectedPackageCount: number }) {
  const { pickupLocationName } = requireDelhiveryConfig();
  return providerJson<Record<string, unknown>>("/fm/request/new/", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      pickup_time: input.pickupTime,
      pickup_date: input.pickupDate,
      pickup_location: pickupLocationName,
      expected_package_count: input.expectedPackageCount,
    }),
  });
}
