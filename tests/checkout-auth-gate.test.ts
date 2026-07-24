import { beforeEach, describe, expect, it, vi } from "vitest";

// RZ-045 / RZ-000 decision #26: checkout requires login. The critical property to
// prove is ORDERING -- requireUser() must run and reject BEFORE any cart/pricing
// work (DB reads, Razorpay order creation) happens for an unauthenticated caller.
// The mocks below throw if actually invoked, so a passing test proves the
// fail-fast ordering, not just that the final promise happened to reject.

const requireUserMock = vi.fn();
vi.mock("@/lib/auth/authorization", () => ({ requireUser: () => requireUserMock() }));

vi.mock("@/lib/supabase/admin", () => ({
  createAdminSupabaseClient: () => {
    throw new Error("must not touch the database before requireUser() resolves");
  },
}));
vi.mock("@/features/checkout/razorpay", () => ({
  createRazorpayOrder: () => {
    throw new Error("must not call Razorpay before requireUser() resolves");
  },
  fetchRazorpayPayment: vi.fn(),
  getRazorpayPublicConfig: vi.fn(),
  getRazorpaySecret: vi.fn(),
  verifyRazorpayPaymentSignature: vi.fn(),
}));
vi.mock("@/features/refunds/service", () => ({ processRefundWebhookEvent: vi.fn() }));

const { startRazorpayCheckout } = await import("@/features/checkout/service");

const VALID_INPUT = {
  customer: { name: "Asha Kumar", email: "asha@example.com", phone: "+91 98765 43210" },
  shippingAddress: { line1: "14 Blossom Road", city: "Bengaluru", state: "Karnataka", postalCode: "560001", country: "IN" },
  items: [{ productSlug: "cherry-bunny-gel-pen-set", color: "Cherry", quantity: 1 }],
  termsAccepted: true as const,
};

beforeEach(() => {
  requireUserMock.mockReset();
});

describe("startRazorpayCheckout requires login (RZ-045)", () => {
  it("rejects an unauthenticated checkout attempt before touching the database or Razorpay", async () => {
    requireUserMock.mockRejectedValue(Object.assign(new Error("Authentication is required."), { status: 401, code: "AUTH_REQUIRED" }));
    await expect(startRazorpayCheckout(VALID_INPUT)).rejects.toMatchObject({ status: 401, code: "AUTH_REQUIRED" });
  });

  it("calls requireUser() (not the old optional/guest-permitting check)", async () => {
    requireUserMock.mockRejectedValue(Object.assign(new Error("Authentication is required."), { status: 401 }));
    await expect(startRazorpayCheckout(VALID_INPUT)).rejects.toBeDefined();
    expect(requireUserMock).toHaveBeenCalledTimes(1);
  });
});
