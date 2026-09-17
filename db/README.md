# Database migrations

Applied by hand in the Supabase SQL editor; there is no migration runner.

## Already applied to the live project

| Migration | State |
| --- | --- |
| `revoke_anon_access_to_bookings` | **Partially rolled back.** The `anon` UPDATE and DELETE grants and policies on `public.bookings` are gone for good. `bookings_suite_range_idx` was created. |
| `restore_minimal_anon_access_pending_deploy` | Applied. `anon` retains SELECT + INSERT on `public.bookings` **only** because the currently deployed Functions still use the anon key for those two operations. |

Current `anon` privileges on `public.bookings`: `SELECT, INSERT`.

## Outstanding

`001_post_deploy_revoke_anon_bookings.sql` — **run immediately after deploying**
the new Functions. Until it runs, anyone holding the publishable anon key can
still read every booking's customer name, email, phone and notes directly
through the Supabase REST endpoint.

Deploy order matters:

1. Deploy the new Functions (they use the service role key for every query).
2. Confirm the site loads, a booking can be submitted, and the admin list works.
3. Run `001_post_deploy_revoke_anon_bookings.sql`.
4. Re-confirm the same three things.

If step 4 fails, run `rollback_001_restore_anon_bookings.sql` and investigate.

## Required environment

`SUPABASE_SERVICE_ROLE_KEY` **must** be set on the Pages project. Without it
`getRestAuth()` falls back to the anon key, which after step 3 has no access at
all — every endpoint would fail. It is already set on the live project; do not
remove it.
