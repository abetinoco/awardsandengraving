-- ============================================================================
-- Awards & Engraving — self-managed portfolio gallery
--
-- The gallery on /portfolio (and the "Recent work" band on the homepage) was
-- twelve hardcoded <figure> blocks. Daniel could edit the intro copy but not
-- the work itself — adding a piece meant emailing us. This table makes the
-- gallery a list he owns, following the same conventions as `reviews`:
-- hide instead of delete, explicit ordering, and a public read policy that
-- only exposes visible rows.
--
-- Same guiding rule as the CMS foundation: "the admin never lies". If this
-- table is empty the static <figure> markup in portfolio.html stays on screen,
-- so a half-filled table is always safe to ship.
-- ============================================================================

create table if not exists public.portfolio_items (
  id          uuid primary key default gen_random_uuid(),
  title       text not null default 'New piece',      -- <b> line in the caption
  caption     text,                                   -- second caption line
  alt         text,                                   -- accessibility text
  image_url   text,                                   -- storage public URL
  category    text not null default 'awards'
                check (category in ('awards','plaques','gifts','engraving','shop')),
  featured    boolean not null default false,         -- surfaces on the homepage band
  visible     boolean not null default true,          -- hide instead of delete
  order_index int not null default 0,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  updated_by  text
);

drop trigger if exists portfolio_items_set_updated_at on public.portfolio_items;
create trigger portfolio_items_set_updated_at
  before update on public.portfolio_items
  for each row execute function public.set_updated_at();

create index if not exists portfolio_items_order_idx
  on public.portfolio_items (order_index, created_at);

alter table public.portfolio_items enable row level security;

-- Mirrors the reviews policies exactly: the public site sees visible rows with
-- the anon key; signed-in admins see and write everything.
drop policy if exists "portfolio public read" on public.portfolio_items;
create policy "portfolio public read" on public.portfolio_items
  for select using (visible = true);
drop policy if exists "portfolio admin read" on public.portfolio_items;
create policy "portfolio admin read" on public.portfolio_items
  for select to authenticated using (true);
drop policy if exists "portfolio admin write" on public.portfolio_items;
create policy "portfolio admin write" on public.portfolio_items
  for all to authenticated using (true) with check (true);

-- ---------------------------------------------------------------- seed ----
-- Seeded from the twelve figures currently hardcoded in portfolio.html so the
-- gallery looks identical the moment it switches to reading from the table.
-- Runs once; re-running the migration will not duplicate rows.
insert into public.portfolio_items (title, caption, alt, image_url, category, featured, order_index)
select * from (values
  ('Lifetime Achievement','Aldridge','Aldridge Lifetime Achievement Award in crystal','/assets/w-aldridge.webp','awards',false,10),
  ('Pride Award','Vernon Hills HS Football','Vernon Hills High School Football Pride Award','/assets/w-vhhs.webp','awards',false,20),
  ('30 under 30','Heritage Woods of Gurnee','30 under 30 business award for Heritage Woods of Gurnee','/assets/w-30under30.webp','awards',false,30),
  ('Memorial plaque','In loving memory','Engraved memorial plaque','/assets/w-memorial.webp','plaques',true,40),
  ('Custom drinkware','Monogrammed','Personalized insulated tumbler','/assets/w-tumbler.webp','gifts',true,50),
  ('Engraved keepsake','Personalized fragrance','Engraved perfume bottle keepsake','/assets/w-perfume.webp','gifts',true,60),
  ('Pet tag','"Love, Winnie"','Gold paw-shaped pet tag engraved Love, Winnie','/assets/w-pawtag.webp','engraving',true,70),
  ('Monogrammed gloves','Bring your own item','Monogrammed leather work gloves','/assets/w-gloves.webp','engraving',true,80),
  ('The storefront','332 N Milwaukee Ave','Awards & Engraving storefront with green-and-white awning','/assets/storefront.webp','shop',false,90),
  ('The showroom','Downtown Libertyville','Awards & Engraving showroom','/assets/interior-1.webp','shop',true,100),
  ('The counter','Samples & ideas','Front counter and samples','/assets/interior-2.webp','shop',false,110),
  ('The makers','Daniel & Bailey Mattson','Owners Daniel and Bailey Mattson at the storefront','/assets/owners.webp','shop',false,120)
) as seed(title, caption, alt, image_url, category, featured, order_index)
where not exists (select 1 from public.portfolio_items);
