-- ============================================================================
-- RUN THIS ONLY AFTER the new Pages Functions are deployed.
--
-- Why it is a separate, post-deploy step
-- --------------------------------------
-- The previous version of functions/api/bookings.js authenticated its GET and
-- POST handlers with SUPABASE_ANON_KEY, and booking-lookup.js did the same. The
-- new code routes every query through the service role key (see getRestAuth in
-- functions/api/_settings.js).
--
-- So anon access can only be revoked once the new code is live. Running this
-- against the old deployment breaks booking submission and the admin list.
--
-- What it fixes
-- -------------
-- public.bookings had RLS enabled but carried four policies granting the
-- public/anon role unrestricted SELECT, INSERT, UPDATE and DELETE, which made
-- RLS a no-op. Anyone holding the publishable anon key could read every
-- customer's name, email, phone and care notes, and alter or delete any
-- reservation -- bypassing the admin gate on /api/bookings entirely.
--
-- The UPDATE and DELETE grants have already been removed (nothing needed them).
-- This drops what remains.
-- ============================================================================

drop policy if exists "anon read"   on public.bookings;
drop policy if exists "anon insert" on public.bookings;
drop policy if exists "anon update" on public.bookings;
drop policy if exists "anon delete" on public.bookings;

revoke all on public.bookings from anon;

-- Verify: this must return NONE.
-- select coalesce(string_agg(privilege_type, ', '), 'NONE')
-- from information_schema.role_table_grants
-- where table_schema='public' and table_name='bookings' and grantee='anon';
