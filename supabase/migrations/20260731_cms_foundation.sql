-- ============================================================================
-- Awards & Engraving — CMS foundation
--
-- Model follows the Patrick Manning integration pattern (static HTML pages
-- hydrated from a key/value table) with the Highview admin feature set layered
-- on: activity log, one-step version restore, hide-instead-of-delete, ordered
-- lists, media library with alt text, and SEO per page.
--
-- Guiding rule from the Highview spec: "the admin never lies". Every editable
-- field the panel shows must be a field the public site actually reads, and a
-- missing row must fall back to the static copy rather than render blank.
-- ============================================================================

-- ---------------------------------------------------------------- helpers ---
create or replace function public.set_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end $$;

-- Keeps one prior value per row so the admin can offer "Restore previous
-- version" without a full history table. Cheap insurance against the
-- "I broke it, put it back" call.
create or replace function public.keep_previous_value()
returns trigger language plpgsql as $$
begin
  if new.value is distinct from old.value then
    new.previous_value = old.value;
  end if;
  return new;
end $$;

-- =========================================================== site_content ===
-- One row per editable field. `key` matches a data-ae-field attribute in the
-- HTML. Missing keys leave the static markup untouched, so a partially filled
-- table is always safe to ship.
create table if not exists public.site_content (
  key            text primary key,
  value          text,
  previous_value text,
  updated_at     timestamptz not null default now(),
  updated_by     text
);

drop trigger if exists site_content_set_updated_at on public.site_content;
create trigger site_content_set_updated_at
  before update on public.site_content
  for each row execute function public.set_updated_at();

drop trigger if exists site_content_keep_previous on public.site_content;
create trigger site_content_keep_previous
  before update on public.site_content
  for each row execute function public.keep_previous_value();

-- ================================================================ reviews ===
-- Seeded from the 13 Google reviews currently hardcoded on the site.
-- `featured` drives the two large cards; the rest fill the wall.
create table if not exists public.reviews (
  id          uuid primary key default gen_random_uuid(),
  author      text not null,
  meta        text,                                   -- "2 months ago · Google"
  body        text not null,
  rating      int  not null default 5 check (rating between 1 and 5),
  avatar_hex  text,                                   -- initial-bubble colour
  featured    boolean not null default false,
  visible     boolean not null default true,          -- hide instead of delete
  order_index int not null default 0,
  updated_at  timestamptz not null default now()
);

create index if not exists reviews_order_idx on public.reviews (order_index, id);

drop trigger if exists reviews_set_updated_at on public.reviews;
create trigger reviews_set_updated_at
  before update on public.reviews
  for each row execute function public.set_updated_at();

-- ================================================================== media ===
-- Uploaded photo library. Alt text lives with the file so it follows the image
-- wherever it is used, rather than being retyped per slot.
create table if not exists public.media (
  id         uuid primary key default gen_random_uuid(),
  path       text not null unique,        -- storage object path
  url        text not null,               -- public URL
  alt        text,
  width      int,
  height     int,
  bytes      int,
  created_at timestamptz not null default now(),
  created_by text
);

create index if not exists media_created_idx on public.media (created_at desc);

-- ============================================================== page_meta ===
-- SEO title/description per page. Blank falls back to the static <title>.
create table if not exists public.page_meta (
  path        text primary key,           -- '/', '/services', …
  title       text,
  description text,
  og_image    text,
  updated_at  timestamptz not null default now()
);

drop trigger if exists page_meta_set_updated_at on public.page_meta;
create trigger page_meta_set_updated_at
  before update on public.page_meta
  for each row execute function public.set_updated_at();

-- ========================================================= site_activity ====
-- Logins and content changes. Powers the dashboard "Recent changes" feed and
-- answers "did my edit go through?" permanently. before/after are stored for
-- text edits so a change can be read at a glance.
create table if not exists public.site_activity (
  id          bigint generated always as identity primary key,
  actor       text,                       -- email of the signed-in user
  action      text not null,              -- login | logout | saved | created | deleted | hidden | shown | restored | uploaded
  target      text,                       -- human label, e.g. 'Homepage — hero headline'
  detail      text,                       -- optional plain-language note
  before_text text,
  after_text  text,
  created_at  timestamptz not null default now()
);

create index if not exists site_activity_created_idx on public.site_activity (created_at desc);

-- ================================================================== leads ===
-- Quote-form submissions. Captured here in addition to the Resend email so
-- nothing is lost if a mail send fails, and so the shop has a searchable list.
create table if not exists public.leads (
  id         uuid primary key default gen_random_uuid(),
  name       text not null,
  email      text not null,
  phone      text,
  interest   text,                        -- the "What do you need?" select
  message    text,
  source     text,                        -- 'website-contact'
  page_path  text,
  status     text not null default 'new', -- new | read | replied | archived
  created_at timestamptz not null default now()
);

create index if not exists leads_created_idx on public.leads (created_at desc);
create index if not exists leads_status_idx  on public.leads (status);

-- ================================================== row level security ======
alter table public.site_content  enable row level security;
alter table public.reviews       enable row level security;
alter table public.media         enable row level security;
alter table public.page_meta     enable row level security;
alter table public.site_activity enable row level security;
alter table public.leads         enable row level security;

-- Public site reads content with the anon key. Only signed-in admins write.
drop policy if exists "site_content public read" on public.site_content;
create policy "site_content public read" on public.site_content
  for select using (true);
drop policy if exists "site_content admin write" on public.site_content;
create policy "site_content admin write" on public.site_content
  for all to authenticated using (true) with check (true);

-- Only visible reviews are readable publicly; admins see everything.
drop policy if exists "reviews public read" on public.reviews;
create policy "reviews public read" on public.reviews
  for select using (visible = true);
drop policy if exists "reviews admin read" on public.reviews;
create policy "reviews admin read" on public.reviews
  for select to authenticated using (true);
drop policy if exists "reviews admin write" on public.reviews;
create policy "reviews admin write" on public.reviews
  for all to authenticated using (true) with check (true);

drop policy if exists "media public read" on public.media;
create policy "media public read" on public.media
  for select using (true);
drop policy if exists "media admin write" on public.media;
create policy "media admin write" on public.media
  for all to authenticated using (true) with check (true);

drop policy if exists "page_meta public read" on public.page_meta;
create policy "page_meta public read" on public.page_meta
  for select using (true);
drop policy if exists "page_meta admin write" on public.page_meta;
create policy "page_meta admin write" on public.page_meta
  for all to authenticated using (true) with check (true);

-- Activity log is admin-only in both directions — it is not public information.
drop policy if exists "activity admin all" on public.site_activity;
create policy "activity admin all" on public.site_activity
  for all to authenticated using (true) with check (true);

-- Leads: anyone may submit, nobody may read without signing in. This is what
-- lets the public quote form insert with the anon key while keeping customer
-- details private — no service-role key is needed anywhere in the browser.
drop policy if exists "leads public insert" on public.leads;
create policy "leads public insert" on public.leads
  for insert with check (true);
drop policy if exists "leads admin read" on public.leads;
create policy "leads admin read" on public.leads
  for select to authenticated using (true);
drop policy if exists "leads admin write" on public.leads;
create policy "leads admin write" on public.leads
  for update to authenticated using (true) with check (true);

-- ================================================================ storage ===
-- Public bucket for shop photos. 10 MB ceiling matches the admin's upload
-- guard; HEIC is allowed because the client will upload straight from an iPhone.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'site-photos', 'site-photos', true, 10485760,
  array['image/jpeg','image/png','image/webp','image/heic','image/heif','image/avif','image/svg+xml']
)
on conflict (id) do update
  set public = excluded.public,
      file_size_limit = excluded.file_size_limit,
      allowed_mime_types = excluded.allowed_mime_types;

drop policy if exists "site-photos public read" on storage.objects;
create policy "site-photos public read" on storage.objects
  for select using (bucket_id = 'site-photos');

drop policy if exists "site-photos admin write" on storage.objects;
create policy "site-photos admin write" on storage.objects
  for all to authenticated
  using (bucket_id = 'site-photos') with check (bucket_id = 'site-photos');
