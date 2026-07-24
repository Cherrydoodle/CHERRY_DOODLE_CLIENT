import { describe, expect, it } from "vitest";

import { parseProductFilters } from "@/features/catalog/schemas";
import { createUploadSchema } from "@/features/media/schemas";
import { subscribeSchema } from "@/features/newsletter/schemas";

describe("public request validation", () => {
  it("parses bounded catalog filters", () => {
    const filters = parseProductFilters(new URL("https://shop.example/api/v1/products?category=paper-goods&sale=true&limit=12&priceMaxCents=2500"));
    expect(filters).toMatchObject({ category: "paper-goods", sale: true, limit: 12, priceMaxCents: 2500, sort: "featured" });
  });

  it("rejects invalid booleans and excessive limits", () => {
    expect(() => parseProductFilters(new URL("https://shop.example/api/v1/products?sale=yes"))).toThrow();
    expect(() => parseProductFilters(new URL("https://shop.example/api/v1/products?limit=101"))).toThrow();
  });

  it("normalizes newsletter emails and blocks bot honeypot values", () => {
    expect(subscribeSchema.parse({ email: "  HELLO@example.com " }).email).toBe("hello@example.com");
    expect(subscribeSchema.safeParse({ email: "hello@example.com", company: "spam" }).success).toBe(false);
  });

  it("requires accessible alt text for product uploads", () => {
    const upload = { purpose: "product", filename: "pen.webp", mimeType: "image/webp", byteSize: 500_000, altText: "" };
    expect(createUploadSchema.safeParse(upload).success).toBe(false);
    expect(createUploadSchema.safeParse({ ...upload, purpose: "content" }).success).toBe(true);
  });
});
