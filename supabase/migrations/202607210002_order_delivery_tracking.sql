-- Adds carrier/tracking fields to orders so admins can record shipment tracking
-- info (set from the admin panel's order screen) and customers can see it on
-- their account order detail page. No separate shipments table: this store
-- ships each order as a single parcel, matching the existing flat-column style
-- used for shipping_address on this same table.

alter table public.orders
  add column if not exists carrier varchar(80),
  add column if not exists tracking_number varchar(100),
  add column if not exists tracking_url varchar(500);
