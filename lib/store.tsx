"use client";

import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from "react";
import { toast } from "sonner";

import { track } from "@/lib/analytics/posthog";
import type { CartDTO } from "@/features/cart/types";
import type { ProductSummaryDTO } from "@/features/catalog/types";

const GUEST_WISHLIST_KEY = "cd_guest_wishlist";
// Marks that guest cart/wishlist have already been folded into the signed-in
// account for this browser session, so a hard reload of an authenticated page
// doesn't re-run the (otherwise no-op) claim on every load.
const GUEST_CLAIM_KEY = "cd_guest_claimed";

// Placeholder shown only while the real cart is in flight (cartLoading is true) --
// consumers gate on cartLoading before trusting these numbers, so the free-shipping
// fields are zeroed here rather than duplicating the server's threshold client-side.
const emptyCart: CartDTO = {
  id: null,
  owner: "guest",
  items: [],
  summary: { currency: "INR", itemCount: 0, subtotalBeforeDiscountCents: 0, discountCents: 0, subtotalCents: 0, shippingCents: 0, freeShippingThresholdCents: 0, freeShippingRemainingCents: 0, totalCents: 0 },
  updatedAt: null,
};

type Envelope<T> = { data: T };

class ShopApiError extends Error {
  constructor(public status: number, public code: string, message: string) {
    super(message);
  }
}

async function apiFetch<T>(path: string, init: RequestInit = {}): Promise<T> {
  const headers = new Headers(init.headers);
  if (init.body && !headers.has("content-type")) headers.set("content-type", "application/json");
  if (init.method && init.method !== "GET" && !headers.has("idempotency-key")) headers.set("idempotency-key", crypto.randomUUID());
  const response = await fetch(path, { ...init, headers, cache: "no-store" });
  if (response.status === 204) return undefined as T;
  const body = await response.json().catch(() => ({}));
  if (!response.ok) throw new ShopApiError(response.status, body.code || "REQUEST_FAILED", body.detail || body.title || "The request could not be completed.");
  return (body as Envelope<T>).data;
}

function loadGuestWishlist(): ProductSummaryDTO[] {
  try {
    const raw = localStorage.getItem(GUEST_WISHLIST_KEY);
    if (!raw) return [];
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((item): item is ProductSummaryDTO => typeof item === "object" && item !== null && typeof (item as { id?: unknown }).id === "string");
  } catch {
    return [];
  }
}

function saveGuestWishlist(items: ProductSummaryDTO[]) {
  try {
    localStorage.setItem(GUEST_WISHLIST_KEY, JSON.stringify(items));
  } catch {}
}

function guestActivityClaimed(): boolean {
  try {
    return sessionStorage.getItem(GUEST_CLAIM_KEY) === "1";
  } catch {
    return false;
  }
}

function markGuestActivityClaimed() {
  try {
    sessionStorage.setItem(GUEST_CLAIM_KEY, "1");
  } catch {}
}

/** Clear the once-per-session claim guard so the next sign-in merges guest activity again. Call on logout. */
export function resetGuestActivityClaim() {
  try {
    sessionStorage.removeItem(GUEST_CLAIM_KEY);
  } catch {}
}

type ShopState = {
  hydrated: boolean;
  authenticated: boolean;
  cart: CartDTO;
  cartLoading: boolean;
  cartDrawerOpen: boolean;
  lastAddedItemId: string | null;
  openCartDrawer: () => void;
  closeCartDrawer: () => void;
  wishlist: ProductSummaryDTO[];
  wishlistLoading: boolean;
  addToCart: (variantId: string, quantity?: number) => Promise<void>;
  updateCartQuantity: (itemId: string, quantity: number) => Promise<void>;
  removeFromCart: (itemId: string) => Promise<void>;
  clearCart: () => Promise<void>;
  toggleWishlist: (product: ProductSummaryDTO) => Promise<void>;
  isWished: (productId: string) => boolean;
  moveToCart: (productId: string) => Promise<void>;
  /** Call once after a successful login to fold guest cart/wishlist activity into the signed-in account. */
  claimGuestActivity: () => Promise<void>;
  /** Re-fetch the cart from the server, e.g. after checkout reports stale prices/stock. */
  refreshCart: () => Promise<void>;
};

const Ctx = createContext<ShopState | null>(null);

export function ShopProvider({ children }: { children: ReactNode }) {
  const [hydrated, setHydrated] = useState(false);
  const [authenticated, setAuthenticated] = useState(false);
  const [cart, setCart] = useState<CartDTO>(emptyCart);
  const [cartLoading, setCartLoading] = useState(true);
  const [cartDrawerOpen, setCartDrawerOpen] = useState(false);
  const [lastAddedItemId, setLastAddedItemId] = useState<string | null>(null);
  const [wishlist, setWishlist] = useState<ProductSummaryDTO[]>([]);
  const [wishlistLoading, setWishlistLoading] = useState(true);

  const refreshCart = useCallback(async () => {
    setCartLoading(true);
    try {
      setCart(await apiFetch<CartDTO>("/api/v1/cart"));
    } catch {
      setCart(emptyCart);
    } finally {
      setCartLoading(false);
    }
  }, []);

  const refreshAuthedWishlist = useCallback(async () => {
    setWishlistLoading(true);
    try {
      const result = await apiFetch<{ items: ProductSummaryDTO[] }>("/api/v1/wishlist");
      setWishlist(result.items);
    } catch {
      setWishlist([]);
    } finally {
      setWishlistLoading(false);
    }
  }, []);

  const claimGuestActivity = useCallback(async () => {
    const guestWishlist = loadGuestWishlist();
    // Server reads the httpOnly guest-cart cookie; a no-cookie claim is a safe no-op.
    await apiFetch("/api/v1/cart/claim", { method: "POST" }).catch(() => {});
    if (guestWishlist.length) {
      await apiFetch("/api/v1/wishlist/merge", {
        method: "POST",
        body: JSON.stringify({ productIds: guestWishlist.map((item) => item.id) }),
      }).catch(() => {});
    }
    saveGuestWishlist([]);
    markGuestActivityClaimed();
    setAuthenticated(true);
    await Promise.all([refreshCart(), refreshAuthedWishlist()]);
  }, [refreshCart, refreshAuthedWishlist]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const profile = await apiFetch("/api/v1/me").then(
        () => true,
        () => false,
      );
      if (cancelled) return;
      setAuthenticated(profile);
      if (profile) {
        // First authenticated hydration of the session folds any guest cart/wishlist
        // into the account. This is the path that covers Google OAuth (a full-page
        // redirect through /auth/callback remounts this provider); email/password
        // login is an in-app navigation and claims explicitly from the auth form.
        if (!guestActivityClaimed()) {
          await claimGuestActivity();
        } else {
          await Promise.all([refreshCart(), refreshAuthedWishlist()]);
        }
      } else {
        await Promise.all([
          refreshCart(),
          (async () => {
            setWishlist(loadGuestWishlist());
            setWishlistLoading(false);
          })(),
        ]);
      }
      if (!cancelled) setHydrated(true);
    })();
    return () => {
      cancelled = true;
    };
  }, [refreshCart, refreshAuthedWishlist, claimGuestActivity]);

  const openCartDrawer = useCallback(() => setCartDrawerOpen(true), []);
  const closeCartDrawer = useCallback(() => setCartDrawerOpen(false), []);

  const addToCart = useCallback(async (variantId: string, quantity = 1) => {
    try {
      const updated = await apiFetch<CartDTO>("/api/v1/cart/items", {
        method: "POST",
        body: JSON.stringify({ productVariantId: variantId, quantity }),
      });
      setCart(updated);
      const addedItem = updated.items.find((item) => item.variant.id === variantId);
      setLastAddedItemId(addedItem?.id ?? null);
      const isMobile = typeof window !== "undefined" && window.matchMedia("(max-width: 767px)").matches;
      if (isMobile) {
        toast.success("Added to your bag");
      } else {
        setCartDrawerOpen(true);
      }
      if (addedItem) {
        track("add_to_cart", {
          currency: updated.summary.currency,
          value: addedItem.unitPriceCents / 100,
          items: [{ item_id: addedItem.product.id, item_name: addedItem.product.name, price: addedItem.unitPriceCents / 100, quantity }],
        });
      }
    } catch (cause) {
      toast.error(cause instanceof ShopApiError ? cause.message : "Could not add this to your bag. Please try again.");
      throw cause;
    }
  }, []);

  const updateCartQuantity = useCallback(async (itemId: string, quantity: number) => {
    try {
      const updated = await apiFetch<CartDTO>(`/api/v1/cart/items/${itemId}`, {
        method: "PATCH",
        body: JSON.stringify({ quantity }),
      });
      setCart(updated);
    } catch (cause) {
      toast.error(cause instanceof ShopApiError ? cause.message : "Could not update your bag. Please try again.");
      throw cause;
    }
  }, []);

  const removeFromCart = useCallback(async (itemId: string) => {
    try {
      const updated = await apiFetch<CartDTO>(`/api/v1/cart/items/${itemId}`, { method: "DELETE" });
      setCart(updated);
    } catch (cause) {
      toast.error(cause instanceof ShopApiError ? cause.message : "Could not remove this item. Please try again.");
      throw cause;
    }
  }, []);

  const clearCart = useCallback(async () => {
    await apiFetch<undefined>("/api/v1/cart/items", { method: "DELETE" });
    await refreshCart();
  }, [refreshCart]);

  const isWished = useCallback((productId: string) => wishlist.some((item) => item.id === productId), [wishlist]);

  const toggleWishlist = useCallback(
    async (product: ProductSummaryDTO) => {
      const wished = wishlist.some((item) => item.id === product.id);
      if (authenticated) {
        try {
          if (wished) {
            await apiFetch(`/api/v1/wishlist/${product.id}`, { method: "DELETE" });
            setWishlist((prev) => prev.filter((item) => item.id !== product.id));
          } else {
            await apiFetch(`/api/v1/wishlist/${product.id}`, { method: "PUT" });
            setWishlist((prev) => [product, ...prev]);
          }
        } catch (cause) {
          toast.error(cause instanceof ShopApiError ? cause.message : "Could not update your wishlist. Please try again.");
        }
        return;
      }
      setWishlist((prev) => {
        const next = wished ? prev.filter((item) => item.id !== product.id) : [product, ...prev];
        saveGuestWishlist(next);
        return next;
      });
    },
    [wishlist, authenticated],
  );

  const moveToCart = useCallback(
    async (productId: string) => {
      if (authenticated) {
        const result = await apiFetch<{ cart: CartDTO; wishlist: { items: ProductSummaryDTO[] } }>(`/api/v1/wishlist/${productId}/move-to-cart`, {
          method: "POST",
          body: JSON.stringify({}),
        });
        setCart(result.cart);
        setWishlist(result.wishlist.items);
        return;
      }
      const product = wishlist.find((item) => item.id === productId);
      if (!product?.defaultVariantId) return;
      await addToCart(product.defaultVariantId, 1);
      setWishlist((prev) => {
        const next = prev.filter((item) => item.id !== productId);
        saveGuestWishlist(next);
        return next;
      });
    },
    [authenticated, wishlist, addToCart],
  );

  return (
    <Ctx.Provider
      value={{
        hydrated, authenticated, cart, cartLoading, cartDrawerOpen, lastAddedItemId,
        openCartDrawer, closeCartDrawer, wishlist, wishlistLoading,
        addToCart, updateCartQuantity, removeFromCart, clearCart,
        toggleWishlist, isWished, moveToCart, claimGuestActivity, refreshCart,
      }}
    >
      {children}
    </Ctx.Provider>
  );
}

export function useShop() {
  const ctx = useContext(Ctx);
  if (!ctx) throw new Error("useShop outside ShopProvider");
  return ctx;
}

export { ShopApiError };
