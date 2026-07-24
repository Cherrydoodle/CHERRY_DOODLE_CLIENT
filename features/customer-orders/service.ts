import "server-only";

import { requireUser } from "@/lib/auth/authorization";
import { ApiError } from "@/lib/http/problem";
import { createAdminSupabaseClient } from "@/lib/supabase/admin";

import {
  mapOrderDetailRow,
  mapOrderSummaryRow,
  ORDER_DETAIL_SELECT,
  ORDER_SUMMARY_SELECT,
  type MyOrderDetailDTO,
  type MyOrderSummaryDTO,
} from "./dto";

// Every query here is explicitly scoped to the authenticated caller's own user id
// (customer_user_id = auth.userId). This is the actual anti-IDOR control: even a
// syntactically valid order id belonging to another customer resolves to zero rows,
// never a 403 that would confirm the order exists. RLS (orders_select_own) provides
// defense in depth on top of this app-layer filter, matching this codebase's
// established convention for user-scoped reads (see features/wishlist/service.ts,
// features/cart/service.ts).

export async function listMyOrders(page: number, limit: number): Promise<{ items: MyOrderSummaryDTO[]; total: number; page: number; limit: number }> {
  const auth = await requireUser();
  const admin = createAdminSupabaseClient();
  const start = (page - 1) * limit;
  const { data, error, count } = await admin
    .from("orders")
    .select(ORDER_SUMMARY_SELECT, { count: "exact" })
    .eq("customer_user_id", auth.userId)
    .is("deleted_at", null)
    .order("placed_at", { ascending: false })
    .range(start, start + limit - 1);
  if (error) throw new ApiError(503, "SERVICE_UNAVAILABLE", "Your orders could not be loaded.");
  return { items: (data ?? []).map(mapOrderSummaryRow), total: count ?? 0, page, limit };
}

export async function getMyOrder(orderId: string): Promise<MyOrderDetailDTO> {
  const auth = await requireUser();
  const admin = createAdminSupabaseClient();
  const { data, error } = await admin
    .from("orders")
    .select(ORDER_DETAIL_SELECT)
    .eq("id", orderId)
    .eq("customer_user_id", auth.userId)
    .is("deleted_at", null)
    .maybeSingle();
  if (error) throw new ApiError(503, "SERVICE_UNAVAILABLE", "The order could not be loaded.");
  if (!data) throw new ApiError(404, "NOT_FOUND", "Order not found.");
  return mapOrderDetailRow(data);
}
