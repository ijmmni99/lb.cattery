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

Environment variables:

- `SUPABASE_URL`
- `SUPABASE_ANON_KEY`
- `SUPABASE_SERVICE_ROLE_KEY` (recommended for backend function table access)
- `ADMIN_API_KEY` (optional; used for protected save/delete operations)
- `ADMIN_USERNAME` (optional, default: `admin`)
- `ADMIN_PASSWORD` (recommended; if missing, fallback uses `ADMIN_API_KEY` then `SUPABASE_ANON_KEY`)
- `ADMIN_TOKEN_SECRET` (optional; secret for signing admin session tokens)
- `USER_TOKEN_SECRET` (optional; secret for signing customer session tokens)

If `ADMIN_API_KEY` is not set, the backend will automatically use `SUPABASE_ANON_KEY` as the admin key fallback.

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
	reset_token_hash text,
	reset_expires_at timestamptz,
	created_at timestamptz default now()
);
```

`reset_token_hash` and `reset_expires_at` are required by
[functions/api/forgot-password.js](functions/api/forgot-password.js). If your
table predates password resets, add them:

```sql
alter table public.app_users
	add column if not exists reset_token_hash text,
	add column if not exists reset_expires_at timestamptz;
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
	status text not null default 'pending',
	created_at timestamptz default now()
);

create index if not exists bookings_range_idx
	on public.bookings (suite_type, check_in, check_out);
```

`status` drives the admin approval workflow (`pending` -> `confirmed` ->
`completed`, or `pending` -> `rejected`) and is required. Existing tables need:

```sql
alter table public.bookings
	add column if not exists status text not null default 'pending';
```

## API Overview

- `GET /api/availability`: **public** occupancy feed for the availability checker
  and calendar. Returns only `{ suiteType, checkIn, checkOut, cats }` per occupied
  stay — no names, emails, phone numbers or notes. Accepts optional `from` and
  `to` (`YYYY-MM-DD`) to narrow the window.
- `GET /api/settings`: public read of current settings
- `POST /api/settings`: admin-only write
- `GET /api/bookings`: **admin-only** read of full booking records
- `POST /api/bookings`: public booking submission (see below)
- `PATCH /api/bookings?id=...`: admin-only status change
- `DELETE /api/bookings?id=...`: admin-only delete
- `POST /api/admin-login`: admin login with username/password, returns session token
- `GET /api/admin-login`: verifies admin session token (`x-admin-token` or `Authorization: Bearer <token>`)
- `POST /api/user-auth`: customer signup/login (`action` = `signup` or `login`)
- `GET /api/user-auth`: verifies customer session token (`x-user-token`)
- `GET /api/user-bookings`: returns only bookings that match signed-in user email
- `POST /api/booking-lookup`: guest lookup by booking ID + email
- `POST /api/forgot-password`: password reset request/confirm

Note: `x-admin-key` is still accepted for backward compatibility, but admin login/session token is now the recommended flow.

## How a booking is validated

`POST /api/bookings` is the authority on every booking rule. The browser runs the
same checks first so the customer gets immediate feedback, but nothing the client
sends is trusted:

- The **booking ID** is generated server-side (`LB-` + 8 random characters). The
  client cannot choose it.
- The **total price** is recomputed from stored settings; `total_price` sent by
  the client is discarded.
- The **status** is always forced to `pending`.
- Only known columns are written — extra fields in the request body are dropped.
- **Stay length** is checked against `minNights`/`maxNights`, and check-out must
  be after check-in.
- The **suite and add-ons** must exist and be active.
- **Capacity** is checked in cat slots (see below) against bookings whose status
  is `pending`, `confirmed` or `completed`. Rejected bookings do not block dates.
- Submissions are refused entirely when `allowPublicBooking` is off.

Rule violations return `409` with a human-readable `error`; malformed payloads
return `400`.

### Capacity is measured in cats

A suite's `capacity` is the number of **cat slots** it holds, not the number of
bookings. This matches pricing, which is `nightlyRate x nights x number of cats`.
A Standard Suite with `capacity: 6` accepts any combination of bookings totalling
six cats on a given night.

### Known limitation: concurrent booking race

The capacity check reads current occupancy and then inserts. Two submissions for
the last slot that arrive within milliseconds of each other can both pass. Closing
this properly needs a database-level constraint, for example:

```sql
create extension if not exists btree_gist;

alter table public.bookings
	add constraint bookings_no_overbooking
	exclude using gist (
		suite_type with =,
		daterange(check_in, check_out) with &&
	) where (status in ('pending', 'confirmed', 'completed'));
```

Note that a plain exclusion constraint enforces *one booking per suite per range*,
which is stricter than the cat-slot model. If you want true multi-cat capacity
enforced in the database, use a serializable transaction or an advisory lock
around the check-and-insert instead.

## Security notes

- **Row Level Security.** The Pages Functions use the service role key and are the
  only intended path to the data. Enable RLS on `public.bookings`, `public.app_users`
  and `public.system_config` so the anon key cannot read these tables directly
  through the Supabase REST endpoint.
- **Static security headers** are set in [_headers](_headers), including a
  Content-Security-Policy, `X-Frame-Options` and `Referrer-Policy`.
- Database errors are logged server-side and never returned to the browser.

## Tests

```
npm test
```

Runs the rule and endpoint tests in [tests/](tests/) with the built-in Node test
runner (Node 18+). No dependencies to install.