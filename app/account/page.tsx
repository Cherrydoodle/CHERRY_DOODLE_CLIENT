import type { Metadata } from "next";
import { connection } from "next/server";

import { getProfile } from "@/features/auth/service";

import { AccountPanel } from "./account-panel";

export const metadata: Metadata = { title: "Account", robots: { index: false } };

export default async function AccountPage() {
  await connection();
  return <AccountPanel profile={await getProfile()} />;
}
