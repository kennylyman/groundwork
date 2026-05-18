-- One-shot install enforcement on the per-employee install link.
--
-- Before this migration: anyone with a copy of /install/<token> could
-- download Groundwork.exe arbitrarily many times. Effectively a shared
-- link — if the employee forwarded their invite, multiple people could
-- install agents that all reported as the same "employee" in captures.
--
-- After: the binary download endpoint (/api/download/[token]) atomically
-- claims redemption by updating this column from null → now() inside a
-- conditional update. Only one request can win that race. The install
-- page detects the redeemed state on load and renders a "link used"
-- notice instead of the download button.
--
-- The agent contract is unaffected: install_token continues to work as
-- a long-lived bearer credential for /api/captures, heartbeats, and
-- config polls after redemption. Only the download page itself is gated.
--
-- Re-inviting: when an owner clicks "Send invite" for an employee whose
-- token is already redeemed, /api/send-invite rotates the install_token
-- and clears this column. The old agent (still using the old token)
-- will start getting 401s on captures — intentional cleanup signal for
-- the "employee got a new machine" use case this flow exists to handle.

alter table public.employees
  add column if not exists install_token_redeemed_at timestamptz null;

comment on column public.employees.install_token_redeemed_at is
  'Timestamp at which the install binary was served from /api/download/[token]. NULL means the install link is still redeemable. Cleared back to NULL (with a fresh install_token) when the owner re-invites a redeemed employee.';
