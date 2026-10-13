-- 001_security.sql
-- Run in the Supabase SQL editor. Not executed automatically.
--
-- ORDER OF OPERATIONS
--   1. Set SUPABASE_SERVICE_ROLE_KEY (and the other required secrets) in Cloudflare Pages and redeploy.
--   2. Run this file.
-- The functions now use the service-role key for every table access, so step 2 is safe once step 1 is done.
-- Running the RLS section before the service-role key is configured will make the site return errors.

-- ---------------------------------------------------------------------------
-- Columns the functions rely on (all idempotent)
-- ---------------------------------------------------------------------------
alter table public.bookings
  add column if not exists status text not null default 'pending',
  add column if not exists created_at timestamptz default now();

alter table public.app_users
  add column if not exists reset_token_hash text,
  add column if not exists reset_expires_at timestamptz;

-- password_hash is plain text, so no type change is needed. New hashes are stored as
--   pbkdf2$<iterations>$<salt>$<hash>
-- Legacy single-round SHA-256 hashes keep working and are re-hashed on the user's next successful login.
comment on column public.app_users.password_hash is
  'pbkdf2$iterations$salt$hash (legacy rows: base64url SHA-256, upgraded on next login)';

-- ---------------------------------------------------------------------------
-- Indexes for the capacity / availability queries
-- ---------------------------------------------------------------------------
create index if not exists bookings_suite_dates_idx
  on public.bookings (suite_type, check_in, check_out);
create index if not exists bookings_owner_email_idx
  on public.bookings (owner_email);
create index if not exists bookings_status_idx
  on public.bookings (status);
create index if not exists app_users_reset_token_hash_idx
  on public.app_users (reset_token_hash)
  where reset_token_hash is not null;

-- ---------------------------------------------------------------------------
-- Row Level Security: the anon key must not be able to read or write these tables directly.
-- With RLS enabled and no policies, only the service-role key (used server-side) can access them.
-- ---------------------------------------------------------------------------
alter table public.bookings      enable row level security;
alter table public.app_users     enable row level security;
alter table public.system_config enable row level security;

revoke all on public.bookings      from anon, authenticated;
revoke all on public.app_users     from anon, authenticated;
revoke all on public.system_config from anon, authenticated;
