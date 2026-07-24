import type { Metadata } from "next";
import { headers } from "next/headers";

import { listMyAddresses } from "@/features/addresses/service";
import { optionalAuth } from "@/lib/auth/authorization";

import { CheckoutView } from "./checkout-view";

export const metadata: Metadata = {
  title: "Checkout",
  description: "Complete your Cherry Doodle order securely with Razorpay.",
  robots: { index: false, follow: false },
};

export default async function CheckoutPage() {
  const auth = await optionalAuth();
  const savedAddresses = auth ? await listMyAddresses() : [];
  const nonce = (await headers()).get("x-nonce");
  return <CheckoutView isAuthenticated={Boolean(auth)} savedAddresses={savedAddresses} nonce={nonce} />;
}
