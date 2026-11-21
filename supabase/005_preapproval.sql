-- Pre-approval letters (preapproval.html). Run once in the Supabase SQL editor.
-- Staff only: the same people who can sign in to the workspace. Nothing here is visible to clients or the public.

-- Approved borrowers and their limits. Every letter is checked against these.
create table if not exists public.preapproval_borrowers (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  data jsonb not null,              -- loan type, max price, max loan, max LTV, term, rate, approval dates, document checklist
  updated_by uuid default auth.uid() references auth.users(id),
  updated_at timestamptz not null default now()
);
alter table public.preapproval_borrowers enable row level security;
create policy "staff read preapproval borrowers" on public.preapproval_borrowers
  for select to authenticated using (public.is_staff());
create policy "staff add preapproval borrowers" on public.preapproval_borrowers
  for insert to authenticated with check (public.is_staff());
create policy "staff update preapproval borrowers" on public.preapproval_borrowers
  for update to authenticated using (public.is_staff()) with check (public.is_staff());
create policy "staff delete preapproval borrowers" on public.preapproval_borrowers
  for delete to authenticated using (public.is_staff());
drop trigger if exists preapproval_borrowers_touch on public.preapproval_borrowers;
create trigger preapproval_borrowers_touch before update on public.preapproval_borrowers
  for each row execute function public.touch_updated_at();

-- Log of every letter created: kept for the file, never edited or deleted from the page.
create table if not exists public.preapproval_letters (
  id uuid primary key default gen_random_uuid(),
  data jsonb not null,              -- borrower, price, down, loan, LTV, letter and expiry dates
  created_by uuid not null default auth.uid() references auth.users(id),
  created_at timestamptz not null default now()
);
alter table public.preapproval_letters enable row level security;
create index if not exists preapproval_letters_created_idx on public.preapproval_letters (created_at desc);
create policy "staff read preapproval letters" on public.preapproval_letters
  for select to authenticated using (public.is_staff());
create policy "staff log preapproval letters" on public.preapproval_letters
  for insert to authenticated with check (public.is_staff() and created_by = auth.uid());

revoke all on public.preapproval_borrowers, public.preapproval_letters from anon;
grant select, insert, update, delete on public.preapproval_borrowers to authenticated;
grant select, insert on public.preapproval_letters to authenticated;
