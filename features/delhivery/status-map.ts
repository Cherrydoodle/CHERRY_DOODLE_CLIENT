// Translates Delhivery's tracking vocabulary into this store's order_status enum
// (pending | processing | shipped | delivered | cancelled, defined in
// supabase/migrations/202607150002_admin_commerce.sql) and figures out how to walk
// public.transition_order_status() there, since that RPC only allows one hop at a
// time (pending->processing->shipped->delivered).

export type OrderStatus = "pending" | "processing" | "shipped" | "delivered" | "cancelled";

const ORDER_STATUS_SEQUENCE: OrderStatus[] = ["pending", "processing", "shipped", "delivered"];

/**
 * Returns the ordered list of intermediate statuses to transition through to reach
 * `target` from `current` (each adjacent pair is a single valid RPC hop), or `null`
 * if `target` is not reachable by walking forward (e.g. current is already past it,
 * or current is `cancelled`, a terminal state with no outgoing transitions here).
 *
 * Example: advanceOrderTo("pending", "delivered") -> ["processing", "shipped", "delivered"].
 */
export function advanceOrderTo(current: OrderStatus, target: OrderStatus): OrderStatus[] | null {
  if (current === "cancelled") return null;
  const currentIndex = ORDER_STATUS_SEQUENCE.indexOf(current);
  const targetIndex = ORDER_STATUS_SEQUENCE.indexOf(target);
  if (currentIndex === -1 || targetIndex === -1 || targetIndex <= currentIndex) return null;
  return ORDER_STATUS_SEQUENCE.slice(currentIndex + 1, targetIndex + 1);
}

export type DelhiveryScanInfo = {
  statusType: string | null;
  status: string | null;
  nslCode: string | null;
  pickUpDate: string | null;
};

/**
 * Delhivery's `StatusType` codes as documented/observed: `UD` (shipment open --
 * manifested, in transit, or out for delivery), `DL` (delivered), `RT` (return to
 * origin initiated), `CN` (cancelled), `LT` (lost). `UD` alone doesn't distinguish
 * "manifested, not yet picked up" from "in transit", so `pickUpDate` (present on
 * the shipment once Delhivery's field staff scan it) is the tiebreaker.
 *
 * Returns the order_status this scan implies, or `null` when the scan carries no
 * actionable status change (an unrecognized/informational code) -- callers must
 * acknowledge these without altering order state, per Delhivery's own "consume all
 * scans" guidance.
 */
export function targetOrderStatusForScan(scan: DelhiveryScanInfo): OrderStatus | null {
  const statusType = scan.statusType?.trim().toUpperCase() ?? "";
  switch (statusType) {
    case "DL":
      return "delivered";
    case "UD":
      return scan.pickUpDate ? "shipped" : "processing";
    case "RT":
      // RTO is an operational decision, not an automatic state change: the parcel
      // is still physically "shipped" (moving through the network) until someone
      // decides what happens to the order. shipments.nsl_code still records it.
      return "shipped";
    case "CN":
    case "LT":
      return null;
    default:
      return null;
  }
}
