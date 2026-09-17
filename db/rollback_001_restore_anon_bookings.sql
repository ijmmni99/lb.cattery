-- Emergency rollback for 001_post_deploy_revoke_anon_bookings.sql.
--
-- Restores exactly the access the OLD deployment needs (SELECT + INSERT).
-- It deliberately does NOT restore the old "anon update" / "anon delete"
-- policies: no code path ever needed them, and they allowed anyone with the
-- anon key to tamper with or destroy reservations.
--
-- Use this only to unblock a rollback to the previous Functions deployment.

grant select, insert on public.bookings to anon;

-- Postgres has no CREATE POLICY IF NOT EXISTS, so drop first to stay idempotent.
drop policy if exists "anon read" on public.bookings;
create policy "anon read" on public.bookings
  for select to public using (true);

drop policy if exists "anon insert" on public.bookings;
create policy "anon insert" on public.bookings
  for insert to public with check (true);
