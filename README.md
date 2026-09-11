# Mconsulting

Realtime consulting studio website built with Express, EJS, and Supabase.

## Run locally

```bash
npm install
npm run dev
```

Open http://localhost:3000.

## Admin panel

Open http://localhost:3000/admin and sign in with `ADMIN_PASSWORD` from `.env`.
Set a strong `ADMIN_PASSWORD` and `SESSION_SECRET` before deploying. The admin panel supports request search, status changes, and realtime updates.

## Supabase setup

1. Create a Supabase project.
2. Run `schema.sql` in the SQL editor. This creates the booking store `public.requests`, the activity history `public.activities`, backfills activity entries for existing bookings, and adds both tables to the `supabase_realtime` publication.
3. Copy `.env.example` to `.env` and add `SUPABASE_URL` and `SUPABASE_ANON_KEY`.
4. Enable Realtime for the `requests` and `activities` tables in Supabase.

Without Supabase credentials, the app uses a local in-memory request store so the UI remains runnable.

Check the live connection and table readiness at http://localhost:3000/api/health. Realtime is ready only when the response contains `"connected": true`, `"realtime": true`, and `"table": "requests"`.
