-- ============================================================================
-- Awards & Engraving — self-managed categories, services and vendors
--
-- Three gaps left by the first pass, all the same shape: content the client
-- can reword but cannot add to, remove from, or reorder.
--
--   1. portfolio_categories — the filter chips were a CHECK constraint plus
--      six hardcoded buttons, so a new category meant a code change.
--   2. services            — six fixed blocks in services.html.
--   3. vendors             — new. Supplier catalogs (JD's and others) that
--                            Daniel wants to link customers out to.
--
-- Same conventions as before: hide instead of delete, explicit ordering, public
-- read limited to visible rows, and an empty table always falls back to the
-- static markup so a half-filled table is safe to ship.
-- ============================================================================

-- ==================================================== portfolio categories ==
create table if not exists public.portfolio_categories (
  id          uuid primary key default gen_random_uuid(),
  slug        text not null unique,          -- matches figure[data-cat]
  label       text not null,                 -- what the filter chip reads
  order_index int  not null default 0,
  visible     boolean not null default true,
  created_at  timestamptz not null default now()
);

create index if not exists portfolio_categories_order_idx
  on public.portfolio_categories (order_index, created_at);

insert into public.portfolio_categories (slug, label, order_index)
select * from (values
  ('awards','Awards',10),
  ('plaques','Plaques',20),
  ('gifts','Gifts',30),
  ('engraving','Engraving',40),
  ('shop','The shop',50)
) as seed(slug,label,order_index)
where not exists (select 1 from public.portfolio_categories);

-- The CHECK constraint is what made categories un-addable. Ordering is now a
-- soft reference to portfolio_categories.slug rather than a hardcoded list.
alter table public.portfolio_items drop constraint if exists portfolio_items_category_check;

alter table public.portfolio_categories enable row level security;
drop policy if exists "portfolio_categories public read" on public.portfolio_categories;
create policy "portfolio_categories public read" on public.portfolio_categories
  for select using (visible = true);
drop policy if exists "portfolio_categories admin read" on public.portfolio_categories;
create policy "portfolio_categories admin read" on public.portfolio_categories
  for select to authenticated using (true);
drop policy if exists "portfolio_categories admin write" on public.portfolio_categories;
create policy "portfolio_categories admin write" on public.portfolio_categories
  for all to authenticated using (true) with check (true);

-- ================================================================ services ==
create table if not exists public.services (
  id           uuid primary key default gen_random_uuid(),
  slug         text not null unique,         -- anchor id, e.g. #trophies
  numeral      text,                         -- the roman numeral shown beside it
  title_lead   text not null default 'New service',
  title_accent text,                         -- the italic word in the heading
  body         text,
  price        text,                         -- "From $99" chip; blank hides it
  tags         text[] not null default '{}',
  image_url    text,
  image_alt    text,
  cta_label    text not null default 'Request a quote',
  cta_href     text not null default '/contact',
  featured     boolean not null default false, -- also shown on the homepage
  visible      boolean not null default true,
  order_index  int not null default 0,
  updated_at   timestamptz not null default now(),
  updated_by   text
);

drop trigger if exists services_set_updated_at on public.services;
create trigger services_set_updated_at
  before update on public.services
  for each row execute function public.set_updated_at();

create index if not exists services_order_idx on public.services (order_index, id);

-- Seeded from the six blocks in services.html. The first three are flagged
-- featured because those are the three teasers on the homepage today.
insert into public.services
  (slug, numeral, title_lead, title_accent, body, price, tags, image_url, image_alt, cta_label, cta_href, order_index)
select * from (values
  ('trophies','I','Trophies &amp;','Awards','Crystal, acrylic, wood and metal awards for championships, retirements, lifetime achievement and everything between. We help you choose the piece, the wording and the finish &mdash; then engrave it here so every letter lands exactly right. Pieces like the Aldridge Lifetime Achievement award start as a conversation at the counter.','From $99',array['Crystal','Acrylic','Wood','Metal','No minimums']::text[],'/assets/w-aldridge.webp','Aldridge Lifetime Achievement Award in crystal','Request a quote','/contact',10),
  ('plaques','II','Plaques &amp;','Memorials','Walnut, cherry, brass and bronze plaques for honors, dedications, donor recognition and memorials. These are the pieces families keep for generations, so we take the wording as seriously as you do &mdash; you approve a proof of every line before anything is engraved.','From $99',array['Walnut &amp; cherry','Brass &amp; bronze','Photo plaques','Proof first']::text[],'/assets/w-memorial.webp','Engraved memorial plaque','Request a quote','/contact',20),
  ('school','III','School &amp;','Team Spirit','Season trophies, medals, pride awards, senior gifts and championship plaques for schools and leagues across Lake County. We&rsquo;ve handled team orders for Vernon Hills High School for over twenty years and Libertyville Little League every season &mdash; names spelled right, ready for banquet night.','From $99',array['Team orders','Medals &amp; ribbons','Banquet-ready','Every season']::text[],'/assets/w-vhhs.webp','Vernon Hills High School Football Pride Award','Request a quote','/contact',30),
  ('engraving','IV','Custom','Engraving','Bring your own item and we&rsquo;ll personalize it &mdash; leather gloves, tumblers, tools, glassware, knives, instruments. If it holds still, we can engrave it. We&rsquo;ll tell you honestly whether your piece will take the engraving well, and you&rsquo;ll see the layout before we cut.','',array['Your own item','Leather','Glass &amp; metal','Proof before we cut']::text[],'/assets/w-gloves.webp','Monogrammed leather work gloves','Request a quote','/contact',40),
  ('gifts','V','Personalized','Gifts','Monogrammed drinkware, engraved keepsakes, pet tags and one-of-a-kind gifts for weddings, retirements, graduations and every milestone in between. Come in with an occasion and a budget &mdash; we&rsquo;ll come back with ideas you won&rsquo;t find in a catalog.','From $99',array['Weddings','Retirements','Keepsakes','One-of-a-kind']::text[],'/assets/w-tumbler.webp','Personalized insulated tumbler','Request a quote','/contact',50),
  ('corporate','VI','Corporate','Recognition','Employee awards, years-of-service pieces and logo engraving that actually match your brand. We run recurring recognition programs for corporate clients &mdash; and can even build a secure, custom award-ordering site for your team &mdash; so your quarterly awards show up on schedule without anyone chasing them. Volume orders shipped anywhere.','From $99',array['Logo engraving','Recurring programs','Volume orders','Shipped anywhere']::text[],'/assets/w-30under30.webp','30 under 30 business award for Heritage Woods of Gurnee','Request a quote','/contact',60)
) as seed(slug, numeral, title_lead, title_accent, body, price, tags, image_url, image_alt, cta_label, cta_href, order_index)
where not exists (select 1 from public.services);

update public.services set featured = true where slug in ('trophies','plaques','school');

alter table public.services enable row level security;
drop policy if exists "services public read" on public.services;
create policy "services public read" on public.services
  for select using (visible = true);
drop policy if exists "services admin read" on public.services;
create policy "services admin read" on public.services
  for select to authenticated using (true);
drop policy if exists "services admin write" on public.services;
create policy "services admin write" on public.services
  for all to authenticated using (true) with check (true);

-- ================================================================= vendors ==
-- Suppliers whose retail catalogs Daniel links customers to, e.g. JD's retail digital catalog.
create table if not exists public.vendors (
  id          uuid primary key default gen_random_uuid(),
  name        text not null default 'New vendor',
  blurb       text,                          -- one line: what they supply
  logo_url    text,
  catalog_url text,                          -- the link customers follow
  order_index int not null default 0,
  visible     boolean not null default true,
  updated_at  timestamptz not null default now(),
  updated_by  text
);

drop trigger if exists vendors_set_updated_at on public.vendors;
create trigger vendors_set_updated_at
  before update on public.vendors
  for each row execute function public.set_updated_at();

create index if not exists vendors_order_idx on public.vendors (order_index, id);

alter table public.vendors enable row level security;
drop policy if exists "vendors public read" on public.vendors;
create policy "vendors public read" on public.vendors
  for select using (visible = true);
drop policy if exists "vendors admin read" on public.vendors;
create policy "vendors admin read" on public.vendors
  for select to authenticated using (true);
drop policy if exists "vendors admin write" on public.vendors;
create policy "vendors admin write" on public.vendors
  for all to authenticated using (true) with check (true);
