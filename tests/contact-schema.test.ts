import { describe, expect, it } from "vitest";

import { contactSchema } from "@/features/contact/schemas";
import { MANDATORY_POLICY_HREFS, POLICY_LINKS } from "@/components/site-links";

const valid = {
  name: "Aisha K",
  email: "Aisha@Example.com",
  subject: "Where is my order?",
  message: "Hi, I placed an order yesterday and wanted to check the status.",
};

describe("contactSchema", () => {
  it("accepts a well-formed message and normalizes the email", () => {
    const parsed = contactSchema.parse(valid);
    expect(parsed.email).toBe("aisha@example.com");
  });

  it("rejects a message shorter than 10 characters", () => {
    expect(() => contactSchema.parse({ ...valid, message: "hi" })).toThrow();
  });

  it("rejects an invalid email", () => {
    expect(() => contactSchema.parse({ ...valid, email: "not-an-email" })).toThrow();
  });

  it("rejects unknown fields (strict)", () => {
    expect(() => contactSchema.parse({ ...valid, role: "admin" })).toThrow();
  });

  it("treats a filled honeypot as valid input (handled as a bot at the route)", () => {
    expect(() => contactSchema.parse({ ...valid, company: "" })).not.toThrow();
    // Non-empty company violates max(0) and is rejected by the schema.
    expect(() => contactSchema.parse({ ...valid, company: "spam" })).toThrow();
  });
});

describe("site policy links", () => {
  it("exposes every Razorpay-mandatory policy page in the footer link set", () => {
    const hrefs = POLICY_LINKS.map((link) => link.href);
    for (const required of MANDATORY_POLICY_HREFS) {
      expect(hrefs).toContain(required);
    }
  });

  it("covers all six mandatory approval routes", () => {
    expect(MANDATORY_POLICY_HREFS).toHaveLength(6);
    expect(new Set(MANDATORY_POLICY_HREFS)).toEqual(
      new Set(["/about", "/contact", "/shipping", "/refund", "/terms", "/privacy"]),
    );
  });
});
