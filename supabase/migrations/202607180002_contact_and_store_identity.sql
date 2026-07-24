-- RZ-020: Contact-form persistence + real store identity for Razorpay approval.
-- Does not touch currency (RZ-030 migrates USD -> INR) or the payment engine.

-- 1) Contact submissions captured from the public /contact page.
create table if not exists public.contact_messages (
  id uuid primary key default gen_random_uuid(),
  name varchar(120) not null check (char_length(name) between 1 and 120),
  email extensions.citext not null,
  subject varchar(160) not null check (char_length(subject) between 1 and 160),
  message text not null check (char_length(message) between 1 and 5000),
  status varchar(20) not null default 'new' check (status in ('new', 'read', 'archived')),
  last_ip_hash text,
  user_agent varchar(500),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists contact_messages_status_created_idx
  on public.contact_messages(status, created_at desc);

drop trigger if exists contact_messages_touch_updated_at on public.contact_messages;
create trigger contact_messages_touch_updated_at
  before update on public.contact_messages
  for each row execute function public.touch_updated_at();

-- Only the service role (which bypasses RLS) may read or write contact submissions.
-- No anon/authenticated policies are granted; admin surfacing is a follow-up ticket.
alter table public.contact_messages enable row level security;

-- 2) Replace the placeholder store identity (C5/M08) with the confirmed business facts
--    from docs/decisions/rz-000-business-decisions.md. Guarded so it never clobbers a
--    value an admin has already set. Currency is intentionally left unchanged (RZ-030).
update public.store_settings
set store_name = 'Cherry Doodle',
    phone_number = '+91 6235874566',
    email = 'info@cherrydoodle.in',
    website = 'https://cherrydoodle.in',
    address = 'Cherry Doodle, India. Full registered postal address available on request at info@cherrydoodle.in.',
    updated_at = now()
where singleton = true
  and email = 'hello@example.com';
