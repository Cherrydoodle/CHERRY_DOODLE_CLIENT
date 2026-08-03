// Pure, network-free builders for the Delhivery manifest (Package Order Creation)
// payload -- kept separate from features/delhivery/client.ts and service.ts so the
// shipment shape can be unit-tested without mocking fetch or Supabase.

export type ManifestAddress = {
  line1: string;
  line2?: string | null;
  city: string;
  state: string;
  postalCode: string;
};

export type ManifestOrderInput = {
  orderNumber: string;
  waybill: string;
  customerName: string;
  /** Normalized 10-digit Indian mobile number (see normalize.ts#normalizeIndianPhone). */
  customerPhone: string;
  shippingAddress: ManifestAddress;
  /** Order total in minor units (paise); converted to whole rupees for Delhivery. */
  totalMinor: number;
  productsDescription: string;
  quantity: number;
};

export type ManifestParcel = {
  weightGrams: number;
  lengthCm: number;
  breadthCm: number;
  heightCm: number;
};

export type ManifestSellerConfig = {
  clientName: string;
  sellerGstTin: string;
  defaultHsnCode: string;
  pickupLocationName: string;
  pickupAddress: string;
  pickupCity: string;
  pickupState: string;
  pickupPin: string;
  pickupPhone: string;
};

function addressLine(address: ManifestAddress): string {
  return address.line2 ? `${address.line1}, ${address.line2}` : address.line1;
}

/** Builds one entry of the manifest API's `shipments` array. Prepaid-only: this
 * store does not support COD (see the design decision in the Delhivery plan), so
 * `payment_mode` is always "Prepaid" and `cod_amount` is always 0. */
export function buildManifestShipment(order: ManifestOrderInput, parcel: ManifestParcel, seller: ManifestSellerConfig): Record<string, unknown> {
  return {
    name: order.customerName,
    add: addressLine(order.shippingAddress),
    city: order.shippingAddress.city,
    state: order.shippingAddress.state,
    pin: order.shippingAddress.postalCode,
    country: "India",
    phone: order.customerPhone,
    order: order.orderNumber,
    payment_mode: "Prepaid",
    products_desc: order.productsDescription,
    hsn_code: seller.defaultHsnCode,
    cod_amount: "0",
    total_amount: (order.totalMinor / 100).toFixed(2),
    quantity: String(order.quantity),
    seller_gst_tin: seller.sellerGstTin,
    seller_add: seller.pickupAddress,
    seller_name: seller.clientName,
    waybill: order.waybill,
    client: seller.clientName,
    shipment_width: String(parcel.breadthCm),
    shipment_height: String(parcel.heightCm),
    shipment_length: String(parcel.lengthCm),
    weight: String(parcel.weightGrams),
  };
}

export function buildPickupLocation(seller: ManifestSellerConfig): Record<string, unknown> {
  return {
    name: seller.pickupLocationName,
    add: seller.pickupAddress,
    city: seller.pickupCity,
    state: seller.pickupState,
    pin_code: seller.pickupPin,
    country: "India",
    phone: seller.pickupPhone,
  };
}
