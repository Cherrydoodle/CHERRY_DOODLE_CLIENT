import { describe, expect, it } from "vitest";

import { formatMoney, variantOptionLabel } from "@/lib/format";

describe("formatMoney", () => {
  it("formats INR minor units with the rupee symbol and en-IN grouping", () => {
    const formatted = formatMoney(116200, "INR");
    expect(formatted).toContain("₹");
    expect(formatted).toContain("1,162");
    expect(formatted).not.toContain("$");
  });

  it("renders paise as two decimals", () => {
    expect(formatMoney(49800, "INR")).toBe("₹498.00");
  });

  it("still supports other currencies for safety", () => {
    expect(formatMoney(1000, "USD")).toContain("$");
  });
});

describe("variantOptionLabel", () => {
  it("returns just the label for a name-only (colorless) variant", () => {
    expect(variantOptionLabel({ label: "Galaxy Theme", color: null })).toBe("Galaxy Theme");
  });

  it("suppresses a redundant color name that duplicates the label", () => {
    expect(variantOptionLabel({ label: "Cherry", color: { name: "Cherry" } })).toBe("Cherry");
  });

  it("appends the color name when it adds information beyond the label", () => {
    expect(variantOptionLabel({ label: "Galaxy Theme", color: { name: "Cherry" } })).toBe("Galaxy Theme · Cherry");
  });
});
