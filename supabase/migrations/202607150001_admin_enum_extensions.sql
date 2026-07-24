-- Enum values must be committed before later migrations can safely reference them.
alter type public.app_permission add value if not exists 'dashboard.read';
alter type public.app_permission add value if not exists 'orders.read';
alter type public.app_permission add value if not exists 'orders.write';
alter type public.app_permission add value if not exists 'customers.read';
alter type public.app_permission add value if not exists 'settings.read';
alter type public.app_permission add value if not exists 'settings.write';

alter type public.media_purpose add value if not exists 'brand';
alter type public.media_purpose add value if not exists 'order_customization';
