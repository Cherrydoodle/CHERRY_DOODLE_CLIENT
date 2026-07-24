-- Change the active media provider from Cloudflare R2 to Cloudinary while
-- retaining provider identity for any objects created by older deployments.

alter table public.media_assets
  drop constraint if exists media_assets_storage_provider_check;

update public.media_assets
set
  storage_provider = 'legacy_r2',
  status = case when status in ('pending', 'ready') then 'failed'::public.media_status else status end,
  last_error = case
    when status in ('pending', 'ready') then 'Legacy R2 media must be re-uploaded to Cloudinary.'
    else last_error
  end
where storage_provider = 'r2';

update public.media_assets
set
  status = 'failed'::public.media_status,
  last_error = 'Legacy Cloudflare Images media must be re-uploaded to Cloudinary.'
where storage_provider = 'legacy_cloudflare_images'
  and status in ('pending', 'ready');

alter table public.media_assets
  alter column storage_provider set default 'cloudinary';

alter table public.media_assets
  add constraint media_assets_storage_provider_check
  check (storage_provider in ('cloudinary', 'legacy_r2', 'legacy_cloudflare_images'));

comment on column public.media_assets.storage_key is
  'Provider object identifier. Cloudinary rows store the immutable public_id, never a delivery URL.';
comment on column public.media_assets.storage_provider is
  'cloudinary for current assets; legacy values identify objects requiring re-upload or manual cleanup.';
comment on column public.media_assets.storage_etag is
  'Provider ETag captured when Cloudinary upload finalization succeeds.';
