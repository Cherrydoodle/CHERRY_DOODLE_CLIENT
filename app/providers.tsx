"use client";

import type { ReactNode } from "react";

import { CartDrawer } from "@/components/CartDrawer";
import { CookieConsentBanner } from "@/components/CookieConsentBanner";
import { Toaster } from "@/components/ui/sonner";
import { ShopProvider } from "@/lib/store";

export function Providers({ children }: { children: ReactNode }) {
  return (
    <ShopProvider>
      {children}
      <CartDrawer />
      <Toaster />
      <CookieConsentBanner />
    </ShopProvider>
  );
}
