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

### Required

These have **no fallback**. If any is missing the affected endpoints return 500
and log the reason. Earlier versions fell back to `SUPABASE_ANON_KEY`, which is a
*publishable* credential — anyone holding it could sign admin tokens or log in as
the administrator.

| Variable | Purpose |
| --- | --- |
| `SUPABASE_URL` | Supabase project URL |
| `SUPABASE_ANON_KEY` | Supabase anon key |
| `ADMIN_TOKEN_SECRET` | Signs admin session tokens |
| `ADMIN_PASSWORD` | The administrator password |
| `USER_TOKEN_SECRET` | Signs customer session tokens and password-reset tokens |

Generate the two secrets with, for example:

```
openssl rand -base64 48
```

### Recommended

| Variable | Purpose |
| --- | --- |
| `SUPABASE_SERVICE_ROLE_KEY` | Lets the functions read/write tables with RLS enabled |
| `RESEND_API_KEY` | Transactional email; without it, emails are silently skipped |
| `RESEND_FROM_EMAIL` | Sender address for those emails |
| `ADMIN_NOTIFY_EMAIL` | Where new-booking notifications are sent |

### Optional

| Variable | Purpose |
| --- | --- |
| `ADMIN_USERNAME` | Defaults to `admin` |
| `ADMIN_API_KEY` | Legacy `x-admin-key` header. Must now be set explicitly to work |
| `ALLOWED_ORIGINS` | Comma-separated extra origins allowed to call the API. The deployment's own origin is always allowed |
| `PASSWORD_HASH_ITERATIONS` | PBKDF2 iterations, default `210000`. Lower it only if you hit a Workers CPU limit |
| `LEGACY_PASSWORD_SECRET` | See the upgrade note below |

### Rate limiting (KV binding)

Login, signup, password reset, booking lookup and booking submission are rate
limited per IP. Bind a Workers KV namespace named `RATE_LIMIT` so the counters
are shared across isolates:

```
npx wrangler kv namespace create RATE_LIMIT
```

then add the binding in the Pages project settings. **Without the binding the
limiter still runs but keeps counts in each isolate's memory**, so a distributed
attacker gets a higher effective ceiling. It is a mitigation, not a wall.

## Upgrading an existing deployment

Read this before deploying — three things change behaviour.

**0. Deploy the Functions BEFORE locking down the database.** The previous
Functions authenticated some queries with the anon key; the new ones use the
service role key throughout. `db/001_post_deploy_revoke_anon_bookings.sql`
removes anon access to `public.bookings` and must therefore run *after* the
deploy, not before. See [db/README.md](db/README.md) for the exact order and the
rollback script.

**1. Everyone is signed out once.** Session tokens are now HMAC-signed rather
than using the previous `SHA-256(payload + secret)` construction, so existing
admin and customer tokens stop validating. Users simply sign in again.

**2. Customer passwords keep working.** Stored passwords were an unsalted
`SHA-256(password + secret)`. They are now PBKDF2-HMAC-SHA256 with a per-user
random salt. Existing hashes are still accepted and are **transparently rewritten
in the new format on the next successful login** — nobody has to reset anything.

The one case that needs attention: if you previously had `USER_TOKEN_SECRET` set
and you change its value now, old hashes can no longer be verified. Put the
**previous** value in `LEGACY_PASSWORD_SECRET` so they still resolve and upgrade:

```
LEGACY_PASSWORD_SECRET=<the old USER_TOKEN_SECRET>
```

If you never set `USER_TOKEN_SECRET` before, no action is needed — the old hashes
were keyed to `SUPABASE_ANON_KEY` and that is tried automatically.

New PBKDF2 hashes do not depend on any environment secret, so this class of
problem cannot recur: rotating token secrets will never again risk locking
customers out.

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
- `GET /api/health`: configuration self-check. Returns 200 when every required
  variable is present, 503 listing which are missing. Reports presence only,
  never values. Use it to verify a deploy.
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

> **Check your capacity numbers against this model.** The previous code counted
> *bookings* against `capacity`, so a suite with `capacity: 3` accepted three
> bookings of any size. Under the cat-slot model the same number means three
> cats. Any suite whose configured capacity is lower than the most cats it has
> actually held at once will start refusing bookings it used to accept, and will
> show those dates as full in the calendar. Review the values in Admin → Suites
> before or immediately after deploying.

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
- **Passwords** are PBKDF2-HMAC-SHA256, 210,000 iterations, with a per-user random
  salt. The algorithm, iteration count and salt are stored alongside each hash, so
  the cost can be raised later without invalidating existing passwords.
- **Session tokens** are HMAC-SHA256 signed and compared in constant time, as is
  the administrator password.
- **CORS** is same-origin by default. No endpoint sends
  `Access-Control-Allow-Origin: *`; add extra origins via `ALLOWED_ORIGINS`.
- **Rate limiting** covers login, signup, password reset, booking lookup and
  booking submission. Bind the `RATE_LIMIT` KV namespace in production.
- **Static security headers** are set in [_headers](_headers), including a
  Content-Security-Policy, `X-Frame-Options` and `Referrer-Policy`.
- Database errors are logged server-side and never returned to the browser.

### Still outstanding

These are known and deliberately not yet addressed:

- Session tokens are held in `localStorage`, so an XSS bug would expose them, and
  they cannot be revoked before their 12-hour expiry. Moving to `httpOnly`
  cookies plus a server-side revocation list is the fix.
- There is a single administrator identity defined by environment variable, with
  no per-admin accounts, roles, audit log or 2FA.
- The concurrent-booking race described above.

## Tests

```
npm test
```

Runs the rule and endpoint tests in [tests/](tests/) with the built-in Node test
runner (Node 18+). No dependencies to install.