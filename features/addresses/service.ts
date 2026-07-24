import "server-only";

import type { AddressInput, AddressUpdateInput } from "@/features/addresses/schemas";
import { requireUser } from "@/lib/auth/authorization";
import { ApiError } from "@/lib/http/problem";
import { createAdminSupabaseClient } from "@/lib/supabase/admin";

export type AddressDTO = {
  id: string;
  label: string;
  recipientName: string;
  phoneNumber: string;
  line1: string;
  line2: string | null;
  city: string;
  state: string;
  postalCode: string;
  countryCode: string;
  isDefault: boolean;
  version: number;
};

const ADDRESS_SELECT = "id,label,recipient_name,phone_number,line1,line2,city,state,postal_code,country_code,is_default,version";

function mapAddressRow(row: Record<string, unknown>): AddressDTO {
  return {
    id: String(row.id), label: String(row.label), recipientName: String(row.recipient_name), phoneNumber: String(row.phone_number),
    line1: String(row.line1), line2: row.line2 ? String(row.line2) : null, city: String(row.city), state: String(row.state),
    postalCode: String(row.postal_code), countryCode: String(row.country_code), isDefault: Boolean(row.is_default), version: Number(row.version),
  };
}

// Ownership is enforced by explicit .eq("user_id", auth.userId) filtering with the
// service-role client, matching this codebase's established convention for
// user-scoped reads/writes (features/wishlist/service.ts, features/cart/service.ts)
// -- RLS's customer_addresses_select_own policy provides defense in depth on top.
export async function listMyAddresses(): Promise<AddressDTO[]> {
  const auth = await requireUser();
  const admin = createAdminSupabaseClient();
  const { data, error } = await admin
    .from("customer_addresses")
    .select(ADDRESS_SELECT)
    .eq("user_id", auth.userId)
    .is("deleted_at", null)
    .order("is_default", { ascending: false })
    .order("created_at", { ascending: false });
  if (error) throw new ApiError(503, "SERVICE_UNAVAILABLE", "Your addresses could not be loaded.");
  return (data ?? []).map(mapAddressRow);
}

export async function createMyAddress(input: AddressInput): Promise<AddressDTO> {
  const auth = await requireUser();
  const admin = createAdminSupabaseClient();

  if (input.isDefault) {
    // customer_addresses_one_default_idx allows at most one default per user;
    // clear the previous default first so the insert below never violates it.
    await admin.from("customer_addresses").update({ is_default: false }).eq("user_id", auth.userId).eq("is_default", true);
  }

  const { data, error } = await admin
    .from("customer_addresses")
    .insert({
      user_id: auth.userId, label: input.label, recipient_name: input.recipientName, phone_number: input.phoneNumber,
      line1: input.line1, line2: input.line2 || null, city: input.city, state: input.state,
      postal_code: input.postalCode, country_code: input.countryCode, is_default: input.isDefault,
    })
    .select(ADDRESS_SELECT)
    .single();
  if (error || !data) throw new ApiError(503, "SERVICE_UNAVAILABLE", "The address could not be saved.");
  return mapAddressRow(data);
}

export async function updateMyAddress(addressId: string, input: AddressUpdateInput): Promise<AddressDTO> {
  const auth = await requireUser();
  const admin = createAdminSupabaseClient();
  const { expectedVersion, ...fields } = input;

  if (fields.isDefault) {
    await admin.from("customer_addresses").update({ is_default: false }).eq("user_id", auth.userId).eq("is_default", true).neq("id", addressId);
  }

  const patch = {
    ...(fields.label !== undefined ? { label: fields.label } : {}),
    ...(fields.recipientName !== undefined ? { recipient_name: fields.recipientName } : {}),
    ...(fields.phoneNumber !== undefined ? { phone_number: fields.phoneNumber } : {}),
    ...(fields.line1 !== undefined ? { line1: fields.line1 } : {}),
    ...(fields.line2 !== undefined ? { line2: fields.line2 || null } : {}),
    ...(fields.city !== undefined ? { city: fields.city } : {}),
    ...(fields.state !== undefined ? { state: fields.state } : {}),
    ...(fields.postalCode !== undefined ? { postal_code: fields.postalCode } : {}),
    ...(fields.countryCode !== undefined ? { country_code: fields.countryCode } : {}),
    ...(fields.isDefault !== undefined ? { is_default: fields.isDefault } : {}),
  };
  const { data, error } = await admin
    .from("customer_addresses")
    .update(patch)
    .eq("id", addressId)
    .eq("user_id", auth.userId)
    .eq("version", expectedVersion)
    .is("deleted_at", null)
    .select(ADDRESS_SELECT)
    .maybeSingle();
  if (error) throw new ApiError(503, "SERVICE_UNAVAILABLE", "The address could not be updated.");
  if (!data) throw new ApiError(409, "VERSION_CONFLICT", "This address was changed elsewhere. Refresh and try again.");
  return mapAddressRow(data);
}

export async function deleteMyAddress(addressId: string, expectedVersion: number): Promise<void> {
  const auth = await requireUser();
  const admin = createAdminSupabaseClient();
  const { data, error } = await admin
    .from("customer_addresses")
    .update({ deleted_at: new Date().toISOString(), is_default: false })
    .eq("id", addressId)
    .eq("user_id", auth.userId)
    .eq("version", expectedVersion)
    .is("deleted_at", null)
    .select("id")
    .maybeSingle();
  if (error) throw new ApiError(503, "SERVICE_UNAVAILABLE", "The address could not be deleted.");
  if (!data) throw new ApiError(409, "VERSION_CONFLICT", "This address was changed elsewhere. Refresh and try again.");
}
