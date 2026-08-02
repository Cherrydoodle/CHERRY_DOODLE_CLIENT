import { z } from "zod";

// Delhivery's response shapes are under-documented and have historically added
// fields without notice, so every schema here uses `.passthrough()` and treats
// unrecognized/missing fields as absent rather than a parse failure -- mirroring
// how features/checkout/schemas.ts#razorpayWebhookSchema handles the same problem
// for a third-party payload this codebase does not control.

export const pincodeServiceabilityResponseSchema = z.object({
  delivery_codes: z.array(
    z.object({
      postal_code: z.object({
        pin: z.union([z.string(), z.number()]),
        pre_paid: z.union([z.string(), z.boolean()]).optional(),
        cash: z.union([z.string(), z.boolean()]).optional(),
        cod: z.union([z.string(), z.boolean()]).optional(),
        city: z.string().optional(),
        state_code: z.string().optional(),
        district: z.string().optional(),
        max_amount: z.union([z.string(), z.number()]).optional(),
      }).passthrough(),
    }).passthrough(),
  ).default([]),
}).passthrough();

export const manifestPackageResultSchema = z.object({
  status: z.string().optional(),
  waybill: z.string().optional(),
  refnum: z.string().optional(),
  remarks: z.array(z.string()).optional(),
  sort_code: z.string().optional(),
}).passthrough();

export const manifestResponseSchema = z.object({
  success: z.boolean().optional(),
  rmk: z.string().optional(),
  packages: z.array(manifestPackageResultSchema).default([]),
}).passthrough();

const scanDetailSchema = z.object({
  ScanDetail: z.object({
    Scan: z.string().optional(),
    ScanDateTime: z.string().optional(),
    ScanType: z.string().optional(),
    ScannedLocation: z.string().optional(),
    Instructions: z.string().optional(),
    StatusCode: z.string().optional(),
  }).passthrough(),
}).passthrough();

const trackingShipmentSchema = z.object({
  Shipment: z.object({
    AWB: z.string().optional(),
    ReferenceNo: z.string().optional(),
    PickUpDate: z.string().nullable().optional(),
    Status: z.object({
      Status: z.string().optional(),
      StatusType: z.string().optional(),
      StatusDateTime: z.string().optional(),
      StatusLocation: z.string().optional(),
      Instructions: z.string().optional(),
      NSLCode: z.string().optional(),
    }).passthrough().optional(),
    Scans: z.array(scanDetailSchema).default([]),
  }).passthrough(),
}).passthrough();

export const trackingResponseSchema = z.object({
  ShipmentData: z.array(trackingShipmentSchema).default([]),
}).passthrough();

// The tracking PUSH webhook payload Delhivery POSTs. No signature -- see
// requireDelhiveryWebhookSecret in lib/env.server.ts.
export const trackingPushSchema = z.object({
  Shipment: z.object({
    AWB: z.string().min(1),
    ReferenceNo: z.string().optional(),
    PickUpDate: z.string().nullable().optional(),
    Sortcode: z.string().optional(),
    Status: z.object({
      Status: z.string().optional(),
      StatusType: z.string().optional(),
      StatusDateTime: z.string().optional(),
      StatusLocation: z.string().optional(),
      Instructions: z.string().optional(),
      NSLCode: z.string().optional(),
    }).passthrough(),
  }).passthrough(),
}).passthrough();

export const shipmentCreateInputSchema = z.object({
  weightGrams: z.number().int().min(1).max(50_000).optional(),
  lengthCm: z.number().int().min(1).max(200).optional(),
  breadthCm: z.number().int().min(1).max(200).optional(),
  heightCm: z.number().int().min(1).max(200).optional(),
  expectedVersion: z.number().int().positive(),
}).strict();

export const pickupRequestInputSchema = z.object({
  pickupDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "pickupDate must be YYYY-MM-DD."),
  pickupTime: z.string().regex(/^\d{2}:\d{2}(:\d{2})?$/, "pickupTime must be HH:MM or HH:MM:SS."),
  expectedPackageCount: z.number().int().min(1).max(10_000),
}).strict();

export type ShipmentCreateInput = z.infer<typeof shipmentCreateInputSchema>;
export type PickupRequestInput = z.infer<typeof pickupRequestInputSchema>;
