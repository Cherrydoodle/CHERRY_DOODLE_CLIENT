import type { Metadata } from "next";

import { AddressesManager } from "./addresses-manager";

export const metadata: Metadata = { title: "Your addresses", robots: { index: false } };

export default function AccountAddressesPage() {
  return <AddressesManager />;
}
