import { describe, expect, it } from "vitest";

import { normalizeIndianPhone, normalizeIndianPin } from "@/features/delhivery/normalize";

describe("normalizeIndianPin", () => {
  it("accepts a plain 6-digit pin", () => {
    expect(normalizeIndianPin("110001")).toBe("110001");
  });

  it("strips spaces and dashes", () => {
    expect(normalizeIndianPin("110 001")).toBe("110001");
    expect(normalizeIndianPin("110-001")).toBe("110001");
  });

  it("rejects a pin starting with 0, wrong length, or non-numeric input", () => {
    expect(normalizeIndianPin("011000")).toBeNull();
    expect(normalizeIndianPin("11000")).toBeNull();
    expect(normalizeIndianPin("1100011")).toBeNull();
    expect(normalizeIndianPin("abcdef")).toBeNull();
  });

  it("returns null for empty or missing input", () => {
    expect(normalizeIndianPin("")).toBeNull();
    expect(normalizeIndianPin(null)).toBeNull();
    expect(normalizeIndianPin(undefined)).toBeNull();
  });
});

describe("normalizeIndianPhone", () => {
  it("accepts a bare 10-digit mobile number", () => {
    expect(normalizeIndianPhone("9876543210")).toBe("9876543210");
  });

  it("strips a +91 country code and spaces", () => {
    expect(normalizeIndianPhone("+91 98765 43210")).toBe("9876543210");
    expect(normalizeIndianPhone("91-98765-43210")).toBe("9876543210");
  });

  it("strips a leading 0", () => {
    expect(normalizeIndianPhone("098765 43210")).toBe("9876543210");
  });

  it("rejects a landline-shaped or malformed number", () => {
    expect(normalizeIndianPhone("1234567890")).toBeNull(); // must start 6-9
    expect(normalizeIndianPhone("12345")).toBeNull();
    expect(normalizeIndianPhone("abcdefghij")).toBeNull();
  });

  it("returns null for empty or missing input", () => {
    expect(normalizeIndianPhone("")).toBeNull();
    expect(normalizeIndianPhone(null)).toBeNull();
    expect(normalizeIndianPhone(undefined)).toBeNull();
  });
});
