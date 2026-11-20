-- Client codes: a short number like TMC-1042 for each client, to match records in Surefire (and later Zaps).
-- Every comparison for the same client name shares one code. Run once in the Supabase SQL editor.
create sequence if not exists public.client_code_seq start with 1001;
grant usage on sequence public.client_code_seq to authenticated;

alter table public.comparisons
  add column if not exists client_code text not null default ('TMC-' || nextval('public.client_code_seq'));
create index if not exists comparisons_code_idx on public.comparisons (client_code);

-- Comparisons already saved for the same client get that client's first code
update public.comparisons c set client_code = f.code
from (select lower(client_name) as n, min(client_code) as code from public.comparisons group by 1) f
where lower(c.client_name) = f.n and c.client_code <> f.code;
