# Supabase migration guide (clean database, no demo data)

Applies the 20 migrations in `supabase/migrations/` to a hosted Supabase project, seeds only the
reference rows the app cannot run without, and creates the single administrator account. No demo
products, no demo marketing copy.

Run everything from `cherry-doodle-next/`.

---

## What gets migrated

| Layer | Contents | How it arrives |
|---|---|---|
| Schema | tables, enums, indexes, RLS policies, views, RPCs, triggers | `supabase db push` |
| Required rows | `role_permissions` (RBAC grid), `store_settings` singleton (Cherry Doodle identity, INR, Ramanattukara address, Instagram URL) | inside the migrations — automatic |
| Reference rows | `categories` (5 parents + 18 children), `colors` (6) | `supabase/seed.production.sql` — manual, one command |
| Admin account | `admin@cherrydoodle.com` in `auth.users` + `profiles` + `user_roles` | `npm run bootstrap:admin` |
| **Demo data** | 12 draft products, variants, SKUs, badges, hero/sale banner copy | **`supabase/seed.sql` — not applied** |

`supabase db push` applies migrations only; it never runs `seed.sql`. That file is used exclusively
by the local `supabase db reset` flow, so the demo catalog stays out of the hosted database by
default. Leave `seed.sql` alone for local development.

---

## 0. Prerequisites

- Node.js 20.9+, npm 10+
- A hosted Supabase project (note its **project ref**, e.g. `abcdefghijklmnop`)
- Its **database password** (Settings → Database) and the keys from Settings → API

The repo is currently linked to project ref `lbdpnsjymtursjrmriny`. Re-run the link step below if
you are migrating to a different project.

## 1. Link the project

```powershell
npx supabase login
npx supabase link --project-ref <your-project-ref>
```

The CLI prompts for the database password and writes `supabase/.temp/`.

## 2. Push the migrations

```powershell
npx supabase db push
npx supabase migration list
```

`migration list` must show all 20 versions present both locally and remotely
(`202607140001` … `202607230001`). The migrations are written defensively
(`create table if not exists`, `on conflict do nothing`, guarded `update`s), so re-running against a
partially-migrated project is safe.

If the CLI cannot reach the database over IPv6, use the session-mode pooler on port 5432:

```powershell
npx supabase db push --db-url "postgresql://postgres.<ref>:<db-password>@aws-1-<region>.pooler.supabase.com:5432/postgres"
```

> **Never run `npx supabase db reset` against a hosted project.** It drops the schema *and* applies
> `seed.sql`, which is exactly the demo catalog you want to avoid.

## 3. Apply the minimal reference seed

Either from a shell:

```powershell
psql "$env:SUPABASE_DB_URL" -f supabase/seed.production.sql
```

…or paste `supabase/seed.production.sql` into the Supabase dashboard **SQL Editor** and run it.
It inserts categories and colors only, and is idempotent.

Skip it only if you plan to create every category and color by hand in the admin panel — but note
that the product form cannot save a variant without at least one color.

## 4. Configure Auth in the dashboard

1. **Authentication → URL Configuration**
   - Site URL: your storefront origin (e.g. `https://cherrydoodle.in`)
   - Redirect URLs: add `<origin>/auth/callback` for the storefront, and the admin panel origin
     (port 3001 locally)
2. **Authentication → Hooks → Customize Access Token (JWT) Claims**
   - Enable, select `public.custom_access_token_hook`
   - This puts the `app_role` claim in the JWT. Migration `202607150006` provides an
     `app_metadata` fallback, so staff logins work even before the hook is switched on — but enable
     it anyway.
3. **Authentication → Providers → Google** (only if you use Google sign-in) — set client ID/secret.
4. **Authentication → Providers → Email** — keep "Confirm email" on for real customers. The
   bootstrap script confirms the admin address itself, so this does not block step 5.

## 5. Create the administrator

Set these in the gitignored `.env.local` (they are read only by the bootstrap script):

```dotenv
NEXT_PUBLIC_SUPABASE_URL=https://<your-project-ref>.supabase.co
SUPABASE_SECRET_KEY=sb_secret_...
ADMIN_BOOTSTRAP_EMAIL=admin@cherrydoodle.com
ADMIN_BOOTSTRAP_PASSWORD=Admin@cherrydoodle
ADMIN_BOOTSTRAP_DISPLAY_NAME=Cherry Doodle Admin
```

Then:

```powershell
npm run bootstrap:admin
```

The script is idempotent: it creates or updates the user, confirms the email, sets
`app_metadata.app_role = admin`, upserts `profiles`, upserts `user_roles.role = 'admin'`, and prints
the real Supabase UUID.

Notes:

- `Admin@cherrydoodle` is 18 characters, which clears the script's 16-character minimum. It is a
  guessable password for a store-owner account — rotate it after the first login, and remove
  `ADMIN_BOOTSTRAP_PASSWORD` from `.env.local` once the account exists.
- The admin panel signs in with this same Supabase account. `ADMIN_DASHBOARD_USERNAME` /
  `ADMIN_DASHBOARD_PASSWORD` in `cherry_doodle_admin_panel/.env.example` are not read by any code —
  ignore them.

## 6. Point both apps at the project

`cherry-doodle-next/.env.local`:

```dotenv
NEXT_PUBLIC_SUPABASE_URL=https://<ref>.supabase.co
NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY=sb_publishable_...
SUPABASE_SECRET_KEY=sb_secret_...
SUPABASE_DB_URL=postgresql://postgres.<ref>:<db-password>@aws-1-<region>.pooler.supabase.com:5432/postgres
```

`cherry_doodle_admin_panel/.env.local`: same `NEXT_PUBLIC_SUPABASE_URL` and publishable key, plus
`BACKEND_API_URL` pointing at the storefront deployment. Never put `SUPABASE_SECRET_KEY` or the
Cloudinary secret in the admin panel environment.

## 7. Verify

Run in the SQL Editor:

```sql
-- 20 migrations recorded
select count(*) from supabase_migrations.schema_migrations;

-- store identity: Cherry Doodle / INR / cherrydoodle987@gmail.com / Ramanattukara
select store_name, email, phone_number, default_currency, address, instagram_url
from public.store_settings;

-- RBAC grid populated
select role, count(*) from public.role_permissions group by role order by role;

-- reference data present
select (select count(*) from public.categories) as categories,
       (select count(*) from public.colors) as colors;   -- expect 23 and 6

-- no demo data
select (select count(*) from public.products) as products,
       (select count(*) from public.product_variants) as variants,
       (select count(*) from public.content_blocks) as content_blocks;  -- expect 0, 0, 0

-- the administrator
select u.email, r.role, p.display_name
from auth.users u
join public.user_roles r on r.user_id = u.id
join public.profiles p on p.user_id = u.id
where u.email = 'admin@cherrydoodle.com';
```

Then sign in to the admin panel with `admin@cherrydoodle.com` and confirm the dashboard loads.

## 8. After migrating

An empty catalog is expected. From the admin panel:

1. Upload media (Cloudinary must be configured — see the README).
2. Create products, variants, and SKUs; attach media; publish.
3. Create homepage banners (`home.banner.*`), marquee messages (`home.marquee.*`), and reels
   (`home.reel.*`). The storefront degrades to its built-in defaults while these are empty, so the
   site stays up with no content blocks at all.
4. Review store settings — currency is INR and the identity fields are already correct.

## Future schema changes

```powershell
npx supabase migration new <name>   # write SQL into the new file
npx supabase db push                 # staging first, then production
```

Never edit an already-pushed migration file; add a new one. Enable point-in-time recovery on the
project before it takes real orders.
