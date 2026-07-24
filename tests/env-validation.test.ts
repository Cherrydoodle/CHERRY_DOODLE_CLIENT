import { afterEach, describe, expect, it } from "vitest";

import { assertServerEnv, ConfigurationError } from "@/lib/env.server";

const originalEnv = { ...process.env };

afterEach(() => {
  process.env = { ...originalEnv };
});

// A fully valid production-grade environment. Secrets are 64-char hex strings so
// they satisfy both the minimum-length and no-placeholder rules.
const SECRET_A = "a1b2c3d4e5f60718293a4b5c6d7e8f90a1b2c3d4e5f60718293a4b5c6d7e8f90";
const SECRET_B = "0f9e8d7c6b5a493827160f9e8d7c6b5a493827160f9e8d7c6b5a4938271600f9e";
const SECRET_C = "112233445566778899aabbccddeeff00112233445566778899aabbccddeeff00";
const SECRET_D = "ffeeddccbbaa00998877665544332211ffeeddccbbaa00998877665544332211";
const SECRET_E = "1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef";

function configureValidEnv() {
  process.env = {
    ...originalEnv,
    NODE_ENV: "production",
    NEXT_PUBLIC_SITE_URL: "https://cherrydoodle.in",
    NEXT_PUBLIC_SUPABASE_URL: "https://cherrydoodleproj.supabase.co",
    NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: `sb_publishable_${SECRET_A}`,
    SUPABASE_SECRET_KEY: `sb_secret_${SECRET_B}`,
    CLOUDINARY_CLOUD_NAME: "cherry-doodle",
    CLOUDINARY_API_KEY: "123456789012345",
    CLOUDINARY_API_SECRET: SECRET_C,
    CLOUDINARY_PRIVATE_READ_URL_TTL_SECONDS: "900",
    RAZORPAY_MODE: "test",
    RAZORPAY_KEY_ID: "rzp_test_ABCDEF1234567890",
    RAZORPAY_KEY_SECRET: SECRET_D,
    RAZORPAY_WEBHOOK_SECRET: SECRET_E,
    GUEST_CART_TOKEN_PEPPER: SECRET_A,
    APP_HMAC_SECRET: SECRET_B,
    CRON_SECRET: SECRET_C,
    UPSTASH_REDIS_REST_URL: "https://us1-cherry.upstash.io",
    UPSTASH_REDIS_REST_TOKEN: SECRET_D,
  } as NodeJS.ProcessEnv;
}

describe("assertServerEnv", () => {
  it("passes with a complete, well-formed production environment", () => {
    configureValidEnv();
    expect(() => assertServerEnv({ production: true })).not.toThrow();
  });

  it("throws ConfigurationError when a required secret is missing", () => {
    configureValidEnv();
    delete process.env.APP_HMAC_SECRET;
    expect(() => assertServerEnv({ production: true })).toThrow(ConfigurationError);
    expect(() => assertServerEnv({ production: true })).toThrow(/APP_HMAC_SECRET/);
  });

  it("rejects placeholder secret values in production", () => {
    configureValidEnv();
    process.env.RAZORPAY_WEBHOOK_SECRET = "replace_with_dashboard_test_webhook_secret";
    expect(() => assertServerEnv({ production: true })).toThrow(/RAZORPAY_WEBHOOK_SECRET/);
  });

  it("rejects the example.com production domain as a placeholder", () => {
    configureValidEnv();
    process.env.NEXT_PUBLIC_SITE_URL = "https://example.com";
    expect(() => assertServerEnv({ production: true })).toThrow(/NEXT_PUBLIC_SITE_URL/);
  });

  it("requires https for the production site URL", () => {
    configureValidEnv();
    process.env.NEXT_PUBLIC_SITE_URL = "http://cherrydoodle.in";
    expect(() => assertServerEnv({ production: true })).toThrow(/NEXT_PUBLIC_SITE_URL/);
  });

  it("rejects high-entropy secrets shorter than 32 characters", () => {
    configureValidEnv();
    process.env.APP_HMAC_SECRET = "tooshort";
    expect(() => assertServerEnv({ production: true })).toThrow(/APP_HMAC_SECRET/);
  });

  it("requires distributed rate limiting in production", () => {
    configureValidEnv();
    delete process.env.UPSTASH_REDIS_REST_URL;
    delete process.env.UPSTASH_REDIS_REST_TOKEN;
    expect(() => assertServerEnv({ production: true })).toThrow(/UPSTASH/);
  });

  it("aggregates every problem into a single error message", () => {
    configureValidEnv();
    delete process.env.APP_HMAC_SECRET;
    delete process.env.CRON_SECRET;
    process.env.NEXT_PUBLIC_SITE_URL = "https://example.com";
    let message = "";
    try {
      assertServerEnv({ production: true });
    } catch (error) {
      message = (error as Error).message;
    }
    expect(message).toMatch(/APP_HMAC_SECRET/);
    expect(message).toMatch(/CRON_SECRET/);
    expect(message).toMatch(/NEXT_PUBLIC_SITE_URL/);
  });

  it("register() boot hook rejects a misconfigured production environment", async () => {
    configureValidEnv(); // sets NODE_ENV=production
    process.env.NEXT_RUNTIME = "nodejs";
    delete process.env.NEXT_PHASE;
    delete process.env.RAZORPAY_WEBHOOK_SECRET;
    const { register } = await import("@/instrumentation");
    await expect(register()).rejects.toThrow(/RAZORPAY_WEBHOOK_SECRET/);
  });

  it("register() is a no-op during the production build phase", async () => {
    process.env = {
      NEXT_RUNTIME: "nodejs",
      NEXT_PHASE: "phase-production-build",
    } as unknown as NodeJS.ProcessEnv;
    const { register } = await import("@/instrumentation");
    await expect(register()).resolves.toBeUndefined();
  });

  it("does not require Upstash outside production", () => {
    configureValidEnv();
    delete process.env.UPSTASH_REDIS_REST_URL;
    delete process.env.UPSTASH_REDIS_REST_TOKEN;
    expect(() => assertServerEnv({ production: false })).not.toThrow();
  });

  it("tolerates placeholder-shaped values outside production but still enforces presence", () => {
    configureValidEnv();
    // A long placeholder passes length; production would flag the token, dev does not.
    process.env.SUPABASE_SECRET_KEY = "sb_secret_your-project-ref-placeholder-value-1234567890";
    expect(() => assertServerEnv({ production: false })).not.toThrow();
    expect(() => assertServerEnv({ production: true })).toThrow(/SUPABASE_SECRET_KEY/);
  });
});
