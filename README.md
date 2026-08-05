# L&B Cattery

This project now has a clear separation between:

- Public interface: [index.html](index.html)
- Administrator backend: [admin.html](admin.html)

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
- `ADMIN_API_KEY` (optional; used for protected save/delete operations)

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

## API Overview

- `GET /api/settings`: public read of current settings
- `POST /api/settings`: admin-only write, requires header `x-admin-key`
- `GET /api/bookings`: public read bookings for availability calculations
- `POST /api/bookings`: public booking submission
- `DELETE /api/bookings?id=...`: admin-only delete, requires `x-admin-key`