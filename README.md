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
- Suites configuration (code, name, capacity, active/inactive)

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

- `GET /api/settings`: public read of current settings
- `POST /api/settings`: admin-only write, requires header `x-admin-key`
- `GET /api/bookings`: public read bookings for availability calculations
- `POST /api/bookings`: public booking submission
- `DELETE /api/bookings?id=...`: admin-only delete, requires `x-admin-key`
- `POST /api/admin-login`: admin login with username/password, returns session token
- `GET /api/admin-login`: verifies admin session token (`x-admin-token` or `Authorization: Bearer <token>`)
- `POST /api/user-auth`: customer signup/login (`action` = `signup` or `login`)
- `GET /api/user-auth`: verifies customer session token (`x-user-token`)
- `GET /api/user-bookings`: returns only bookings that match signed-in user email

Note: `x-admin-key` is still accepted for backward compatibility, but admin login/session token is now the recommended flow.