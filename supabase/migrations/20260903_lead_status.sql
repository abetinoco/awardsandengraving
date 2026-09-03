-- ============================================================================
-- Awards & Engraving — lead status (conversion tracking)
--
-- Adds a simple pipeline to each quote request so the shop can track which
-- leads converted, right in the admin's "Quote requests" screen. No new table
-- or screen — just a status column the admin sets from a dropdown.
--
--   new       — just came in (default for every website submission)
--   contacted — the shop has reached out / quoted
--   won       — converted into a paying job
--   lost      — didn't go anywhere
-- ============================================================================

alter table public.leads
  add column if not exists status text not null default 'new';

alter table public.leads
  add column if not exists status_updated_at timestamptz;

do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'leads_status_check') then
    alter table public.leads
      add constraint leads_status_check check (status in ('new','contacted','won','lost'));
  end if;
end $$;

create index if not exists leads_status_idx on public.leads (status);

-- The admin (authenticated) must be able to update a lead's status. Insert stays
-- open to anon (the website form); reads and writes remain authenticated-only.
alter table public.leads enable row level security;
drop policy if exists "leads admin update" on public.leads;
create policy "leads admin update" on public.leads
  for update to authenticated using (true) with check (true);
