import "server-only";

import { getPublicSupabaseConfig } from "@/lib/public-env";

export class ConfigurationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ConfigurationError";
  }
}

export function requireSupabaseServerConfig() {
  const publicConfig = getPublicSupabaseConfig();
  const secretKey = process.env.SUPABASE_SECRET_KEY?.trim();

  if (!publicConfig || !secretKey) {
    throw new ConfigurationError(
      "Supabase is not configured. Set NEXT_PUBLIC_SUPABASE_URL, NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY, and SUPABASE_SECRET_KEY.",
    );
  }

  return { ...publicConfig, secretKey };
}

export function requireApplicationSecrets() {
  const guestCartPepper = process.env.GUEST_CART_TOKEN_PEPPER?.trim();
  const hmacSecret = requireHmacSecret();
  if (!guestCartPepper || !hmacSecret) {
    throw new ConfigurationError("GUEST_CART_TOKEN_PEPPER and APP_HMAC_SECRET are required for persistent mutations.");
  }
  return { guestCartPepper, hmacSecret };
}

export function requireHmacSecret() {
  const hmacSecret = process.env.APP_HMAC_SECRET?.trim();
  if (!hmacSecret) throw new ConfigurationError("APP_HMAC_SECRET is required for request integrity controls.");
  return hmacSecret;
}

export function requireCloudinaryConfig() {
  const cloudName = process.env.CLOUDINARY_CLOUD_NAME?.trim();
  const apiKey = process.env.CLOUDINARY_API_KEY?.trim();
  const apiSecret = process.env.CLOUDINARY_API_SECRET?.trim();
  if (!cloudName || !apiKey || !apiSecret) {
    throw new ConfigurationError(
      "Cloudinary is not configured. Set CLOUDINARY_CLOUD_NAME, CLOUDINARY_API_KEY, and CLOUDINARY_API_SECRET.",
    );
  }
  if (!/^[A-Za-z0-9_-]+$/.test(cloudName)) throw new ConfigurationError("CLOUDINARY_CLOUD_NAME has an invalid format.");
  return {
    cloudName,
    apiKey,
    apiSecret,
    privateReadTtlSeconds: parseCloudinaryTtl(process.env.CLOUDINARY_PRIVATE_READ_URL_TTL_SECONDS),
  };
}

function parseCloudinaryTtl(value: string | undefined) {
  const parsed = value === undefined || value.trim() === "" ? 900 : Number(value);
  if (!Number.isInteger(parsed) || parsed < 60 || parsed > 3600) {
    throw new ConfigurationError("CLOUDINARY_PRIVATE_READ_URL_TTL_SECONDS must be an integer between 60 and 3600 seconds.");
  }
  return parsed;
}

export function requireRazorpayConfig() {
  const keyId = process.env.RAZORPAY_KEY_ID?.trim();
  const keySecret = process.env.RAZORPAY_KEY_SECRET?.trim();
  const mode = process.env.RAZORPAY_MODE?.trim() || "test";

  if (!keyId || !keySecret) {
    throw new ConfigurationError("Razorpay is not configured. Set RAZORPAY_KEY_ID and RAZORPAY_KEY_SECRET.");
  }
  if (mode !== "test" && mode !== "live") throw new ConfigurationError("RAZORPAY_MODE must be either test or live.");
  if (!/^rzp_(test|live)_[A-Za-z0-9]+$/.test(keyId)) throw new ConfigurationError("RAZORPAY_KEY_ID has an invalid format.");
  if (mode === "test" && !keyId.startsWith("rzp_test_")) throw new ConfigurationError("Test mode requires a Razorpay test key.");
  if (mode === "live" && !keyId.startsWith("rzp_live_")) throw new ConfigurationError("Live mode requires a Razorpay live key.");

  return { keyId, keySecret, mode } as const;
}

/**
 * The webhook signing secret, plus an optional outgoing one.
 *
 * `RAZORPAY_WEBHOOK_SECRET_PREVIOUS` exists purely to make rotation non-lossy: the
 * dashboard change and the deploy of the new secret cannot be simultaneous, and any
 * delivery signed with the old secret in that window would otherwise be rejected and
 * eventually abandoned by Razorpay. Set it during a rotation, then remove it.
 */
export function requireRazorpayWebhookSecret() {
  const current = process.env.RAZORPAY_WEBHOOK_SECRET?.trim();
  if (!current) throw new ConfigurationError("RAZORPAY_WEBHOOK_SECRET is required for Razorpay webhooks.");
  const previous = process.env.RAZORPAY_WEBHOOK_SECRET_PREVIOUS?.trim() || null;
  if (previous && previous === current) {
    throw new ConfigurationError("RAZORPAY_WEBHOOK_SECRET_PREVIOUS must differ from RAZORPAY_WEBHOOK_SECRET (or be removed).");
  }
  return { current, previous } as const;
}

const DELHIVERY_BASE_URLS = { test: "https://staging-express.delhivery.com", live: "https://track.delhivery.com" } as const;

export function requireDelhiveryConfig() {
  const apiToken = process.env.DELHIVERY_API_TOKEN?.trim();
  const mode = process.env.DELHIVERY_MODE?.trim() || "test";
  const clientName = process.env.DELHIVERY_CLIENT_NAME?.trim();
  const pickupLocationName = process.env.DELHIVERY_PICKUP_LOCATION_NAME?.trim();
  const pickupAddress = process.env.DELHIVERY_PICKUP_ADDRESS?.trim();
  const pickupCity = process.env.DELHIVERY_PICKUP_CITY?.trim();
  const pickupState = process.env.DELHIVERY_PICKUP_STATE?.trim();
  const pickupPin = process.env.DELHIVERY_PICKUP_PIN?.trim();
  const pickupPhone = process.env.DELHIVERY_PICKUP_PHONE?.trim();
  const sellerGstTin = process.env.DELHIVERY_SELLER_GST_TIN?.trim();
  const defaultHsnCode = process.env.DELHIVERY_DEFAULT_HSN_CODE?.trim();

  if (!apiToken || !clientName || !pickupLocationName || !pickupAddress || !pickupCity || !pickupState || !pickupPin || !pickupPhone || !sellerGstTin || !defaultHsnCode) {
    throw new ConfigurationError(
      "Delhivery is not configured. Set DELHIVERY_API_TOKEN, DELHIVERY_CLIENT_NAME, DELHIVERY_PICKUP_LOCATION_NAME, DELHIVERY_PICKUP_ADDRESS, DELHIVERY_PICKUP_CITY, DELHIVERY_PICKUP_STATE, DELHIVERY_PICKUP_PIN, DELHIVERY_PICKUP_PHONE, DELHIVERY_SELLER_GST_TIN, and DELHIVERY_DEFAULT_HSN_CODE.",
    );
  }
  if (mode !== "test" && mode !== "live") throw new ConfigurationError("DELHIVERY_MODE must be either test or live.");
  if (!/^[1-9][0-9]{5}$/.test(pickupPin)) throw new ConfigurationError("DELHIVERY_PICKUP_PIN must be a 6-digit Indian pincode.");
  if (!/^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z][0-9A-Z]{3}$/.test(sellerGstTin)) throw new ConfigurationError("DELHIVERY_SELLER_GST_TIN has an invalid GSTIN format.");
  if (!/^[0-9]{4,8}$/.test(defaultHsnCode)) throw new ConfigurationError("DELHIVERY_DEFAULT_HSN_CODE must be a 4-8 digit HSN code.");

  const defaultWeightGrams = parseDelhiveryDimension("DELHIVERY_DEFAULT_PARCEL_WEIGHT_GRAMS", 500, 1, 50_000);
  const defaultLengthCm = parseDelhiveryDimension("DELHIVERY_DEFAULT_PARCEL_L_CM", 20, 1, 200);
  const defaultBreadthCm = parseDelhiveryDimension("DELHIVERY_DEFAULT_PARCEL_B_CM", 15, 1, 200);
  const defaultHeightCm = parseDelhiveryDimension("DELHIVERY_DEFAULT_PARCEL_H_CM", 10, 1, 200);

  return {
    apiToken,
    mode: mode as "test" | "live",
    baseUrl: DELHIVERY_BASE_URLS[mode as "test" | "live"],
    clientName,
    pickupLocationName,
    pickupAddress,
    pickupCity,
    pickupState,
    pickupPin,
    pickupPhone,
    sellerGstTin,
    defaultHsnCode,
    defaultWeightGrams,
    defaultLengthCm,
    defaultBreadthCm,
    defaultHeightCm,
  } as const;
}

function parseDelhiveryDimension(name: string, developmentFallback: number, min: number, max: number) {
  const raw = process.env[name]?.trim();
  if (!raw) return developmentFallback;
  const value = Number(raw);
  if (!Number.isInteger(value) || value < min || value > max) {
    throw new ConfigurationError(`${name} must be an integer between ${min} and ${max}.`);
  }
  return value;
}

/**
 * Bearer secret Delhivery's tracking push webhook must present. Delhivery does not
 * sign its push payloads (unlike Razorpay's HMAC), so this shared secret is the only
 * thing standing between the internet and the order state machine -- see the same
 * `_PREVIOUS` rotation-overlap rationale as requireRazorpayWebhookSecret above.
 */
export function requireDelhiveryWebhookSecret() {
  const current = process.env.DELHIVERY_WEBHOOK_SECRET?.trim();
  if (!current) throw new ConfigurationError("DELHIVERY_WEBHOOK_SECRET is required for the Delhivery tracking webhook.");
  const previous = process.env.DELHIVERY_WEBHOOK_SECRET_PREVIOUS?.trim() || null;
  if (previous && previous === current) {
    throw new ConfigurationError("DELHIVERY_WEBHOOK_SECRET_PREVIOUS must differ from DELHIVERY_WEBHOOK_SECRET (or be removed).");
  }
  return { current, previous } as const;
}

export function requireCronSecret() {
  const cronSecret = process.env.CRON_SECRET?.trim();
  if (!cronSecret) throw new ConfigurationError("CRON_SECRET is required to authorize scheduled jobs.");
  return cronSecret;
}

// Resend (https://resend.com) is the transactional email provider. The sending
// domain is cherrydoodle.in, which must be verified in the Resend dashboard (SPF +
// DKIM) before anything sends; an unverified domain fails every send with a 403.
export function requireResendConfig() {
  const apiKey = process.env.RESEND_API_KEY?.trim();
  const from = process.env.EMAIL_FROM_ADDRESS?.trim();
  if (!apiKey || !from) {
    throw new ConfigurationError("Resend is not configured. Set RESEND_API_KEY and EMAIL_FROM_ADDRESS.");
  }
  if (!apiKey.startsWith("re_")) throw new ConfigurationError("RESEND_API_KEY has an invalid format (expected a re_... key).");
  // Accepts both `orders@cherrydoodle.in` and `Cherry Doodle <orders@cherrydoodle.in>`.
  const address = from.match(/<([^>]+)>\s*$/)?.[1]?.trim() ?? from;
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(address)) {
    throw new ConfigurationError('EMAIL_FROM_ADDRESS must be an email address or "Name <email@domain>".');
  }
  const replyTo = process.env.EMAIL_REPLY_TO_ADDRESS?.trim() || null;
  return { apiKey, from, fromAddress: address, replyTo } as const;
}

// RZ-AUDIT H-5: these two values are real money. They used to be read inline in
// features/checkout/service.ts with hardcoded fallbacks of 3500/500 minor units
// (Rs 35 / Rs 5) that disagreed with the documented .env.example values by ~60x, so
// an environment that simply forgot to set them shipped almost every order free
// with no error and no alert. They are now required in production and validated at
// boot alongside every other money-critical setting.
function checkoutMinor(name: string, developmentFallback: number, production: boolean) {
  const raw = process.env[name]?.trim();
  if (!raw) {
    if (production) throw new ConfigurationError(`${name} is required in production (order totals depend on it).`);
    return developmentFallback;
  }
  const value = Number(raw);
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new ConfigurationError(`${name} must be a non-negative integer in minor units (paise).`);
  }
  return value;
}

export function requireCheckoutPricingConfig(production = isProduction()) {
  return {
    freeShippingThresholdMinor: checkoutMinor("CHECKOUT_FREE_SHIPPING_THRESHOLD_MINOR", 299_900, production),
    flatShippingMinor: checkoutMinor("CHECKOUT_FLAT_SHIPPING_MINOR", 4_900, production),
  } as const;
}

export function isProduction() {
  return process.env.NODE_ENV === "production";
}

// Secrets generated by us (not issued by a third party): they must be long and random.
// Razorpay-issued values (RAZORPAY_KEY_SECRET) are excluded because their length is fixed
// by Razorpay and can be shorter than 32 characters.
const OWNER_GENERATED_SECRETS = [
  "APP_HMAC_SECRET",
  "GUEST_CART_TOKEN_PEPPER",
  "CRON_SECRET",
  "RAZORPAY_WEBHOOK_SECRET",
  "RAZORPAY_WEBHOOK_SECRET_PREVIOUS",
  "DELHIVERY_WEBHOOK_SECRET",
  "DELHIVERY_WEBHOOK_SECRET_PREVIOUS",
] as const;

const MIN_SECRET_LENGTH = 32;

// Values that must never ship with a `.env.example` placeholder in production.
const REQUIRED_PRODUCTION_VALUES = [
  "NEXT_PUBLIC_SITE_URL",
  "NEXT_PUBLIC_SUPABASE_URL",
  "NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY",
  "SUPABASE_SECRET_KEY",
  "CLOUDINARY_CLOUD_NAME",
  "CLOUDINARY_API_KEY",
  "CLOUDINARY_API_SECRET",
  "RAZORPAY_KEY_ID",
  "RAZORPAY_KEY_SECRET",
  "RAZORPAY_WEBHOOK_SECRET",
  "RESEND_API_KEY",
  "EMAIL_FROM_ADDRESS",
  "GUEST_CART_TOKEN_PEPPER",
  "APP_HMAC_SECRET",
  "CRON_SECRET",
  "DELHIVERY_API_TOKEN",
  "DELHIVERY_CLIENT_NAME",
  "DELHIVERY_PICKUP_LOCATION_NAME",
  "DELHIVERY_SELLER_GST_TIN",
  "DELHIVERY_WEBHOOK_SECRET",
] as const;

const PLACEHOLDER_PATTERN = /replace|your-project-ref|changeme|example\.com/i;

/**
 * Aggregate boot-time validation for all server secrets. Invoked from
 * `instrumentation.ts#register()` so the process refuses to start when a required
 * secret is missing, malformed, still a placeholder, or too weak. Never logs values.
 *
 * Presence/format checks run in every environment; placeholder rejection and the
 * distributed-rate-limiting requirement apply only in production.
 */
export function assertServerEnv(options: { production?: boolean } = {}): void {
  const production = options.production ?? isProduction();
  const errors: string[] = [];

  const collect = (validate: () => void) => {
    try {
      validate();
    } catch (error) {
      if (error instanceof ConfigurationError) errors.push(error.message);
      else throw error;
    }
  };

  collect(() => requireSupabaseServerConfig());
  collect(() => requireCloudinaryConfig());
  collect(() => requireRazorpayConfig());
  collect(() => requireRazorpayWebhookSecret());
  collect(() => requireResendConfig());
  collect(() => requireApplicationSecrets());
  collect(() => requireCronSecret());
  collect(() => requireCheckoutPricingConfig(production));
  collect(() => requireDelhiveryConfig());
  collect(() => requireDelhiveryWebhookSecret());

  const siteUrl = process.env.NEXT_PUBLIC_SITE_URL?.trim();
  if (!siteUrl) {
    errors.push("NEXT_PUBLIC_SITE_URL is required for metadata, sitemap, and Razorpay submission.");
  } else {
    try {
      const parsed = new URL(siteUrl);
      if (production && parsed.protocol !== "https:") {
        errors.push("NEXT_PUBLIC_SITE_URL must use https in production.");
      }
    } catch {
      errors.push("NEXT_PUBLIC_SITE_URL must be a valid absolute URL.");
    }
  }

  for (const name of OWNER_GENERATED_SECRETS) {
    const value = process.env[name]?.trim();
    if (value && value.length < MIN_SECRET_LENGTH) {
      errors.push(`${name} must be at least ${MIN_SECRET_LENGTH} characters (use >= 32 random bytes).`);
    }
  }

  if (production) {
    for (const name of REQUIRED_PRODUCTION_VALUES) {
      const value = process.env[name]?.trim();
      if (value && PLACEHOLDER_PATTERN.test(value)) {
        errors.push(`${name} still contains a placeholder value; set the real production secret.`);
      }
    }

    const upstashUrl = process.env.UPSTASH_REDIS_REST_URL?.trim();
    const upstashToken = process.env.UPSTASH_REDIS_REST_TOKEN?.trim();
    if (!upstashUrl || !upstashToken) {
      errors.push(
        "UPSTASH_REDIS_REST_URL and UPSTASH_REDIS_REST_TOKEN are required in production; rate limiting fails closed (503) otherwise.",
      );
    }
  }

  if (errors.length > 0) {
    throw new ConfigurationError(
      `Server environment is misconfigured (${errors.length} problem${errors.length === 1 ? "" : "s"}):\n- ${errors.join("\n- ")}`,
    );
  }
}
