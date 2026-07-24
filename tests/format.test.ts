import { describe, expect, it } from "vitest";

import { formatMoney } from "@/lib/format";

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
