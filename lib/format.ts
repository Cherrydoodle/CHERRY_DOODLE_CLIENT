export function formatMoney(amountCents: number, currency: string) {
  return new Intl.NumberFormat(currency === "INR" ? "en-IN" : "en-US", { style: "currency", currency }).format(amountCents / 100);
}
