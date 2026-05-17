-- Capability taxonomy — single source of truth for the classifier (Python)
-- and the dashboard (TypeScript). Before this migration the same 52 entries
-- lived in agent/src/capabilities.py AND dashboard/src/lib/capabilities.ts;
-- after this migration both files get deleted and the agent + dashboard
-- read from this table at runtime.
--
-- This is the lookup table the agent's classifier prompt references and
-- the dashboard's `capabilityLabel(id)` resolves against.

create table if not exists public.capability_registry (
  id text primary key,
  label text not null,
  automatable boolean not null default false,
  sort_order integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

drop trigger if exists capability_registry_touch_updated_at
  on public.capability_registry;
create trigger capability_registry_touch_updated_at
  before update on public.capability_registry
  for each row execute function public.touch_updated_at();

-- Public read — capability ids are part of the product vocabulary; not
-- per-business data. Both anon (agent activation) and authenticated
-- (dashboard) can read.
alter table public.capability_registry enable row level security;

drop policy if exists capability_registry_public_select on public.capability_registry;
create policy capability_registry_public_select on public.capability_registry
  for select to anon, authenticated
  using (true);

-- --- Seed ---------------------------------------------------------------
-- Upsert semantics so re-running the migration is safe and ids that get
-- added in future migrations don't get blown away.

insert into public.capability_registry (id, label, automatable, sort_order) values
  ('data.transfer.between_apps', 'Transfer data between apps', true, 1),
  ('data.entry.form_fill', 'Fill in a form or record', true, 2),
  ('data.entry.bulk', 'Bulk / repetitive data entry', true, 3),
  ('data.lookup.record', 'Look up a record by id or name', true, 4),
  ('data.lookup.reference', 'Consult a reference (price, policy)', true, 5),
  ('data.extract.document', 'Extract fields from a document', true, 6),
  ('data.aggregate', 'Sum, count, or summarize data', true, 7),
  ('data.transform.format', 'Reformat values (dates, names, etc)', true, 8),
  ('data.validate', 'Check data against rules', true, 9),
  ('data.dedupe', 'Identify or remove duplicates', true, 10),
  ('communication.send.email', 'Send an email', true, 11),
  ('communication.send.sms', 'Send a text/SMS', true, 12),
  ('communication.send.chat', 'Send a chat message', true, 13),
  ('communication.send.notification', 'Send a push/in-app notification', true, 14),
  ('communication.reply.routine', 'Reply to a routine inquiry', true, 15),
  ('communication.reply.custom', 'Compose a custom reply', false, 16),
  ('communication.triage.inbox', 'Sort or route incoming messages', true, 17),
  ('communication.call.outbound', 'Make an outbound phone call', false, 18),
  ('communication.call.inbound', 'Take an inbound phone call', false, 19),
  ('document.create', 'Create a new document', false, 20),
  ('document.template_fill', 'Fill a templated document', true, 21),
  ('document.review', 'Read or review a document', false, 22),
  ('document.sign', 'Sign a document', false, 23),
  ('document.convert', 'Convert a document format', true, 24),
  ('workflow.assign', 'Assign a task to a person/queue', true, 25),
  ('workflow.schedule', 'Place an item on a calendar', true, 26),
  ('workflow.approve', 'Approve or reject an item', false, 27),
  ('workflow.route', 'Route an item to the next step', true, 28),
  ('workflow.track_status', 'Check the status of an item', true, 29),
  ('workflow.escalate', 'Flag an exception or escalation', true, 30),
  ('search.contact', 'Look up a person''s contact info', true, 31),
  ('search.knowledge', 'Search documentation or policy', true, 32),
  ('search.web', 'General web search', false, 33),
  ('monitoring.check_routine', 'Periodically check a dashboard', true, 34),
  ('monitoring.alert_respond', 'Respond to an automated alert', true, 35),
  ('reporting.generate', 'Generate or compile a report', true, 36),
  ('reporting.review', 'Read or analyze a report', false, 37),
  ('meeting.attend', 'Actively attending a meeting/call', false, 38),
  ('meeting.prepare', 'Prepare materials for a meeting', false, 39),
  ('meeting.followup', 'Post-meeting notes / action items', true, 40),
  ('admin.invoice.create', 'Create an invoice or bill', true, 41),
  ('admin.invoice.process', 'Process incoming invoices', true, 42),
  ('admin.payroll.process', 'Payroll processing', true, 43),
  ('admin.timekeeping', 'Enter or review time/attendance', true, 44),
  ('admin.expense.entry', 'Submit or review expenses', true, 45),
  ('admin.compliance.check', 'Compliance review or attestation', true, 46),
  ('admin.onboarding', 'Onboarding tasks', true, 47),
  ('admin.offboarding', 'Offboarding tasks', true, 48),
  ('idle', 'No active work detected', false, 49),
  ('break', 'On break / away from desk', false, 50),
  ('personal', 'Personal activity (exclude)', false, 51),
  ('unknown', 'Cannot classify', false, 52)
on conflict (id) do update set
  label = excluded.label,
  automatable = excluded.automatable,
  sort_order = excluded.sort_order;
