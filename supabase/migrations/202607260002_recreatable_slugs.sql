-- Deleting a product/category/variant in this app is always a soft delete (deleted_at
-- set, row kept). But products.slug, categories.slug, and product_variants.sku were
-- declared as plain table-wide `unique` constraints, so a deleted row's slug/SKU stayed
-- "occupied" forever -- recreating a product or category with the same name (slugs/SKUs
-- are auto-derived from the name) would fail with 409 SLUG_EXISTS even though nothing
-- with that name is actually live anymore.
--
-- Fix: relax each to a partial unique index scoped to deleted_at is null, exactly like
-- product_variants_active_option_idx in 202607260001_variant_labels_and_media.sql.
--
-- Entirely additive/reversible. Cannot fail on apply: the old table-wide constraints
-- already guaranteed no two currently-active rows share a slug/SKU, so the new partial
-- index is satisfied immediately by existing data.
--
-- Rollback (only safe if no soft-deleted duplicate has been created since this migration
-- ran -- otherwise the ADD CONSTRAINT below will fail, which is the correct outcome):
--   drop index if exists public.products_active_slug_idx;
--   alter table public.products add constraint products_slug_key unique (slug);
--   drop index if exists public.categories_active_slug_idx;
--   alter table public.categories add constraint categories_slug_key unique (slug);
--   drop index if exists public.product_variants_active_sku_idx;
--   alter table public.product_variants add constraint product_variants_sku_key unique (sku);

alter table public.products drop constraint if exists products_slug_key;
create unique index if not exists products_active_slug_idx on public.products (slug) where deleted_at is null;

alter table public.categories drop constraint if exists categories_slug_key;
create unique index if not exists categories_active_slug_idx on public.categories (slug) where deleted_at is null;

alter table public.product_variants drop constraint if exists product_variants_sku_key;
create unique index if not exists product_variants_active_sku_idx on public.product_variants (sku) where deleted_at is null;
