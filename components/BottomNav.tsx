"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Home, UserRound, Heart, ShoppingBag, LayoutGrid } from "lucide-react";

import { useShop } from "@/lib/store";

const navItems = [
  { href: "/", label: "Home", icon: Home, exact: true },
  { href: "/collections/all", label: "Shop", icon: LayoutGrid },
  { href: "/wishlist", label: "Saved", icon: Heart, badge: "wish" as const },
  { href: "/cart", label: "Bag", icon: ShoppingBag, badge: "cart" as const },
  { href: "/account", label: "Account", icon: UserRound },
];

export function BottomNav() {
  const pathname = usePathname();
  const { cart, wishlist } = useShop();
  const cartCount = cart.summary.itemCount;

  return (
    <nav className="fixed bottom-0 left-0 right-0 z-50 border-t border-border/60 bg-background/95 backdrop-blur-md md:hidden" aria-label="Mobile navigation">
      <div className="flex items-center justify-around px-2 py-2 pb-[env(safe-area-inset-bottom)]">
        {navItems.map(({ href, label, icon: Icon, exact, badge }) => {
          const isActive = exact ? pathname === href : pathname.startsWith(href) && href !== "/";
          const count = badge === "cart" ? cartCount : badge === "wish" ? wishlist.length : 0;

          return (
            <Link
              key={href}
              href={href}
              aria-current={isActive ? "page" : undefined}
              className={`relative flex flex-col items-center gap-0.5 px-3 py-1.5 rounded-2xl transition-all ${
                isActive ? "text-primary" : "text-muted-foreground hover:text-foreground"
              }`}
            >
              {isActive && <span className="absolute inset-0 rounded-2xl bg-primary/10" />}
              <div className="relative">
                <Icon className={`h-5 w-5 transition-all ${isActive ? "scale-110" : ""}`} strokeWidth={isActive ? 2.5 : 2} />
                {count > 0 && (
                  <span className="absolute -right-1.5 -top-1.5 grid h-4 min-w-4 place-items-center rounded-full bg-cherry px-0.5 text-[9px] font-bold text-white">
                    {count > 9 ? "9+" : count}
                  </span>
                )}
              </div>
              <span className={`text-[10px] font-semibold leading-none ${isActive ? "text-primary" : ""}`}>{label}</span>
            </Link>
          );
        })}
      </div>
    </nav>
  );
}
