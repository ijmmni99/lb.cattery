# L&B Cattery

This project now has a clear separation between:

- Public interface: [index.html](index.html)
- Administrator backend: [admin.html](admin.html)
- Customer portal: [user-login.html](user-login.html)

## What Admin Can Configure

From the admin backend, the system settings are stored in backend and used by the public page:

- Pricing per suite (nightly rates)
- Booking configuration (open/close booking, min/max nights)
- Add-on items (flat and nightly fee)
- Suites configuration (code, name, capacity, photo, active/inactive)

### Suite photos

Each suite can have an `imageUrl` set from the admin Suites panel. This can
be any publicly reachable image URL (e.g. hosted on Supabase Storage,
Imgur, etc.) or a relative path to a file committed under
[assets/](assets/) (e.g. `assets/standard-suite.jpg`). Suites without an
image fall back to a placeholder on the public booking form. There is no
built-in file uploader — paste a URL/path and the admin panel shows a live
preview thumbnail.

## Backend Requirements

### Environment variables (Cloudflare Pages -> Settings -> Variables and Secrets)

There are **no fallbacks** for secrets. If a required value is missing, the affected endpoints return
`500 {"error":"Server not configured"}` (fail closed). `SUPABASE_ANON_KEY` is no longer used by the server at all.

| Variable | Required | Purpose |
|---|---|---|
| `SUPABASE_URL` | yes | Supabase project URL |
| `SUPABASE_SERVICE_ROLE_KEY` | yes | Used server-side for every table read/write (enables RLS on the tables, see below) |
| `ADMIN_PASSWORD` | yes | Admin login password |
| `ADMIN_TOKEN_SECRET` | yes | Signs admin session tokens (use a long random string) |
| `USER_TOKEN_SECRET` | yes | Signs customer session tokens and password-reset tokens |
| `ADMIN_USERNAME` | no | Admin username, default `admin` |
| `ALLOWED_ORIGIN` | no | Value for `Access-Control-Allow-Origin`, e.g. `https://your-domain.com`. Defaults to the request's own origin (never `*`) |
| `LEGACY_PASSWORD_SECRET` | no | Only for upgrading old customer passwords. Old hashes were `SHA-256(password + "." + secret)`. If your deployment never set `USER_TOKEN_SECRET` and the old code fell back to the anon key, set this to that old anon key so those users can still log in once (they are re-hashed on that login). Defaults to `USER_TOKEN_SECRET` |
| `PBKDF2_ITERATIONS` | no | Default `100000`, the maximum Cloudflare Workers allow in production. Raise it only on a runtime that supports more (the stored hash records its own iteration count, so changing it later upgrades users on their next login) |
| `RESEND_API_KEY`, `RESEND_FROM_EMAIL` | no* | Booking and password-reset emails (*password reset needs `RESEND_API_KEY`) |
| `ADMIN_NOTIFY_EMAIL` | no | Receives new-booking and completed-stay emails |

`ADMIN_API_KEY` and the `x-admin-key` header are **removed**. Admin actions use the session token from `/api/admin-login`.

### Rate limiting (optional KV binding)

Create a KV namespace and bind it to the Pages project as **`RATE_LIMIT`**
(Settings -> Functions -> KV namespace bindings). When present, these routes allow 10 requests per
10 minutes per IP (`CF-Connecting-IP`) per route and then return `429` with `Retry-After`:
`admin-login`, `user-auth` (login and signup), `forgot-password`, `booking-lookup` and `POST /api/bookings`.
If the binding is absent, rate limiting is skipped silently. The counter is best-effort (KV is not atomic).

### Supabase migration

Run [supabase/migrations/001_security.sql](supabase/migrations/001_security.sql) in the Supabase SQL editor
**after** `SUPABASE_SERVICE_ROLE_KEY` is set in Cloudflare and the site is redeployed. It adds the columns the
functions use, indexes for the capacity check, and enables Row Level Security on `bookings`, `app_users` and
`system_config` so the anon key can no longer read them directly.

### Passwords

New passwords are stored as `pbkdf2$iterations$salt$hash` (PBKDF2-SHA256, 16-byte random salt per user).
Old single-round SHA-256 hashes keep working: on the next successful login they are verified the old way and
re-hashed with PBKDF2 automatically.

### Booking rules enforced on the server

`POST /api/bookings` ignores any `id`, `status` or `total_price` from the client. It generates the id
(`LB-` + 8 Crockford base32 characters), recalculates the price from `system_config`
([functions/api/_pricing.js](functions/api/_pricing.js)), and checks: bookings enabled, active suite and add-ons,
check-in not in the past (Asia/Kuala_Lumpur), min/max nights, and per-night capacity (cats in pending + confirmed
bookings plus the new cats must not exceed the suite capacity, otherwise `409`).

## Local development

```bash
cp /dev/null .dev.vars   # never commit this file (it is in .gitignore)
# add SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, ADMIN_PASSWORD, ADMIN_TOKEN_SECRET, USER_TOKEN_SECRET
npx wrangler pages dev . --kv RATE_LIMIT
```

## PWA and service worker

The site is installable (`manifest.webmanifest`, icons in `assets/icons`) and works offline through `sw.js`.
`/assets/*` is cached for a year (`_headers`), so **rename a file when you change an asset's content**.

**On every deploy that changes cached files (HTML, CSS, JS, fonts, icons), bump `CACHE_VERSION` at the top of
[sw.js](sw.js)** (for example `v1` -> `v2`). The new worker precaches the new files and deletes old
`lb-cattery-*` caches on activate. Without a bump, returning visitors keep seeing the old precached shell
until the stale-while-revalidate refresh lands.

## Site URL

`index.html`, `sitemap.xml` and `robots.txt` use `https://lbcattery.pages.dev` as the site URL. Replace it with
your real domain, for example: `grep -rl lbcattery.pages.dev . | xargs sed -i 's#https://lbcattery.pages.dev#https://your-domain.com#g'`.

## Supabase Table Setup

Create this table for backend configuration:

```sql
create table if not exists public.system_config (
	key text primary key,
	value jsonb not null,
	updated_at timestamptz default now()
);
```

Notes:

- The table itself cannot be auto-created using the anon key through REST API permissions.
- After the table exists, the app will auto-bootstrap the default `global` settings row on first load.

The API endpoint [functions/api/settings.js](functions/api/settings.js) stores all administrator-configured settings into key `global`.

Create this table for customer accounts:

```sql
create table if not exists public.app_users (
	id text primary key,
	full_name text not null,
	phone text,
	email text not null unique,
	password_hash text not null,
	created_at timestamptz default now()
);
```

### Bookings table: multiple cats and add-ons per booking

Bookings now store one **or more** cats and **zero or more** add-ons per
submission, instead of a single cat and a single add-on. This is modeled as
two `jsonb` columns:

- `cats jsonb` — array of `{ "name": "...", "breed": "...", "age": "..." }`
- `add_ons jsonb` — array of add-on codes, e.g. `["grooming", "playtime"]`

If your `bookings` table still has the old scalar columns (`cat_name`,
`breed`, `age`, `add_on`), run this migration in the Supabase SQL editor.
It adds the new columns and backfills them from the old ones so existing
rows keep displaying correctly; the old columns are left in place (unused
by the app going forward) so this is safe to run without downtime:

```sql
alter table public.bookings
	add column if not exists cats jsonb not null default '[]'::jsonb,
	add column if not exists add_ons jsonb not null default '[]'::jsonb;

update public.bookings
set cats = jsonb_build_array(jsonb_build_object('name', cat_name, 'breed', breed, 'age', age))
where cats = '[]'::jsonb and cat_name is not null and cat_name <> '';

update public.bookings
set add_ons = jsonb_build_array(add_on)
where add_ons = '[]'::jsonb and add_on is not null and add_on <> '' and add_on <> 'none';
```

If you are creating the `bookings` table from scratch, include `cats` and
`add_ons` from the start:

```sql
create table if not exists public.bookings (
	id text primary key,
	owner_name text not null,
	owner_email text not null,
	owner_phone text,
	cats jsonb not null default '[]'::jsonb,
	suite_type text not null,
	check_in date not null,
	check_out date not null,
	add_ons jsonb not null default '[]'::jsonb,
	total_price numeric not null default 0,
	notes text,
	created_at timestamptz default now()
);
```

## API Overview

- `GET /api/settings`: public read of current settings (suites, add-ons, booking rules, promos, contact WhatsApp number)
- `POST /api/settings`: admin-only write (admin token)
- `GET /api/bookings`: public availability only (`suite_type`, `check_in`, `check_out`, `cats` count, `status`; rejected/cancelled excluded)
- `GET /api/bookings?scope=admin`: admin-only full listing
- `POST /api/bookings`: public booking submission; returns `{ id, status, total_price }`
- `PATCH /api/bookings?id=...` / `DELETE /api/bookings?id=...`: admin-only
- `POST /api/admin-login`: admin login, returns session token; `GET` verifies a token (`x-admin-token` or `Authorization: Bearer`)
- `POST /api/user-auth`: customer signup/login (`action` = `signup` or `login`); `GET` verifies a token (`x-user-token`) and returns name, email and phone
- `POST /api/forgot-password`: password reset request/confirm
- `POST /api/booking-lookup`: look up one booking by ID and email
- `GET /api/user-bookings`: bookings for the signed-in customer's email

### Contact settings

Admin -> Contact stores `contact.whatsappNumber` (digits, international format, e.g. `60123456789`) in `system_config`.
When empty, all WhatsApp buttons are hidden.

### Cats and vaccination

Each entry in `bookings.cats` may include `vaccinated` (boolean) and `vaccinationDate` (`YYYY-MM-DD`). They are
optional and live inside the existing jsonb column, so no schema change is needed.
