"use client";

import Link from "next/link";
import { Instagram, MessageCircle } from "lucide-react";
import { useState, type FormEvent } from "react";

import { POLICY_LINKS } from "@/components/site-links";
import type { CategoryDTO } from "@/features/catalog/types";

export type FooterIdentity = { email: string; phone: string; address: string; instagram: string | null };

export function Footer({ categories, identity }: { categories: CategoryDTO[]; identity: FooterIdentity }) {
  const [status, setStatus] = useState<"idle" | "submitting" | "accepted" | "error">("idle");
  const whatsappDigits = identity.phone.replace(/\D/g, "");

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const form = event.currentTarget;
    const values = new FormData(form);
    setStatus("submitting");
    try {
      const response = await fetch("/api/v1/newsletter/subscriptions", {
        method: "POST",
        headers: { "content-type": "application/json", "idempotency-key": crypto.randomUUID() },
        body: JSON.stringify({ email: values.get("email"), company: values.get("company") || undefined, source: "footer" }),
      });
      if (!response.ok) throw new Error("Newsletter signup failed");
      form.reset();
      setStatus("accepted");
    } catch {
      setStatus("error");
    }
  };

  return (
    <footer className="mt-20 bg-blush/60 border-t border-border">
      <div className="mx-auto max-w-7xl px-6 py-14 grid gap-10 md:grid-cols-4">
        <div>
          <div className="font-display text-2xl font-black text-primary">cherry·doodle</div>
          <p className="mt-3 text-sm text-muted-foreground max-w-xs">
            Cute Korean stationery made for everyday joy. Journaling, studying, gifting — all in soft pink.
          </p>
        </div>
        <div>
          <div className="font-bold mb-3">Shop</div>
          <ul className="space-y-2 text-sm text-muted-foreground">
            <li>
              <Link href="/collections/all" className="hover:text-primary font-semibold">Shop All</Link>
            </li>
            {categories.map((category) => (
              <li key={category.slug}>
                <Link href={`/category/${category.slug}`} className="hover:text-primary">{category.name}</Link>
              </li>
            ))}
          </ul>
        </div>
        <div>
          <div className="font-bold mb-3">Help &amp; Policies</div>
          <ul className="space-y-2 text-sm text-muted-foreground">
            {POLICY_LINKS.map((link) => (
              <li key={link.href}>
                <Link href={link.href} className="hover:text-primary">{link.label}</Link>
              </li>
            ))}
          </ul>
          <div className="mt-4 space-y-1 text-sm text-muted-foreground">
            <p className="not-italic">{identity.address}</p>
            <a href={`mailto:${identity.email}`} className="block hover:text-primary">{identity.email}</a>
            <a href={`tel:${identity.phone.replace(/\s+/g, "")}`} className="block hover:text-primary">{identity.phone}</a>
            {whatsappDigits && (
              <a href={`https://wa.me/${whatsappDigits}`} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1.5 hover:text-primary">
                <MessageCircle className="h-4 w-4" aria-hidden="true" /> WhatsApp us
              </a>
            )}
          </div>
          {identity.instagram && (
            <a href={identity.instagram} target="_blank" rel="noopener noreferrer" aria-label="Cherry Doodle on Instagram" className="mt-4 inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-primary">
              <Instagram className="h-4 w-4" aria-hidden="true" /> Instagram
            </a>
          )}
        </div>
        <div>
          <div className="font-bold mb-3">Stay in the loop</div>
          <p className="text-sm text-muted-foreground mb-3">Sweet drops, restocks, and pink surprises.</p>
          <form className="flex gap-2" onSubmit={submit}>
            <label htmlFor="newsletter-email" className="sr-only">Email address</label>
            <input id="newsletter-email" name="email" type="email" autoComplete="email" required maxLength={254} placeholder="you@cutemail.com" className="min-w-0 flex-1 bg-white rounded-full px-4 py-2 text-sm border border-border outline-none focus:border-primary" />
            <input name="company" tabIndex={-1} autoComplete="off" className="hidden" aria-hidden="true" />
            <button type="submit" disabled={status === "submitting"} className="btn-primary text-sm px-5 py-2 disabled:opacity-60">
              {status === "submitting" ? "Joining…" : "Join"}
            </button>
          </form>
          <p className="mt-2 text-xs text-muted-foreground" aria-live="polite">
            {status === "accepted" && "Check your inbox to confirm your subscription."}
            {status === "error" && "We could not sign you up just now. Please try again."}
          </p>
        </div>
      </div>
      <div className="border-t border-border/70 py-4 text-center text-xs text-muted-foreground">
        © {new Date().getFullYear()} Cherry Doodle. Made with 🍓 in India.
      </div>
    </footer>
  );
}
