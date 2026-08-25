-- ============================================================================
-- Awards & Engraving — generic list engine
--
-- The first five managed lists (portfolio, categories, services, reviews,
-- vendors) each got their own table, renderer and admin screen. That cost
-- roughly two hours apiece and is why nine lists were still hardcoded months
-- after the panel shipped — every new one started from zero.
--
-- This is one table for all of them. The shape of each list lives in
-- site-lists.js, which both the public site and the admin read, so adding a
-- managed list is a schema block rather than a migration plus two new screens.
--
-- Seeded from the markup currently on the site, so nothing changes visually
-- when the pages switch over to reading from here.
-- ============================================================================

create table if not exists public.site_lists (
  id          uuid primary key default gen_random_uuid(),
  list_key    text not null,                 -- matches a key in AE_LISTS
  data        jsonb not null default '{}',  -- the item's fields
  order_index int  not null default 0,
  visible     boolean not null default true, -- hide instead of delete
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  updated_by  text
);

drop trigger if exists site_lists_set_updated_at on public.site_lists;
create trigger site_lists_set_updated_at
  before update on public.site_lists
  for each row execute function public.set_updated_at();

create index if not exists site_lists_key_order_idx
  on public.site_lists (list_key, order_index, created_at);

alter table public.site_lists enable row level security;

drop policy if exists "site_lists public read" on public.site_lists;
create policy "site_lists public read" on public.site_lists
  for select using (visible = true);
drop policy if exists "site_lists admin read" on public.site_lists;
create policy "site_lists admin read" on public.site_lists
  for select to authenticated using (true);
drop policy if exists "site_lists admin write" on public.site_lists;
create policy "site_lists admin write" on public.site_lists
  for all to authenticated using (true) with check (true);

-- ---------------------------------------------------------------- seed ----
-- 59 items lifted from the live markup. Guarded, so re-running is safe.
insert into public.site_lists (list_key, order_index, data)
select * from (values
  ('machines',10,'{"slug": "aeon", "numeral": "I", "name": "AEON MIRA 7", "body": "Our main CO2 laser, and the machine most of your order passes through. It engraves and cuts wood, acrylic, leather, glass, slate, stone, anodized aluminum and coated metals — crisp enough for a signature or a line of fine script, strong enough to cut a shape clean out of a sheet. If you’ve seen a laser-cut acrylic award or a burned-in logo on walnut from us, this is where it came from.", "tags": ["CO₂ laser", "Engrave & cut", "Wood & acrylic", "Leather", "Glass & slate"], "image": "/assets/shop/m-aeon-mira-7.webp", "alt": "AEON MIRA 7 CO2 laser engraver in the Awards &amp; Engraving shop"}'::jsonb),
  ('machines',20,'{"slug": "full-spectrum", "numeral": "II", "name": "Full Spectrum Laser PRO-SERIES 24 × 16+", "body": "Our second CO2 laser, and the reason team orders land on time. A hundred medals for a banquet and a one-off retirement plaque can run side by side instead of queuing behind each other — so a big season order never pushes your single keepsake to next week. Same materials, same quality, twice the floor.", "tags": ["CO₂ laser", "24 × 16 bed", "Team & volume orders", "Runs in parallel"], "image": "/assets/shop/m-full-spectrum-pro.webp", "alt": "Full Spectrum Laser PRO-SERIES 24 x 16+ CO2 laser engraver"}'::jsonb),
  ('machines',30,'{"slug": "fiber", "numeral": "III", "name": "xTool Fiber Laser Marker", "body": "Bare metal is a different job, and it needs a different laser. This one marks stainless steel, aluminum, brass, titanium and hardened tools directly — no ink, no coating, no filler to wear off. The mark is in the metal, so it survives dishwashers, weather, solvents and years of handling. A rotary attachment spins tumblers, flasks and cylindrical tools under the beam so the engraving wraps evenly instead of stretching.", "tags": ["Fiber laser marking", "Stainless & aluminum", "Brass & titanium", "Rotary for round items", "Permanent"], "image": "/assets/shop/m-xtool-fiber.webp", "alt": "xTool fiber laser marker engraving a metal cup on a rotary attachment"}'::jsonb),
  ('machines',40,'{"slug": "uv", "numeral": "IV", "name": "Roland VersaUV LEF-300", "body": "When the piece needs to be in full color, this is the machine. It prints directly onto the object — plaques, awards, drinkware, signage, promotional pieces — in real brand colors rather than a close guess. It lays down white ink first so color reads properly on dark and clear surfaces, and can build gloss and raised texture into the print, which is how a logo ends up looking embossed instead of stuck on.", "tags": ["UV flatbed printing", "Full color direct-to-object", "White ink", "Gloss & texture", "True brand color"], "image": "/assets/shop/m-roland-lef-300.webp", "alt": "Roland VersaUV LEF-300 UV flatbed printer"}'::jsonb),
  ('machines',50,'{"slug": "rotary", "numeral": "V", "name": "New Hermes Vanguard 3000", "body": "The one that predates every laser in the building, and the one we’d fight to keep. It cuts letters mechanically, with a spinning cutter for deep, crisp engraving into brass, aluminum and engraving plastic — and with a diamond tip for drag engraving, which burnishes a bright chip-free line into stainless, pewter, silver and jewelry that no laser reproduces. Watch strap plates, urn plates, silver trays, presentation cups: this is the machine that gives them that unmistakable hand-cut look.", "tags": ["Rotary engraving", "Diamond drag", "Brass & aluminum", "Silver & pewter", "Jewelry"], "image": "/assets/shop/m-hermes-v3000.webp", "alt": "New Hermes Vanguard 3000 computerized rotary and diamond-drag engraver"}'::jsonb),
  ('machines',60,'{"slug": "bottles", "numeral": "VI", "name": "Bottle & Cylinder Station", "body": "A dedicated rotary setup for things that won’t lie flat. Wine and whiskey bottles, stemware, tumblers, growlers, canisters, bats and rolling pins clamp into the chuck and turn under the tool, so the engraving follows the curve instead of skewing across it. It’s the reason you can hand us the actual bottle from the wedding, the retirement, or the closing — not a substitute — and get it back engraved.", "tags": ["Bottles & stemware", "Tumblers & growlers", "Round & tapered items", "Bring your own"], "image": "/assets/shop/m-rotary-station.webp", "alt": "Rotary engraver holding a wine glass in its bottle and cylinder fixture"}'::jsonb),
  ('machines',70,'{"slug": "xtool-f2", "numeral": "VII", "name": "xTool F2 Ultra", "body": "Our second fiber marker, and the one that runs alongside the F1 when a batch has to go out the same day. Permanent marks straight into bare metal — no coating, no ink, nothing to wear off — on tools, tags, knives and hardware.", "tags": ["Bare metal", "Tools & hardware", "Serial numbers", "Batch work"], "image": "/assets/shop/m-xtool-f2.webp", "alt": "xTool F2 Ultra fiber laser marker"}'::jsonb),
  ('machines',80,'{"slug": "sublimation", "numeral": "VIII", "name": "Sublimation Heat Press", "body": "Full color, pressed into the surface rather than sitting on top of it. Photographs, logos and artwork go onto coated metal, ceramic and fabric — the color becomes part of the item, so it will not peel, crack or fade the way a sticker or a print would.", "tags": ["Full color", "Photo plaques", "Ceramic & fabric", "Will not peel"], "image": "/assets/shop/m-sublimation.webp", "alt": "Sublimation heat press"}'::jsonb),
  ('client_logos',10,'{"on_light": false, "logo": "/assets/clients/chicago-bears.svg", "alt": "Chicago Bears", "name": "Chicago Bears", "category": "Professional football"}'::jsonb),
  ('client_logos',20,'{"on_light": false, "logo": "/assets/clients/milwaukee-tool.svg", "alt": "Milwaukee Tool", "name": "Milwaukee Tool", "category": "Tools & manufacturing"}'::jsonb),
  ('client_logos',30,'{"on_light": false, "logo": "/assets/clients/home-depot.svg", "alt": "The Home Depot", "name": "The Home Depot", "category": "Home improvement retail"}'::jsonb),
  ('client_logos',40,'{"on_light": false, "logo": "/assets/clients/abbott.svg", "alt": "Abbott", "name": "Abbott", "category": "Healthcare"}'::jsonb),
  ('client_logos',50,'{"on_light": false, "logo": "/assets/clients/abbvie.svg", "alt": "AbbVie", "name": "AbbVie", "category": "Pharmaceuticals"}'::jsonb),
  ('client_logos',60,'{"on_light": false, "logo": "/assets/clients/medline.svg", "alt": "Medline", "name": "Medline", "category": "Medical supplies"}'::jsonb),
  ('client_logos',70,'{"on_light": false, "logo": "/assets/clients/baxter.svg", "alt": "Baxter", "name": "Baxter", "category": "Medical technology"}'::jsonb),
  ('client_logos',80,'{"on_light": false, "logo": "/assets/clients/baxter-credit-union.svg", "alt": "Baxter Credit Union", "name": "Baxter Credit Union", "category": "Credit union"}'::jsonb),
  ('client_logos',90,'{"on_light": false, "logo": "/assets/clients/advocate-condell.webp", "alt": "Advocate Condell Medical", "name": "Advocate Condell Medical", "category": "Hospital & health system"}'::jsonb),
  ('client_logos',100,'{"on_light": false, "logo": "/assets/clients/aramark.svg", "alt": "Aramark", "name": "Aramark", "category": "Food & facilities services"}'::jsonb),
  ('client_logos',110,'{"on_light": false, "logo": "/assets/clients/mission-bbq.webp", "alt": "Mission BBQ", "name": "Mission BBQ", "category": "Restaurants"}'::jsonb),
  ('client_logos',120,'{"on_light": true, "logo": "/assets/clients/xgolf.webp", "alt": "X-Golf", "name": "X‑Golf", "category": "Golf entertainment"}'::jsonb),
  ('client_logos',130,'{"on_light": false, "logo": "/assets/clients/marines.webp", "alt": "U.S. Marine Corps", "name": "U.S. Marine Corps", "category": "U.S. armed forces"}'::jsonb),
  ('client_logos',140,'{"on_light": false, "logo": "/assets/clients/army.webp", "alt": "U.S. Army", "name": "U.S. Army", "category": "U.S. armed forces"}'::jsonb),
  ('client_logos',150,'{"on_light": false, "logo": "/assets/clients/navy.webp", "alt": "U.S. Navy", "name": "U.S. Navy", "category": "U.S. armed forces"}'::jsonb),
  ('faqs',10,'{"question": "How fast can you turn an order around?", "answer": "Most single items are ready in about 3–5 business days, and we’ll always give you a firm date when we quote. Have a banquet or event that can’t slip? Tell us the deadline and we’ll tell you honestly whether we can hit it — rush work is often possible."}'::jsonb),
  ('faqs',20,'{"question": "Can I bring in my own item to engrave?", "answer": "Absolutely — it’s some of our favorite work. Gloves, tumblers, tools, glassware, knives, instruments. Bring it by the shop and we’ll tell you on the spot whether it will take the engraving well and what it’ll cost."}'::jsonb),
  ('faqs',30,'{"question": "Do you have minimum order quantities?", "answer": "No minimums. One pet tag gets the same care as three hundred team medals."}'::jsonb),
  ('faqs',40,'{"question": "Will I see a proof before you engrave?", "answer": "Yes — you approve a proof of the exact layout and wording before anything is cut. Nothing is engraved until you’ve signed off."}'::jsonb),
  ('faqs',50,'{"question": "How does pricing work?", "answer": "Every job is quoted individually based on the item, material, quantity and complexity of the engraving. Send us the details and we’ll reply with a price and timeline, usually the same business day."}'::jsonb),
  ('faqs',60,'{"question": "What artwork or logo files do you need?", "answer": "Vector files (AI, EPS, SVG or vector PDF) give the cleanest engraving. A high-resolution PNG or JPG usually works too — send what you have and we’ll tell you if we need anything better."}'::jsonb),
  ('faqs',70,'{"question": "Do you handle team and league orders?", "answer": "Every season. We’ve done Vernon Hills High School’s athletic awards for over twenty years and Libertyville Little League’s trophies for over fifteen. Send your roster and we’ll take it from there — names spelled right, ready for banquet night."}'::jsonb),
  ('faqs',80,'{"question": "Do you ship orders?", "answer": "Yes — team, school and corporate orders ship anywhere in the country. Local orders can be picked up at the shop at 332 N Milwaukee Ave."}'::jsonb),
  ('reels',10,'{"url": "https://www.instagram.com/reel/DaTkSj4pN2x/", "thumb": "/assets/w-tumbler.webp"}'::jsonb),
  ('reels',20,'{"url": "https://www.instagram.com/reel/DaN_KPyx86b/", "thumb": "/assets/w-vhhs.webp"}'::jsonb),
  ('reels',30,'{"url": "https://www.instagram.com/reel/DZ7_ornp-Zf/", "thumb": "/assets/w-gloves.webp"}'::jsonb),
  ('reels',40,'{"url": "https://www.instagram.com/reel/DZyMOzCO7ML/", "thumb": "/assets/interior-2.webp"}'::jsonb),
  ('process_steps',10,'{"step": "Step i", "title": "Tell us the idea", "body": "Call, email, or walk in with the occasion, the item, and rough wording. Not sure yet? Describe it and we’ll help you land it."}'::jsonb),
  ('process_steps',20,'{"step": "Step ii", "title": "Quote & proof", "body": "We price the job — usually the same business day — and you approve a proof of the exact layout before anything is cut."}'::jsonb),
  ('process_steps',30,'{"step": "Step iii", "title": "Made in-house", "body": "Engraved right here on Milwaukee Avenue. Nothing is farmed out, so nothing gets lost in translation."}'::jsonb),
  ('process_steps',40,'{"step": "Step iv", "title": "Pick up or ship", "body": "Walk in and pick it up downtown, or we’ll ship team and corporate orders anywhere in the country."}'::jsonb),
  ('award_band',10,'{"numeral": "I", "title": "Championships", "body": "Season trophies, medals and pride awards for schools and leagues."}'::jsonb),
  ('award_band',20,'{"numeral": "II", "title": "Memorials", "body": "Plaques, urns and dedications families keep for generations."}'::jsonb),
  ('award_band',30,'{"numeral": "III", "title": "Retirements", "body": "Lifetime achievement and years-of-service pieces."}'::jsonb),
  ('award_band',40,'{"numeral": "IV", "title": "Milestones", "body": "Weddings, graduations, anniversaries and new beginnings."}'::jsonb),
  ('award_band',50,'{"numeral": "V", "title": "Bring your own", "body": "Gloves, tumblers, tools, glassware — if it holds still."}'::jsonb),
  ('timeline',10,'{"year": "1949", "title": "The shop opens downtown", "body": "Awards & Engraving sets up on Milwaukee Avenue in the heart of Libertyville — and never leaves. The green-and-white awning becomes part of the streetscape."}'::jsonb),
  ('timeline',20,'{"year": "Through the decades", "title": "The town’s trophy shop", "body": "Season after season of school awards, league trophies and family keepsakes. Vernon Hills High School has trusted us with its athletic awards for more than twenty years; Libertyville Little League, for over fifteen."}'::jsonb),
  ('timeline',30,'{"year": "2015–2018", "title": "Corporate partners sign on", "body": "Aldridge brings its custom awards to the shop in 2015, and Heritage Woods of Gurnee launches its employee recognition program with us in 2018 — partnerships that continue today."}'::jsonb),
  ('timeline',40,'{"year": "2025", "title": "Daniel & Bailey take the reins", "body": "The Mattsons become the shop’s family owners — same corner, same machines, same standards. The next seventy-seven years start here."}'::jsonb),
  ('values',10,'{"title": "Custom", "body": "Nothing here is off the shelf. Every piece starts with your occasion, your wording and your budget — then we build to it. If you can describe it, we can usually make it."}'::jsonb),
  ('values',20,'{"title": "Tailored", "body": "You approve a proof of the exact layout before anything is cut, and we fit the job to your deadline — including banquet nights and retirement parties that can’t slip."}'::jsonb),
  ('values',30,'{"title": "Handcrafted", "body": "Engraved in-house on Milwaukee Avenue — not sent out, not outsourced. The person who quotes your piece is the person who makes it right."}'::jsonb),
  ('trust_strip',10,'{"title": "Since 1949", "body": "77 years in downtown Libertyville"}'::jsonb),
  ('trust_strip',20,'{"title": "Local", "body": "Schools, teams & businesses, Lake County"}'::jsonb),
  ('trust_strip',30,'{"title": "In‑house", "body": "Custom ✦ Tailored ✦ Handcrafted"}'::jsonb),
  ('trust_strip',40,'{"title": "Family‑run", "body": "Daniel & Bailey, since 2025"}'::jsonb),
  ('materials',10,'{"step": "Metal", "title": "Stainless, brass, aluminum, silver", "body": "Fiber laser for a permanent dark mark, rotary for a deep cut, diamond drag for a bright burnished line. Three ways to do it, and we pick the one that suits the piece."}'::jsonb),
  ('materials',20,'{"step": "Wood & acrylic", "title": "Walnut, cherry, bamboo, acrylic", "body": "CO₂ laser, engraved or cut clean through. Logos, signatures, fine script and custom shapes — on plaques we stock or a board you bring us."}'::jsonb),
  ('materials',30,'{"step": "Glass & stone", "title": "Crystal, glassware, slate, tile", "body": "Frosted laser engraving with the crisp edge a rotary tool can’t hold. Flat pieces on the bed, bottles and stemware on the rotary station."}'::jsonb),
  ('materials',40,'{"step": "Full color", "title": "Logos, photos, brand color", "body": "UV printed straight onto the object, white ink underneath so it reads on dark and clear surfaces, with gloss or raised texture where it earns its keep."}'::jsonb)
) as seed(list_key, order_index, data)
where not exists (select 1 from public.site_lists);
