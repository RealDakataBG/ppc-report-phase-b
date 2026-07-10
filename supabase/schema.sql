-- ============================================================================
-- Phase B schema: tables + Row Level Security
-- Paste this whole file into Supabase's SQL Editor and run it once.
-- ============================================================================

-- ===== clients =====
-- One row per Amazon Ads client (Entity name from the Excel export,
-- Client name from the to-do Sheet).
create table public.clients (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  created_at timestamptz not null default now()
);
create unique index clients_name_lower_idx on public.clients (lower(trim(name)));

-- ===== profiles =====
-- One row per Supabase auth user. client_id is null for admins (agency staff).
create table public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  client_id uuid references public.clients(id),
  role text not null default 'client' check (role in ('client','admin')),
  email text,
  created_at timestamptz not null default now()
);

-- Auto-create a stub profile row whenever a new auth user is invited/created.
-- Without this, a freshly invited user would have no profiles row until someone
-- manually inserted one.
create function public.handle_new_user() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  insert into public.profiles (id, email) values (new.id, new.email);
  return new;
end;
$$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute procedure public.handle_new_user();

-- ===== performance_totals =====
-- The genuine imported "Total" row from the Excel (weighted TACOS etc.),
-- one row per client, replaced wholesale on every ingest.
-- Note: the client dashboard does NOT read this table directly - it always
-- recomputes totals from the (current-month-excluded) performance_monthly rows
-- instead, so the numbers shown stay internally consistent. This table is kept
-- as a faithful record of the real import for potential future use.
create table public.performance_totals (
  client_id uuid primary key references public.clients(id) on delete cascade,
  impressions bigint,
  clicks bigint,
  ctr numeric,
  orders integer,
  cr numeric,
  spend numeric(12,2),
  revenue numeric(12,2),
  acos numeric,
  tacos numeric,
  roas numeric,
  cpc numeric(10,2),
  cpo numeric(10,2),
  asp numeric(10,2),
  viewable_impressions bigint,
  vcpm numeric,
  updated_at timestamptz not null default now()
);

-- ===== performance_monthly =====
-- One row per client per month. month is stored as the first day of that
-- month (e.g. 2026-06-01), which is what lets the dashboard cleanly exclude
-- "the current month" via a simple date comparison.
create table public.performance_monthly (
  id uuid primary key default gen_random_uuid(),
  client_id uuid not null references public.clients(id) on delete cascade,
  month date not null,
  impressions bigint,
  clicks bigint,
  ctr numeric,
  orders integer,
  cr numeric,
  spend numeric(12,2),
  revenue numeric(12,2),
  acos numeric,
  tacos numeric,
  roas numeric,
  cpc numeric(10,2),
  cpo numeric(10,2),
  asp numeric(10,2),
  viewable_impressions bigint,
  vcpm numeric,
  updated_at timestamptz not null default now(),
  unique (client_id, month)
);

-- ===== todos =====
-- month is a bare English month name (e.g. "June"), no year - that's genuinely
-- all the to-do Sheet provides (columns B-M are just month names).
create table public.todos (
  id uuid primary key default gen_random_uuid(),
  client_id uuid not null references public.clients(id) on delete cascade,
  month text not null,
  task text not null,
  synced_at timestamptz not null default now()
);
create index todos_client_idx on public.todos (client_id);

-- ============================================================================
-- Row Level Security
-- ============================================================================

-- security definer helper functions - written this way specifically to avoid
-- the classic "a policy on profiles recursively queries profiles" trap.
create function public.current_profile_client_id() returns uuid
language sql security definer stable set search_path = public as $$
  select client_id from public.profiles where id = auth.uid()
$$;

create function public.is_admin() returns boolean
language sql security definer stable set search_path = public as $$
  select exists(select 1 from public.profiles where id = auth.uid() and role = 'admin')
$$;

alter table public.clients enable row level security;
alter table public.profiles enable row level security;
alter table public.performance_totals enable row level security;
alter table public.performance_monthly enable row level security;
alter table public.todos enable row level security;

create policy select_own_profile on public.profiles for select to authenticated
  using (id = auth.uid() or public.is_admin());

create policy select_clients on public.clients for select to authenticated
  using (public.is_admin() or id = public.current_profile_client_id());

create policy select_totals on public.performance_totals for select to authenticated
  using (public.is_admin() or client_id = public.current_profile_client_id());

create policy select_monthly on public.performance_monthly for select to authenticated
  using (public.is_admin() or client_id = public.current_profile_client_id());

create policy select_todos on public.todos for select to authenticated
  using (public.is_admin() or client_id = public.current_profile_client_id());

-- No INSERT/UPDATE/DELETE policies exist anywhere on purpose. Once RLS is
-- enabled, any command with no matching policy is denied by default for every
-- role except the table owner and roles with the bypassrls attribute - which
-- is exactly what the service_role key has. So all writes are fully blocked
-- from the browser with zero extra policy code; only the Netlify Functions
-- (using the service-role key) ever write to these tables.

-- Explicit grants: the project was created with "Automatically expose new
-- tables" turned off, so these tables need an explicit grant before any role
-- can touch them at all - this applies even to service_role. Its BYPASSRLS
-- attribute only skips *policy* checks; a plain table-level GRANT is a
-- separate, still-required permission layer underneath that.
grant usage on schema public to authenticated, service_role;
grant select on public.clients to authenticated;
grant select on public.profiles to authenticated;
grant select on public.performance_totals to authenticated;
grant select on public.performance_monthly to authenticated;
grant select on public.todos to authenticated;

-- service_role does all writes (via the Netlify Functions) and must be able
-- to read its own writes back too.
grant select, insert, update, delete on public.clients to service_role;
grant select, insert, update, delete on public.profiles to service_role;
grant select, insert, update, delete on public.performance_totals to service_role;
grant select, insert, update, delete on public.performance_monthly to service_role;
grant select, insert, update, delete on public.todos to service_role;
