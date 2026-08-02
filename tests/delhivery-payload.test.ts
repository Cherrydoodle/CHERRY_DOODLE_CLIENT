import { describe, expect, it } from "vitest";

import { buildManifestShipment, buildPickupLocation, type ManifestSellerConfig } from "@/features/delhivery/payload";

const seller: ManifestSellerConfig = {
  clientName: "Cherry Doodle Pvt Ltd",
  sellerGstTin: "07AABCU9603R1ZM",
  defaultHsnCode: "6109",
  pickupLocationName: "Cherry Doodle Warehouse",
  pickupAddress: "123 Industrial Area",
  pickupCity: "New Delhi",
  pickupState: "Delhi",
  pickupPin: "110001",
  pickupPhone: "9800000000",
};

const order = {
  orderNumber: "CD-010001",
  waybill: "WB12345",
  customerName: "Asha Verma",
  customerPhone: "9876543210",
  shippingAddress: { line1: "12 MG Road", line2: "Near Park", city: "Bengaluru", state: "Karnataka", postalCode: "560001" },
  totalMinor: 349900,
  productsDescription: "Doodle Tote Bag, Doodle Scrunchie",
  quantity: 2,
};

const parcel = { weightGrams: 450, lengthCm: 20, breadthCm: 15, heightCm: 10 };

describe("buildManifestShipment", () => {
  it("is always Prepaid with zero cod_amount (COD is out of scope)", () => {
    const shipment = buildManifestShipment(order, parcel, seller);
    expect(shipment.payment_mode).toBe("Prepaid");
    expect(shipment.cod_amount).toBe("0");
  });

  it("converts minor units (paise) to whole rupees for total_amount", () => {
    const shipment = buildManifestShipment(order, parcel, seller);
    expect(shipment.total_amount).toBe("3499.00");
  });

  it("joins address line1/line2 and passes through pin/city/state", () => {
    const shipment = buildManifestShipment(order, parcel, seller);
    expect(shipment.add).toBe("12 MG Road, Near Park");
    expect(shipment.pin).toBe("560001");
    expect(shipment.city).toBe("Bengaluru");
    expect(shipment.state).toBe("Karnataka");
  });

  it("omits line2 cleanly when absent", () => {
    const shipment = buildManifestShipment({ ...order, shippingAddress: { ...order.shippingAddress, line2: null } }, parcel, seller);
    expect(shipment.add).toBe("12 MG Road");
  });

  it("carries the waybill, client name, and parcel dimensions through byte-exact", () => {
    const shipment = buildManifestShipment(order, parcel, seller);
    expect(shipment.waybill).toBe("WB12345");
    expect(shipment.client).toBe(seller.clientName);
    expect(shipment.seller_name).toBe(seller.clientName);
    expect(shipment.weight).toBe("450");
    expect(shipment.shipment_length).toBe("20");
    expect(shipment.shipment_width).toBe("15");
    expect(shipment.shipment_height).toBe("10");
  });

  it("carries the seller GSTIN and default HSN code", () => {
    const shipment = buildManifestShipment(order, parcel, seller);
    expect(shipment.seller_gst_tin).toBe(seller.sellerGstTin);
    expect(shipment.hsn_code).toBe(seller.defaultHsnCode);
  });
});

describe("buildPickupLocation", () => {
  it("must exactly match the registered pickup location name (case-sensitive per Delhivery)", () => {
    const location = buildPickupLocation(seller);
    expect(location.name).toBe(seller.pickupLocationName);
    expect(location.pin_code).toBe(seller.pickupPin);
    expect(location.country).toBe("India");
  });
});
