"use client";

import Image from "next/image";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { Heart, ShoppingBag, Search, UserRound } from "lucide-react";
import { useEffect, useRef, useState, type FormEvent } from "react";

import { useShop } from "@/lib/store";
import type { CategoryDTO, ImageDTO, MarqueeItemDTO } from "@/features/catalog/types";

const DEFAULT_MARQUEE: MarqueeItemDTO[] = [
  { id: "default-1", text: "🌸 Free shipping across India on eligible orders", link: null },
  { id: "default-2", text: "💌 New Arrivals just dropped", link: null },
  { id: "default-3", text: "🎀 Sale — up to 30% off", link: null },
  { id: "default-4", text: "✨ Cute Korean stationery, every week", link: null },
];

export function Header({ categories, marquee, storeName, logo }: { categories: CategoryDTO[]; marquee: MarqueeItemDTO[]; storeName: string; logo: ImageDTO | null }) {
  const { cart, wishlist } = useShop();
  const [query, setQuery] = useState("");
  const router = useRouter();
  const pathname = usePathname();

  const cartCount = cart.summary.itemCount;
  const [cartBounce, setCartBounce] = useState(false);
  const prevCartCount = useRef(cartCount);

  useEffect(() => {
    if (cartCount > prevCartCount.current) {
      setCartBounce(true);
      const timeout = window.setTimeout(() => setCartBounce(false), 400);
      prevCartCount.current = cartCount;
      return () => window.clearTimeout(timeout);
    }
    prevCartCount.current = cartCount;
  }, [cartCount]);

  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (query.trim()) {
      router.push(`/search?q=${encodeURIComponent(query.trim())}`);
    }
  };

  return (
    <header className="sticky top-0 z-40 bg-background/85 backdrop-blur border-b border-border/70">
      <MarqueeStrip items={marquee.length > 0 ? marquee : DEFAULT_MARQUEE} />

      <div className="mx-auto max-w-7xl px-4 sm:px-6 py-4 grid grid-cols-[1fr_auto] md:grid-cols-[auto_1fr_auto] items-center gap-4">
        <Link href="/" className="flex items-center justify-self-start" aria-label={storeName}>
          {logo ? (
            <Image src={logo.urls.detail} alt={logo.alt || storeName} width={logo.width} height={logo.height} className="h-12 w-auto object-contain sm:h-16" priority />
          ) : (
            <span className="font-display text-2xl sm:text-3xl font-black text-primary tracking-tight">
              cherry<span className="text-cherry">·</span>doodle
            </span>
          )}
        </Link>

        <div className="hidden md:flex flex-1 max-w-xl mx-6">
          <form onSubmit={submit} role="search" className="flex w-full items-center gap-2 bg-muted rounded-full px-4 py-2.5 border border-border/60 focus-within:border-primary transition">
            <Search className="h-4 w-4 text-muted-foreground" />
            <label htmlFor="desktop-site-search" className="sr-only">Search products</label>
            <input
              id="desktop-site-search"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Search pens, stickers, notebooks…"
              className="bg-transparent outline-none w-full text-sm placeholder:text-muted-foreground"
            />
          </form>
        </div>

        <div className="flex items-center gap-1 sm:gap-2 justify-self-end">
          <Link href="/search" className="md:hidden h-10 w-10 grid place-items-center rounded-full hover:bg-blush" aria-label="Search">
            <Search className="h-5 w-5" />
          </Link>
          <Link href="/wishlist" className="relative h-10 w-10 grid place-items-center rounded-full hover:bg-blush" aria-label="Wishlist">
            <Heart className="h-5 w-5" />
            {wishlist.length > 0 && (
              <span className="absolute -top-0.5 -right-0.5 bg-cherry text-white text-[10px] font-bold rounded-full h-5 w-5 grid place-items-center">
                {wishlist.length}
              </span>
            )}
          </Link>
          <Link href="/account" className="hidden sm:grid h-10 w-10 place-items-center rounded-full hover:bg-blush" aria-label="Account">
            <UserRound className="h-5 w-5" />
          </Link>
          <Link href="/cart" className="relative h-10 w-10 grid place-items-center rounded-full hover:bg-blush" aria-label="Cart">
            <ShoppingBag className={`h-5 w-5 ${cartBounce ? "animate-cart-bounce" : ""}`} />
            {cartCount > 0 && (
              <span className="absolute -top-0.5 -right-0.5 bg-cherry text-white text-[10px] font-bold rounded-full h-5 w-5 grid place-items-center">
                {cartCount}
              </span>
            )}
          </Link>
        </div>
      </div>

      <nav aria-label="Primary navigation" className="hidden md:flex mx-auto max-w-7xl px-6 pb-3 gap-6 text-sm font-semibold">
        <Link href="/" className={`hover:text-primary transition ${pathname === "/" ? "text-primary" : ""}`}>Home</Link>
        <Link href="/collections/all" className={`hover:text-primary transition ${pathname.startsWith("/collections/all") ? "text-primary" : ""}`}>Shop All</Link>
        {categories.map((category) => {
          const href = `/category/${category.slug}`;
          return (
            <Link key={category.slug} href={href} className={`hover:text-primary transition ${pathname.startsWith(href) ? "text-primary" : ""}`}>
              {category.name}
            </Link>
          );
        })}
        <Link href="/category/writing-tools?sale=true" className="ml-auto text-sale">Sale ♡</Link>
      </nav>
    </header>
  );
}

function MarqueeStrip({ items }: { items: MarqueeItemDTO[] }) {
  const row = (copy: number) => (
    <div className="flex shrink-0 gap-10 px-6" aria-hidden={copy === 1}>
      {items.map((item) => (
        <span key={`${copy}-${item.id}`}>
          {item.link ? <Link href={item.link} className="hover:underline">{item.text}</Link> : item.text}
        </span>
      ))}
    </div>
  );
  return (
    <div className="bg-primary text-primary-foreground text-xs sm:text-sm py-2 overflow-hidden">
      <div className="flex whitespace-nowrap animate-marquee">
        {row(0)}
        {row(1)}
      </div>
    </div>
  );
}
