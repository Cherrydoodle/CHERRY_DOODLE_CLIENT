import { describe, expect, it } from "vitest";

import { registerSchema, resetPasswordSchema, safeNextPath } from "@/features/auth/schemas";

describe("authentication validation", () => {
  it("normalizes valid registration input", () => {
    const result = registerSchema.parse({
      displayName: "  Mina Kim  ",
      email: "  MINA@example.com ",
      password: "Stationery2026",
    });

    expect(result).toMatchObject({ displayName: "Mina Kim", email: "mina@example.com", marketingConsent: false });
  });

  it("rejects weak and mismatched passwords", () => {
    expect(registerSchema.safeParse({ displayName: "Mina", email: "mina@example.com", password: "allletterslong" }).success).toBe(false);
    expect(registerSchema.safeParse({ displayName: "Mina", email: "mina@example.com", password: "stationery2026" }).success).toBe(false);
    expect(resetPasswordSchema.safeParse({ password: "Stationery2026", confirmPassword: "Stationery2027" }).success).toBe(false);
  });

  it("allows only same-site relative post-login paths", () => {
    expect(safeNextPath("/account?tab=profile")).toBe("/account?tab=profile");
    expect(safeNextPath("https://evil.example/collect")).toBe("/account");
    expect(safeNextPath("//evil.example/collect")).toBe("/account");
    expect(safeNextPath("/\\evil.example")).toBe("/account");
  });
});
