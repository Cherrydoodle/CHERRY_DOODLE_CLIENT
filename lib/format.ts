export function formatMoney(amountCents: number, currency: string) {
  return new Intl.NumberFormat(currency === "INR" ? "en-IN" : "en-US", { style: "currency", currency }).format(amountCents / 100);
}

/** "Ends 4 Aug" for an offer/campaign end date, or null when there's no deadline. */
export function formatEndsDate(endsAt: string | null) {
  if (!endsAt) return null;
  return `Ends ${new Intl.DateTimeFormat("en-IN", { day: "numeric", month: "short" }).format(new Date(endsAt))}`;
}

// Most variants are still color-only, where label and color name are identical
// (backfilled by the label migration) -- showing both would read as "Cherry · Cherry".
// Only append the color when it adds information beyond the label itself.
export function variantOptionLabel(variant: { label: string; color: { name: string } }) {
  return variant.label.trim().toLowerCase() === variant.color.name.trim().toLowerCase()
    ? variant.label
    : `${variant.label} · ${variant.color.name}`;
}
