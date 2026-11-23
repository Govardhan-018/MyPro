-- 0021_google_oauth_config.sql — put the Google OAuth app credentials in the
-- app, not the Render dashboard.
--
-- You still register the OAuth app once in Google Cloud Console (Google issues
-- the client id/secret), but the resulting credentials can now be pasted into
-- Settings → Mail instead of set as Render env vars. The **client secret is
-- encrypted at rest** (AES-256-GCM, the same scheme as the Gmail tokens; the
-- key `TOKEN_ENCRYPTION_KEY` lives only on Render), and it is **write-only** —
-- the API never returns it, you replace it by deleting and re-entering.
--
-- Access is brokered entirely by Render with the service key; clients never
-- read this table. So RLS is forced with *no* policies — every client role is
-- denied, and only the service role (Render) can touch it. Belt and braces for
-- the one secret in here.
--
-- Apply by hand in the Supabase SQL editor. Safe to re-run.

create table if not exists google_oauth_config (
  user_id           uuid primary key references profiles(user_id) on delete cascade,
  client_id         text not null,
  client_secret_enc text not null,   -- bytea hex literal from CryptoService
  redirect_uri      text not null,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now()
);

alter table google_oauth_config enable row level security;
alter table google_oauth_config force row level security;
-- No policies on purpose: deny every client role; Render's service key bypasses
-- RLS and is the only thing that reads or writes this row.
