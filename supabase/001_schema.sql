-- That Mortgage Couple: saved loan comparisons
-- Staff (loan officers) sign in and can see and edit the team's comparisons.
-- Clients never sign in: they open a private link that shows one comparison, read only,
-- and only while the loan officer has sharing turned on.

-- Who counts as staff. Add a row per loan officer after inviting them in Authentication.
create table if not exists public.staff (
  user_id uuid primary key references auth.users(id) on delete cascade,
  display_name text,
  nmls text,
  created_at timestamptz not null default now()
);
alter table public.staff enable row level security;

create or replace function public.is_staff()
returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.staff where user_id = auth.uid());
$$;

create policy "staff can read staff list" on public.staff
  for select to authenticated using (public.is_staff());

-- Saved comparisons
create table if not exists public.comparisons (
  id uuid primary key default gen_random_uuid(),
  owner uuid not null default auth.uid() references auth.users(id),
  client_name text not null,
  client_email text,
  title text,
  notes text,
  data jsonb not null,               -- home inputs + 2-4 loan options, exactly as the tool uses them
  share_token uuid not null unique default gen_random_uuid(),
  shared boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
alter table public.comparisons enable row level security;
create index if not exists comparisons_client_idx on public.comparisons (lower(client_name));
create index if not exists comparisons_updated_idx on public.comparisons (updated_at desc);

create policy "staff read comparisons" on public.comparisons
  for select to authenticated using (public.is_staff());
create policy "staff create comparisons" on public.comparisons
  for insert to authenticated with check (public.is_staff() and owner = auth.uid());
create policy "staff update comparisons" on public.comparisons
  for update to authenticated using (public.is_staff()) with check (public.is_staff());
create policy "staff delete comparisons" on public.comparisons
  for delete to authenticated using (public.is_staff());

create or replace function public.touch_updated_at()
returns trigger language plpgsql as $$
begin new.updated_at = now(); return new; end; $$;
drop trigger if exists comparisons_touch on public.comparisons;
create trigger comparisons_touch before update on public.comparisons
  for each row execute function public.touch_updated_at();

-- Client link: returns one shared comparison by its secret token. No email or notes go to the client.
create or replace function public.get_shared_comparison(token uuid)
returns table (client_name text, title text, data jsonb, updated_at timestamptz)
language sql stable security definer set search_path = public as $$
  select c.client_name, c.title, c.data, c.updated_at
  from public.comparisons c
  where c.share_token = token and c.shared = true;
$$;

-- Access grants (new tables are not exposed automatically in this project)
revoke all on public.comparisons, public.staff from anon;
grant select, insert, update, delete on public.comparisons to authenticated;
grant select on public.staff to authenticated;
revoke all on function public.get_shared_comparison(uuid) from public;
grant execute on function public.get_shared_comparison(uuid) to anon, authenticated;
grant execute on function public.is_staff() to authenticated;
