-- Employees must acknowledge the data-collection disclosure on the install
-- page before they can download Groundwork. Stamped once and preserved.

alter table public.employees
  add column if not exists terms_accepted_at timestamptz;
