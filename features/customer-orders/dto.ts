import "server-only";

// Shared, customer-safe order DTO. Deliberately narrower than the admin order DTO
// (features/admin-operations/service.ts#getOrder): no internal notes, no admin
// change-reason text, no actor ids. Used by both the account order pages and the
// checkout confirmation flow so the two surfaces render identical, DB-sourced data.

export type MyOrderSummaryDTO = {
  id: string;
  orderNumber: string;
  status: string;
  paymentStatus: string;
  paidAt: string | null;
  placedAt: string;
  totalMinor: number;
  currency: string;
};

export type MyOrderItemDTO = {
  id: string;
  name: string;
  sku: string | null;
  variantLabel: string | null;
  colorName: string | null;
  quantity: number;
  unitPriceMinor: number;
  lineTotalMinor: number;
};

export type MyOrderStatusEventDTO = {
  id: string;
  toStatus: string;
  createdAt: string;
};

// Customer-safe subset of a scan: no NSL code and no shipment-level error text --
// those are internal operational detail (see features/delhivery/service.ts).
export type MyOrderScanDTO = {
  status: string;
  location: string | null;
  scannedAt: string;
};

export type MyOrderRefundDTO = {
  id: string;
  amountMinor: number;
  currency: string;
  status: string;
  reason: string;
  createdAt: string;
};

export type MyOrderDetailDTO = MyOrderSummaryDTO & {
  subtotalMinor: number;
  discountMinor: number;
  shippingMinor: number;
  taxMinor: number;
  shippingAddress: unknown;
  customerNote: string | null;
  items: MyOrderItemDTO[];
  statusHistory: MyOrderStatusEventDTO[];
  returnStatus: string;
  returnReason: string | null;
  returnResolutionNote: string | null;
  // Customer-safe subset: no razorpay_refund_id (an internal provider reference).
  refunds: MyOrderRefundDTO[];
  carrier: string | null;
  trackingNumber: string | null;
  trackingUrl: string | null;
  shipmentScans: MyOrderScanDTO[];
};

// Columns selected for a single order's full detail. Shared by the account order
// detail lookup and the post-checkout confirmation lookup.
export const ORDER_DETAIL_SELECT = `
  id,order_number,status,payment_status,paid_at,placed_at,currency,
  subtotal_minor,discount_minor,shipping_minor,tax_minor,total_minor,
  shipping_address,customer_note,return_status,return_reason,return_resolution_note,
  carrier,tracking_number,tracking_url,
  order_items(id,product_name,sku,variant_label,color_name,quantity,unit_price_minor,line_total_minor),
  order_status_history(id,to_status,created_at),
  refunds(id,amount_minor,currency,status,reason,created_at),
  shipments(id,shipment_scans(scan_status,scan_location,scanned_at))
`;

export const ORDER_SUMMARY_SELECT =
  "id,order_number,status,payment_status,paid_at,placed_at,total_minor,currency";

export function mapOrderSummaryRow(row: Record<string, unknown>): MyOrderSummaryDTO {
  return {
    id: String(row.id),
    orderNumber: String(row.order_number),
    status: String(row.status),
    paymentStatus: String(row.payment_status ?? "pending"),
    paidAt: row.paid_at ? String(row.paid_at) : null,
    placedAt: String(row.placed_at),
    totalMinor: Number(row.total_minor),
    currency: String(row.currency),
  };
}

export function mapOrderDetailRow(row: Record<string, unknown>): MyOrderDetailDTO {
  const items = (row.order_items as Array<Record<string, unknown>> | null) ?? [];
  const history = (row.order_status_history as Array<Record<string, unknown>> | null) ?? [];
  const refunds = (row.refunds as Array<Record<string, unknown>> | null) ?? [];
  return {
    ...mapOrderSummaryRow(row),
    subtotalMinor: Number(row.subtotal_minor),
    discountMinor: Number(row.discount_minor),
    shippingMinor: Number(row.shipping_minor),
    taxMinor: Number(row.tax_minor),
    shippingAddress: row.shipping_address,
    customerNote: row.customer_note ? String(row.customer_note) : null,
    returnStatus: String(row.return_status ?? "none"),
    returnReason: row.return_reason ? String(row.return_reason) : null,
    returnResolutionNote: row.return_resolution_note ? String(row.return_resolution_note) : null,
    carrier: row.carrier ? String(row.carrier) : null,
    trackingNumber: row.tracking_number ? String(row.tracking_number) : null,
    trackingUrl: row.tracking_url ? String(row.tracking_url) : null,
    shipmentScans: ((row.shipments as Array<Record<string, unknown>> | null) ?? [])
      .flatMap((shipment) => (shipment.shipment_scans as Array<Record<string, unknown>> | null) ?? [])
      .map((scan) => ({ status: String(scan.scan_status), location: scan.scan_location ? String(scan.scan_location) : null, scannedAt: String(scan.scanned_at) }))
      .sort((a, b) => a.scannedAt.localeCompare(b.scannedAt)),
    items: items.map((item) => ({
      id: String(item.id),
      name: String(item.product_name),
      sku: item.sku ? String(item.sku) : null,
      variantLabel: item.variant_label ? String(item.variant_label) : null,
      colorName: item.color_name ? String(item.color_name) : null,
      quantity: Number(item.quantity),
      unitPriceMinor: Number(item.unit_price_minor),
      lineTotalMinor: Number(item.line_total_minor),
    })),
    statusHistory: history
      .slice()
      .sort((a, b) => String(a.created_at).localeCompare(String(b.created_at)))
      .map((event) => ({
        id: String(event.id),
        toStatus: String(event.to_status),
        createdAt: String(event.created_at),
      })),
    refunds: refunds
      .slice()
      .sort((a, b) => String(a.created_at).localeCompare(String(b.created_at)))
      .map((refund) => ({
        id: String(refund.id),
        amountMinor: Number(refund.amount_minor),
        currency: String(refund.currency),
        status: String(refund.status),
        reason: String(refund.reason),
        createdAt: String(refund.created_at),
      })),
  };
}
