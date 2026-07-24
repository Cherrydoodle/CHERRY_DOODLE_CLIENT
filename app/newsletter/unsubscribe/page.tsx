import type { Metadata } from "next";

import { UnsubscribeForm } from "./unsubscribe-form";

export const metadata: Metadata = { title: "Unsubscribe", robots: { index: false } };

export default async function UnsubscribePage({ searchParams }: { searchParams: Promise<{ token?: string }> }) {
  const { token } = await searchParams;
  return <UnsubscribeForm token={token ?? ""} />;
}
