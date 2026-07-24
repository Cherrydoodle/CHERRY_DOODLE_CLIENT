import { describe, expect, it } from "vitest";

import { announcementCreateSchema, bannerCreateSchema, colorCreateSchema, orderUpdateSchema, passwordChangeSchema, reelCreateSchema, storeSettingsUpdateSchema } from "@/features/admin-operations/schemas";

describe("order tracking updates", () => {
  it("accepts a tracking-only update with no status or note", () => {
    expect(orderUpdateSchema.safeParse({ carrier: "Delhivery", trackingNumber: "DL123456789", expectedVersion: 1 }).success).toBe(true);
  });

  it("rejects an update with no status, note, or tracking fields", () => {
    expect(orderUpdateSchema.safeParse({ expectedVersion: 1 }).success).toBe(false);
  });

  it("rejects an invalid tracking URL", () => {
    expect(orderUpdateSchema.safeParse({ trackingUrl: "not-a-url", expectedVersion: 1 }).success).toBe(false);
  });

  it("allows clearing tracking fields with null", () => {
    expect(orderUpdateSchema.safeParse({ carrier: null, trackingNumber: null, expectedVersion: 1 }).success).toBe(true);
  });
});

describe("admin operation contracts", () => {
  it("accepts a versioned order transition", () => {
    expect(orderUpdateSchema.parse({ status: "processing", statusReason: "Production started", expectedVersion: 2 })).toEqual({ status: "processing", statusReason: "Production started", expectedVersion: 2 });
  });

  it("requires a meaningful order mutation", () => {
    expect(orderUpdateSchema.safeParse({ expectedVersion: 1 }).success).toBe(false);
    expect(orderUpdateSchema.safeParse({ statusReason: "Missing status", expectedVersion: 1 }).success).toBe(false);
  });

  it("rejects external banner links", () => {
    const input = { title: "Sale", subtitle: "Today", buttonText: "Shop", buttonLink: "https://evil.example", imageMediaId: crypto.randomUUID() };
    expect(bannerCreateSchema.safeParse(input).success).toBe(false);
    expect(bannerCreateSchema.safeParse({ ...input, buttonLink: "/sale" }).success).toBe(true);
  });

  it("validates settings concurrency and currency", () => {
    expect(storeSettingsUpdateSchema.safeParse({ defaultCurrency: "INR", expectedVersion: 1 }).success).toBe(true);
    expect(storeSettingsUpdateSchema.safeParse({ defaultCurrency: "usd", expectedVersion: 1 }).success).toBe(false);
  });

  it("accepts a valid Instagram URL and clearing it, but rejects non-Instagram links", () => {
    expect(storeSettingsUpdateSchema.safeParse({ instagramUrl: "https://www.instagram.com/cherry__doodle", expectedVersion: 1 }).success).toBe(true);
    expect(storeSettingsUpdateSchema.safeParse({ instagramUrl: null, expectedVersion: 1 }).success).toBe(true);
    expect(storeSettingsUpdateSchema.safeParse({ instagramUrl: "https://evil.example/cherry", expectedVersion: 1 }).success).toBe(false);
  });

  it("only accepts genuine Instagram reel/post URLs", () => {
    expect(reelCreateSchema.safeParse({ reelUrl: "https://www.instagram.com/reel/ABC123/" }).success).toBe(true);
    expect(reelCreateSchema.safeParse({ reelUrl: "https://instagram.com/p/XyZ_9-8/", caption: "New drop" }).success).toBe(true);
    expect(reelCreateSchema.safeParse({ reelUrl: "https://www.instagram.com/cherry__doodle" }).success).toBe(false);
    expect(reelCreateSchema.safeParse({ reelUrl: "https://evil.example/reel/ABC123" }).success).toBe(false);
  });

  it("requires a distinct twelve-character password", () => {
    expect(passwordChangeSchema.safeParse({ currentPassword: "old-password", newPassword: "new-password-123" }).success).toBe(true);
    expect(passwordChangeSchema.safeParse({ currentPassword: "same-password", newPassword: "same-password" }).success).toBe(false);
  });

  it("requires marquee text and rejects external links", () => {
    expect(announcementCreateSchema.safeParse({ text: "" }).success).toBe(false);
    expect(announcementCreateSchema.safeParse({ text: "Free shipping" }).success).toBe(true);
    expect(announcementCreateSchema.safeParse({ text: "Sale", link: "https://evil.example" }).success).toBe(false);
    expect(announcementCreateSchema.safeParse({ text: "Sale", link: "/category/sale" }).success).toBe(true);
  });

  it("requires a valid six-digit hex color", () => {
    expect(colorCreateSchema.safeParse({ name: "Peach Cream", hex: "#F8B4C4" }).success).toBe(true);
    expect(colorCreateSchema.safeParse({ name: "Peach Cream", hex: "F8B4C4" }).success).toBe(false);
    expect(colorCreateSchema.safeParse({ name: "Peach Cream", hex: "#ZZZZZZ" }).success).toBe(false);
  });
});
