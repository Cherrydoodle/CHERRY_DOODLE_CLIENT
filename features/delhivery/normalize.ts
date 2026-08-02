// Pure string normalizers for Delhivery's strict field formats. Neither function
// throws: callers decide whether a null result is a validation error or simply
// "not applicable" (e.g. a non-Indian address).

/** "110 001" / "110001" -> "110001". Rejects anything not a 6-digit Indian PIN
 * (Delhivery pincodes never start with 0). */
export function normalizeIndianPin(value: string | null | undefined): string | null {
  if (!value) return null;
  const digits = value.replace(/[^0-9]/g, "");
  return /^[1-9][0-9]{5}$/.test(digits) ? digits : null;
}

/** "+91 98765 43210" / "098765 43210" -> "9876543210". Delhivery wants a bare
 * 10-digit mobile number, not the +91/leading-0 forms customers commonly enter. */
export function normalizeIndianPhone(value: string | null | undefined): string | null {
  if (!value) return null;
  let digits = value.replace(/[^0-9]/g, "");
  if (digits.length === 12 && digits.startsWith("91")) digits = digits.slice(2);
  else if (digits.length === 11 && digits.startsWith("0")) digits = digits.slice(1);
  return /^[6-9][0-9]{9}$/.test(digits) ? digits : null;
}
