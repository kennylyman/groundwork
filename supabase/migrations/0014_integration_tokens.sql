-- OAuth foundation for native tool integrations.
--
-- Adds the columns every adapter needs:
--   - access_token_encrypted     : AES-256-GCM ciphertext (base64). Decrypts
--                                  to the API access token using
--                                  INTEGRATION_ENCRYPTION_KEY.
--   - refresh_token_encrypted    : Optional. Some providers (Google,
--                                  Microsoft, HubSpot) issue short-lived
--                                  access tokens with a separate long-lived
--                                  refresh token. Others (Slack bot tokens,
--                                  Stripe) don't expire — column stays null.
--   - token_scopes               : The scopes the user granted. Surfaced on
--                                  the settings page so we can flag a
--                                  re-auth if we add new scopes later.
--   - token_expires_at           : When the access token stops working.
--                                  NULL = doesn't expire (e.g., Slack bot).
--                                  The refresh cron only touches rows where
--                                  this is non-null AND nearing expiry.
--   - external_account_id        : The provider's account identifier
--                                  (Slack team id, HubSpot portal id, etc.).
--                                  Lets us detect re-OAuth into a different
--                                  account and disambiguate multi-tenant
--                                  setups later.
--   - external_account_label     : Human-readable account name shown on the
--                                  settings page ("Acme Co Slack").
--
-- These all live on the existing public.integrations table so adapters
-- share the same row that's already keyed by (business_id, tool_name, ring).

alter table public.integrations
  add column if not exists access_token_encrypted text,
  add column if not exists refresh_token_encrypted text,
  add column if not exists token_scopes text[],
  add column if not exists token_expires_at timestamptz,
  add column if not exists external_account_id text,
  add column if not exists external_account_label text;

-- Cron support index: refresh-tokens worker selects integrations whose
-- token_expires_at is in the next hour. Partial index keeps it small.
create index if not exists integrations_expiring_soon_idx
  on public.integrations (token_expires_at)
  where token_expires_at is not null and access_token_encrypted is not null;

-- --- capture_enrichments column ----------------------------------------
--
-- After classification, the enrichment cron looks up captures whose tool
-- (Slack, HubSpot, etc.) has an active OAuth connection for that business
-- and pulls live context — last 5 messages from the channel, current deal
-- stage for the contact, etc. Result lands here.
--
-- Schema is open (jsonb) so each adapter can choose its own shape; the
-- enrichment cron writes one top-level key per source (e.g., "slack":
-- { messages: [...] }, "hubspot": { contact: {...} }).

alter table public.captures
  add column if not exists capture_enrichments jsonb;

-- The enrichment cron query is "captures from the last 15 minutes that
-- have software set AND no enrichments yet". A partial index on the
-- pending set keeps this fast even as captures grow.
create index if not exists captures_enrichment_pending_idx
  on public.captures (business_id, captured_at desc)
  where capture_enrichments is null and software is not null;
