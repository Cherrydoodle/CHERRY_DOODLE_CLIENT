-- Sole discount arithmetic in the system. Every site that needs an offer price
-- (catalog listing, cart, checkout) reads a value already computed here or in
-- active_product_offers below -- none of them re-derive a percentage in application
-- code, so the price shown on a card can never drift from the price charged.
--
-- least(..., current_price_cents) guarantees an offer can never raise a price: a
-- fixed price mistakenly entered above the selling price degrades to "no discount"
-- rather than a markup. floor() rounds in the customer's favour. greatest(1, ...)
-- keeps the result positive so it satisfies every downstream `> 0` check.
create or replace function public.offer_price_for(
  current_price_cents integer, discount_percent numeric, fixed_price_cents integer
) returns integer
language sql
immutable
set search_path = ''
as $$
  select greatest(1, least(
    coalesce(fixed_price_cents,
             floor(current_price_cents * (100 - coalesce(discount_percent, 0)) / 100.0)::integer),
    current_price_cents
  ));
$$;

-- Resolves the single winning offer per product among all currently-active,
-- in-schedule offers. Overlaps are permitted by design: when a product sits in
-- more than one live offer, this picks the winner deterministically by priority,
-- then by deeper discount, then by which offer was created first (stable
-- tie-break). Scheduling needs no cron to be correct -- the now() predicates mean
-- an offer switches on and off by itself; the cron added later only keeps the
-- storefront's cached listings from lagging behind that boundary.
create or replace view public.active_product_offers
with (security_invoker = true)
as
select distinct on (op.product_id)
  op.product_id,
  o.id as offer_id,
  o.name as offer_name,
  o.slug as offer_slug,
  o.priority,
  o.ends_at as offer_ends_at,
  o.discount_percent as offer_discount_percent,
  public.offer_price_for(coalesce(p.sale_price_cents, p.base_price_cents), o.discount_percent, op.offer_price_cents) as offer_price_cents
from public.offer_products op
join public.offers o on o.id = op.offer_id
join public.products p on p.id = op.product_id
where o.is_active and o.deleted_at is null and p.deleted_at is null
  and (o.starts_at is null or o.starts_at <= now())
  and (o.ends_at is null or o.ends_at > now())
order by op.product_id,
  o.priority desc,
  public.offer_price_for(coalesce(p.sale_price_cents, p.base_price_cents), o.discount_percent, op.offer_price_cents) asc,
  o.created_at asc;

grant select on public.active_product_offers to anon, authenticated;

comment on function public.offer_price_for is 'Clamped discount arithmetic: never raises a price, floors in the customer favour, always positive.';
comment on view public.active_product_offers is 'One winning offer per product among active, in-schedule offers, resolved by priority then deepest discount then creation order.';
