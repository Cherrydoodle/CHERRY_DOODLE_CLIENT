-- RZ-030: Migrate catalog & store currency USD -> INR.
-- The payment engine already operates in minor units and is NOT touched here.
-- Product prices are converted at a fixed PLACEHOLDER rate (x83); the owner will
-- correct exact INR prices in the admin panel (see rz-000 decision #27).

-- 1) Flip column defaults so any newly created rows use INR.
alter table public.products alter column currency set default 'INR';
alter table public.carts alter column currency set default 'INR';
alter table public.store_settings alter column default_currency set default 'INR';

-- 2) Re-price existing USD products into INR. Guarded on currency = 'USD' so it can
--    never double-convert a row that is already INR. Ratio-preserving, so the
--    sale_price_cents < base_price_cents CHECK still holds.
update public.products
set currency = 'INR',
    base_price_cents = base_price_cents * 83,
    sale_price_cents = case when sale_price_cents is null then null else sale_price_cents * 83 end,
    updated_at = now()
where currency = 'USD';

-- 3) Store settings default currency.
update public.store_settings
set default_currency = 'INR', updated_at = now()
where singleton = true and default_currency = 'USD';

-- 4) Existing active carts (transient; line prices are recomputed at render/checkout).
update public.carts set currency = 'INR' where currency = 'USD';
