-- Calculator hub: one saved client can hold several calculators ("tabs") in comparisons.data:
--   { "v": 2, "active": "<tab id>", "calcs": [ { "id", "kind", "title", "shared", "data" }, ... ] }
-- Older rows still hold a single loan comparison and are read as one tab, so no data needs to move.
--
-- This replaces the client-link function so tabs marked hidden ("shared": false) never leave the database.
-- Safe to run more than once. Undo: run the get_shared_comparison definition from 001_schema.sql again.
create or replace function public.get_shared_comparison(token uuid)
returns table (client_name text, title text, data jsonb, updated_at timestamptz)
language sql stable security definer set search_path = public as $$
  select c.client_name, c.title,
    case when jsonb_typeof(c.data -> 'calcs') = 'array'
      then jsonb_set(c.data, '{calcs}', coalesce(
        (select jsonb_agg(t) from jsonb_array_elements(c.data -> 'calcs') t
          where coalesce((t ->> 'shared')::boolean, true)), '[]'::jsonb))
      else c.data end,
    c.updated_at
  from public.comparisons c
  where c.share_token = token and c.shared = true;
$$;
revoke all on function public.get_shared_comparison(uuid) from public;
grant execute on function public.get_shared_comparison(uuid) to anon, authenticated;
