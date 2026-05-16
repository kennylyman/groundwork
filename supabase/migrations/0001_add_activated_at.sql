alter table public.employees
  add column if not exists activated_at timestamptz;

create index if not exists employees_install_token_idx
  on public.employees (install_token);
