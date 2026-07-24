// Single source of truth for the site's policy/information links. Both the footer
// and the RZ-020 route-coverage test import this, so a missing mandatory policy
// page is caught by a unit test rather than in Razorpay review.

export type SiteLink = { href: string; label: string };

// The six pages Razorpay requires for account approval, plus FAQ.
export const POLICY_LINKS: readonly SiteLink[] = [
  { href: "/about", label: "About Us" },
  { href: "/contact", label: "Contact Us" },
  { href: "/shipping", label: "Shipping & Delivery" },
  { href: "/refund", label: "Cancellation & Refund" },
  { href: "/terms", label: "Terms & Conditions" },
  { href: "/privacy", label: "Privacy Policy" },
  { href: "/faq", label: "FAQ" },
] as const;

// Mandatory-for-approval subset (excludes the optional FAQ).
export const MANDATORY_POLICY_HREFS: readonly string[] = [
  "/about",
  "/contact",
  "/shipping",
  "/refund",
  "/terms",
  "/privacy",
] as const;
