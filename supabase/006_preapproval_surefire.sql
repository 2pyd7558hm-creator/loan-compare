-- Pre-approval letter desk: borrowers sent over from Surefire (supabase/functions/surefire-preapproval).
-- Run once in the Supabase SQL editor, after 005_preapproval.sql.
-- The function writes with the service role; staff see the rows through the policies in 005.
alter table public.preapproval_borrowers add column if not exists surefire_id text;
create unique index if not exists preapproval_borrowers_surefire_idx on public.preapproval_borrowers (surefire_id) where surefire_id is not null;
