-- Per-employee pause flag for the capture agent + a SECURITY DEFINER RPC
-- the agent can call with just its anon key (employees table is RLS-locked
-- for anon, so a direct SELECT would fail).

alter table public.employees
  add column if not exists is_paused boolean not null default false;

create or replace function public.is_employee_paused(employee_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(is_paused, false) from public.employees where id = employee_id;
$$;

grant execute on function public.is_employee_paused(uuid) to anon, authenticated;
