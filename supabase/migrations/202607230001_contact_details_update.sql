-- Contact details refresh: confirmed storefront/WhatsApp/Instagram identity, plus a
-- dedicated social (Instagram) column that did not exist before. Mirrors the guarded
-- style of 202607180002 so it never clobbers a value an admin has already customized.

-- 1) New social column on the store identity singleton.
alter table public.store_settings
  add column if not exists instagram_url varchar(500);

-- 2) Apply the confirmed contact facts. Guarded on the value the previous identity
--    migration (202607180002) set, so an admin-customized row is left untouched.
update public.store_settings
set email = 'cherrydoodle987@gmail.com',
    phone_number = '+91 6235874566',
    address = 'Regent Plaza, 2nd Floor, Ramanattukara – 673633',
    instagram_url = 'https://www.instagram.com/cherry__doodle',
    updated_at = now()
where singleton = true
  and email = 'info@cherrydoodle.in';
