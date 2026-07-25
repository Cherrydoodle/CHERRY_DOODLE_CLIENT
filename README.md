# Cherry Doodle — Storefront

Next.js 16 App Router customer storefront with a production-oriented backend built on Supabase
(PostgreSQL + Auth) and Cloudinary. A static catalog fallback keeps the UI and production build
usable before infrastructure credentials are supplied.

This app is one half of a two-app system: it also exposes the `/api/v1/admin` API consumed by the
sibling **[`cherry_doodle_admin_panel`](../cherry_doodle_admin_panel/README.md)** staff console
(port 3001), which authenticates through the same Supabase Auth project.

## Tech stack

- **Framework:** Next.js 16 (App Router, `proxy.ts` middleware for session refresh and route
  protection), React 19, TypeScript
- **Database/Auth:** Supabase PostgreSQL with Row-Level Security on every table, Supabase Auth
  (email/password, PKCE, cookie-based SSR via `@supabase/ssr`)
- **Media:** Cloudinary (signed direct uploads, delivery transformations, authenticated private
  assets)
- **Payments:** Razorpay Standard Checkout (test mode), server-priced carts, HMAC-verified webhooks
- **Rate limiting:** Upstash (distributed, not in-process)
- **Testing:** Vitest (unit/integration), Playwright (e2e)
- Runs on **port 3000** (`npm run dev`)

## Architecture

Next.js is the backend-for-frontend: browser mutations go through versioned Route Handlers under
`/api/v1`, and Server Components call the same server-only services directly rather than
self-fetching over HTTP.

**Trust boundaries** — the browser is never trusted with prices, roles, or permissions; the Next.js
server is the policy boundary (every mutation re-validates identity and permission, independent of
any middleware redirect); PostgreSQL is the final data boundary (RLS, constraints, transactions);
Supabase Auth owns credentials — no password hashes exist outside `auth.users`.

**Roles and permissions** — JWT role claims are attached by a Supabase Custom Access Token Hook and
checked by name (`requirePermission`), not by numeric role comparison:

| Role | Capability |
|---|---|
| `customer` | Public catalog/search, own profile, cart, wishlist |
| `catalog_manager` | Customer capabilities + category/product/content/media create, update, publish |
| `admin` | All catalog-manager permissions + role assignment, newsletter administration, audit access, system operations |

**Backend capabilities:**

- Supabase email/password authentication with PKCE callbacks, server-managed cookies, profile
  management, password recovery, and guest-cart claim after login.
- PostgreSQL catalog, categories, inventory, media metadata, carts, wishlists, newsletter, admin
  operations, orders, audit logs, idempotency, soft deletion, optimistic versions, indexes, RLS,
  and safe public views.
- Versioned Route Handler API under `/api/v1`, RFC 9457-style problem responses, request IDs,
  structured logs, validation, origin checks, and distributed rate limiting.
- Cloudinary signed direct uploads, optimized delivery transformations, authenticated private
  assets, server-side verification, reference checks, deletion retries, and cleanup jobs.
- Razorpay Standard Checkout with server-priced carts, inventory reservations, server-created
  provider orders, HMAC verification (`timingSafeEqual`), captured-payment confirmation, signed
  idempotent webhooks, and atomic order conversion.
- Double-opt-in newsletter lifecycle with a durable email outbox.

## Project layout

```text
app/            Route Handlers + pages, incl. api/v1 and api/internal
features/       Domain modules: auth, catalog, cart, checkout, admin, media, refunds, ...
components/     Shared UI (Header, Footer, ProductCard, cart drawer, ...)
lib/            Supabase clients, http/problem responses, observability, env validation
supabase/       migrations/, seed.sql, config.toml (local Supabase stack)
scripts/        bootstrap-admin.mjs
tests/          Vitest unit/integration tests
e2e/            Playwright end-to-end specs
```

## Local setup

Requirements: Node.js 20.9+, npm 10+, Docker Desktop (for local Supabase), Supabase CLI (via `npx`).

```powershell
npm install
Copy-Item .env.example .env.local
npx supabase start
npx supabase db reset
npm run dev
```

`supabase db reset` applies all migrations and `supabase/seed.sql`. Seeded products remain drafts
because Cloudinary assets differ by environment. Copy the local API URL, publishable key, and
secret/service key printed by the CLI into `.env.local`. Use unrelated random values of at least
32 bytes for `GUEST_CART_TOKEN_PEPPER`, `APP_HMAC_SECRET`, and `CRON_SECRET`.

### Supabase connection values

Both Next.js applications use the Supabase Data API through `supabase-js`. Set
`NEXT_PUBLIC_SUPABASE_URL` to the HTTPS Project URL shown in Supabase Settings > API. Never place a
`postgresql://` value in a `NEXT_PUBLIC_*` variable.

The runtime does not use a PostgreSQL connection string. For migrations or database tools, choose
the direct connection on port 5432 when the machine/network supports IPv6. On an IPv4-only network,
use the shared pooler in session mode on port 5432. Transaction mode on port 6543 is intended for
short-lived serverless SQL clients and is not used by this codebase.

## First administrator

After applying migrations, set `NEXT_PUBLIC_SUPABASE_URL`, `SUPABASE_SECRET_KEY`, and the
`ADMIN_BOOTSTRAP_*` values in the gitignored `.env.local`, then run:

```powershell
npm run bootstrap:admin
```

The idempotent command creates or updates that account, confirms its email, assigns the `admin`
role, and prints the real Supabase user UUID. Copy the UUID into `ADMIN_BOOTSTRAP_USER_ID` only if a
local record is useful. Remove the bootstrap password from the environment or rotate it after first
login.

Never expose a public "create first admin" route. For hosted Supabase, enable the Custom Access
Token Hook and select `public.custom_access_token_hook`; the matching local hook is configured in
`supabase/config.toml`.

## Cloudinary

Create a Cloudinary product environment and copy its cloud name, API key, and API secret into the
server-only variables in `.env.local`. Never add the API secret to the admin-panel environment or a
`NEXT_PUBLIC_*` variable. No unsigned upload preset is required.

Upload flow:

1. `POST /api/v1/admin/media/uploads` creates a pending row and returns a signed Cloudinary upload
   endpoint plus signed form fields.
2. The admin browser sends a multipart POST directly to Cloudinary. Public catalog media uses
   delivery type `upload`; order-customization media uses `authenticated`.
3. `POST /api/v1/admin/media/{mediaId}/complete` fetches trusted provider metadata, verifies public
   ID, delivery type, byte size, format, and dimensions, records the ETag/asset metadata, and marks
   the asset ready.
4. The admin attaches ready media and publishes the related record.

Public DTOs contain allow-listed Cloudinary URLs for 160px thumbnails, 800px cards, and 1200px
detail images with automatic quality and format selection. Authorized order staff receive expiring,
signed Cloudinary private-download URLs for authenticated customization images.

## Razorpay test checkout

Generate Test Mode API keys in Razorpay and place them in `.env.local`. Configure this test webhook
URL:

```text
https://your-public-store-host/api/v1/webhooks/razorpay
```

Subscribe to **all** of these events — the backend handles each one, and omitting any of them leaves
a recovery path dead:

| Event | Why it is needed |
|---|---|
| `payment.captured` | Primary path: creates the order. |
| `payment.authorized` | Captures explicitly when the account's auto-capture is off. Without it, uncaptured payments are auto-refunded by Razorpay days later. |
| `order.paid` | Redundant confirmation of a completed order. |
| `payment.failed` | Records the failed attempt (and frees stock once the reservation window closes). |
| `refund.processed`, `refund.failed` | Resolves refunds left `pending` by the Refunds API. |
| `payment.dispute.created`, `payment.dispute.won`, `payment.dispute.lost`, `payment.dispute.closed` | Chargebacks; each raises an alert. |

To rotate `RAZORPAY_WEBHOOK_SECRET` without dropping in-flight deliveries: set
`RAZORPAY_WEBHOOK_SECRET_PREVIOUS` to the old value and deploy, change the secret in the Razorpay
dashboard, then remove `RAZORPAY_WEBHOOK_SECRET_PREVIOUS` and deploy again. Both secrets are accepted
during the overlap.

Keep `RAZORPAY_MODE=test`; the backend rejects a live key in test mode. Automatic capture should also
be enabled in the Dashboard, but the backend no longer depends on it — `payment.authorized` triggers
an explicit capture call. The catalog operates in INR (Razorpay-India); prices, store settings,
shipping thresholds, and structured data are all INR.

## Transactional email (Resend)

Verify the domain `cherrydoodle.in` in the Resend dashboard (add its SPF and DKIM DNS records) and
set `RESEND_API_KEY` plus `EMAIL_FROM_ADDRESS`. All mail goes through the `email_outbox` table:
writers only insert rows, and `POST /api/internal/jobs/email-dispatch` delivers them with retry and
backoff. The order confirmation is inserted by `complete_razorpay_checkout` inside the same
transaction as the order, so an order can never exist without its confirmation being queued.

## API and scheduled jobs

- Public reads: `/api/v1/home`, `/categories`, `/products`, `/search`
- Auth/profile: `/api/v1/auth/*`, `/api/v1/me`
- Cart/wishlist: `/api/v1/cart/*`, `/api/v1/wishlist/*`
- Admin: `/api/v1/admin/*`
- Checkout: `/api/v1/checkout/razorpay/order`, `/api/v1/checkout/razorpay/verify`,
  `/api/v1/checkout/razorpay/cancel`, `/api/v1/webhooks/razorpay`
- Internal: `/api/internal/health`, `/api/internal/jobs/*`

Scheduled jobs are declared in `vercel.json` and authorized with
`Authorization: Bearer <CRON_SECRET>` (Vercel adds this header automatically when `CRON_SECRET` is
set on the project). Both `GET` and `POST` are accepted. On any other platform, schedule the same
four paths at the same cadence — **`checkout-cleanup` and `payment-reconciliation` are not optional**;
they are the only automated recovery for a checkout whose webhook and client callback were both lost.

| Job | Schedule | Purpose |
|---|---|---|
| `/api/internal/jobs/email-dispatch` | every minute | Delivers the `email_outbox` queue via Resend |
| `/api/internal/jobs/checkout-cleanup` | every 5 minutes | Expires lapsed reservations |
| `/api/internal/jobs/payment-reconciliation` | every 15 minutes | Recovers captures whose webhook *and* callback were lost |
| `/api/internal/jobs/media-cleanup` | every 15 minutes | Removes orphaned media |

## Scripts

| Script | Purpose |
|---|---|
| `npm run dev` | Start the dev server on port 3000 |
| `npm run build` | Production build |
| `npm run start` | Run the production build |
| `npm run lint` | ESLint |
| `npm run typecheck` | `tsc --noEmit` |
| `npm test` | Vitest unit/integration tests |
| `npm run test:watch` | Vitest in watch mode |
| `npm run test:e2e` | Playwright end-to-end tests |
| `npm run bootstrap:admin` | Create/update the first admin account |
| `npm run check` | lint + typecheck + test + build |

## Verification and deployment

```powershell
npm run check
npx supabase db lint --local
```

Supabase commands require Docker Desktop. Deploy this directory as the Vercel root, configure
`.env.example` values per environment, migrate staging before production, configure Auth redirect
URLs and the access-token hook, use separate Cloudinary product environments/credentials per
environment, restrict cron/payment webhook secrets, and enable Supabase point-in-time recovery plus
restore drills.
