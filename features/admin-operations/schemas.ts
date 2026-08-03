import { z } from "zod";

export const orderStatusSchema = z.enum(["pending", "processing", "shipped", "delivered", "cancelled"]);

export const orderUpdateSchema = z.object({
  status: orderStatusSchema.optional(),
  statusReason: z.string().trim().max(500).optional(),
  internalNote: z.string().trim().max(5000).optional(),
  carrier: z.string().trim().min(1).max(80).nullable().optional(),
  trackingNumber: z.string().trim().min(1).max(100).nullable().optional(),
  trackingUrl: z.string().trim().url().max(500).nullable().optional(),
  // Required only when cancelling an order that has a live Delhivery shipment --
  // see updateOrder's cancel guard. Confirms the admin has separately cancelled the
  // waybill in Delhivery's own panel (the Cancel Order API itself is out of scope).
  acknowledgeShipmentCancelled: z.boolean().optional(),
  expectedVersion: z.number().int().positive(),
}).strict().superRefine((value, context) => {
  if (value.statusReason && !value.status) context.addIssue({ code: "custom", path: ["statusReason"], message: "A status reason requires a status change." });
  const hasTrackingUpdate = value.carrier !== undefined || value.trackingNumber !== undefined || value.trackingUrl !== undefined;
  if (!value.status && !value.internalNote && !hasTrackingUpdate) context.addIssue({ code: "custom", path: [], message: "Provide a status, internal note, or tracking update." });
});

const optionalMediaId = z.string().uuid().nullable().optional();
export const storeSettingsUpdateSchema = z.object({
  storeName: z.string().trim().min(2).max(120).optional(),
  phoneNumber: z.string().trim().min(5).max(32).optional(),
  email: z.string().trim().email().max(254).optional(),
  website: z.string().url().max(500).optional(),
  address: z.string().trim().min(5).max(1000).optional(),
  instagramUrl: z.string().trim().url().max(500).refine((value) => /^https:\/\/(www\.)?instagram\.com\//i.test(value), "Enter a full Instagram profile URL (https://www.instagram.com/…).").nullable().optional(),
  defaultCurrency: z.string().regex(/^[A-Z]{3}$/).optional(),
  locale: z.string().regex(/^[a-z]{2}(?:-[A-Z]{2})?$/).optional(),
  timezone: z.string().trim().min(1).max(100).optional(),
  logoMediaId: optionalMediaId,
  faviconMediaId: optionalMediaId,
  expectedVersion: z.number().int().positive(),
}).strict();

export const adminProfileUpdateSchema = z.object({
  displayName: z.string().trim().min(2).max(80).optional(),
  phoneNumber: z.string().trim().min(5).max(32).nullable().optional(),
  avatarMediaId: optionalMediaId,
}).strict().refine((value) => Object.keys(value).length > 0, "Provide at least one profile field.");

export const passwordChangeSchema = z.object({
  currentPassword: z.string().min(1).max(200),
  newPassword: z.string().min(12).max(200),
}).strict().refine((value) => value.currentPassword !== value.newPassword, {
  path: ["newPassword"], message: "The new password must be different from the current password.",
});

export const bannerCreateSchema = z.object({
  title: z.string().trim().min(1).max(200),
  subtitle: z.string().trim().max(2000).nullable().optional(),
  buttonText: z.string().trim().min(1).max(80),
  buttonLink: z.string().trim().min(1).max(500).refine((value) => value.startsWith("/") && !value.startsWith("//"), "Use a relative storefront path."),
  imageMediaId: z.string().uuid(),
  isActive: z.boolean().optional().default(true),
  sortOrder: z.number().int().min(-10_000).max(10_000).optional().default(0),
  startsAt: z.string().datetime().nullable().optional(),
  endsAt: z.string().datetime().nullable().optional(),
}).strict();

export const bannerUpdateSchema = bannerCreateSchema.partial().extend({ expectedVersion: z.number().int().positive() }).strict();

export const announcementCreateSchema = z.object({
  text: z.string().trim().min(1).max(200),
  link: z.string().trim().min(1).max(500).refine((value) => value.startsWith("/") && !value.startsWith("//"), "Use a relative storefront path.").nullable().optional(),
  isActive: z.boolean().optional().default(true),
  sortOrder: z.number().int().min(-10_000).max(10_000).optional().default(0),
  startsAt: z.string().datetime().nullable().optional(),
  endsAt: z.string().datetime().nullable().optional(),
}).strict();

export const announcementUpdateSchema = announcementCreateSchema.partial().extend({ expectedVersion: z.number().int().positive() }).strict();

const instagramReelUrl = z.string().trim().max(500).regex(
  /^https:\/\/(www\.)?instagram\.com\/(reel|reels|p)\/[A-Za-z0-9_-]+\/?/i,
  "Enter a full Instagram reel or post URL (https://www.instagram.com/reel/…).",
);

export const reelCreateSchema = z.object({
  reelUrl: instagramReelUrl,
  caption: z.string().trim().max(2000).nullable().optional(),
  isActive: z.boolean().optional().default(true),
  sortOrder: z.number().int().min(-10_000).max(10_000).optional().default(0),
  startsAt: z.string().datetime().nullable().optional(),
  endsAt: z.string().datetime().nullable().optional(),
}).strict();

export const reelUpdateSchema = reelCreateSchema.partial().extend({ expectedVersion: z.number().int().positive() }).strict();

export const colorCreateSchema = z.object({
  name: z.string().trim().min(1).max(60),
  hex: z.string().trim().regex(/^#[0-9A-Fa-f]{6}$/, "Use a 6-digit hex color like #F8B4C4."),
  sortOrder: z.number().int().min(-10_000).max(10_000).optional().default(0),
}).strict();

export const colorUpdateSchema = colorCreateSchema.partial().strict();
