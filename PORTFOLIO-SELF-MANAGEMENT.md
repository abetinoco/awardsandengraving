# Portfolio self-management — build notes & client tutorial

**Built:** 2026-08-18 · **For the 9:30am walkthrough with Daniel**

---

## PART 1 — What you need to do before the meeting

### The one manual step: run the migration

I could not apply this for you — the Supabase account connected here only has
access to SDR Imports, not A&E's project (`yyxbvuyxkgbeatyrfsro`).

1. Open **supabase.com → Awards & Engraving → SQL Editor**
2. Paste the contents of [`supabase/migrations/20260818_portfolio_items.sql`](supabase/migrations/20260818_portfolio_items.sql)
3. Run it

It is **additive and safe to re-run**: it creates one new table, adds RLS
policies, and seeds the twelve pieces currently hardcoded on the site. The seed
is guarded by `where not exists`, so running it twice will not duplicate rows.

Nothing else needs deploying — the rest is static files already in the repo.

### Verify it worked (30 seconds)

- Open `/portfolio` — the gallery should look **identical**. That is the point:
  it is now reading from the database, but the seed matches what was there.
- Open `/admin` → **Portfolio** in the sidebar. Twelve rows should be listed.
- Toggle one piece to hidden, reload `/portfolio` — it should disappear.

### Dev server

Running at **http://127.0.0.1:5190** (plain static server).
Admin panel: **http://127.0.0.1:5190/admin/**

⚠️ The static server does **not** run `/api/quote`, so the contact form won't
send locally. Everything portfolio-related works, because the admin talks to
Supabase directly from the browser.

---

## PART 2 — The tutorial for Daniel

*This is the part to walk him through. Written for him, not for us.*

### What's new

Until now, adding a new piece to your Portfolio page meant sending us the photo
and waiting. **You can now do it yourself, from your phone or your computer,
and it goes live immediately.**

### Getting in

1. Go to **awardsandengraving.com/admin**
2. Sign in with your email and password
3. Click **Portfolio pictures** in the menu on the left

> **How the menu is organised**, so you always know where to go:
> - **Page wording** — changes the *words* on a page
> - **Your content** — the *lists of things* on your site: your pictures,
>   your reviews, your photo library
> - **Records** — quote requests and history; nothing here changes the site
>
> So: to reword the Portfolio page's intro, use *Page wording → Portfolio*.
> To add a photo of a trophy, use *Your content → Portfolio pictures*.

You'll see every piece currently on your Portfolio page, in the order they
appear on the site.

### Adding a new piece

1. Press **Add piece** (top right)
2. A new row appears at the bottom called *"New piece"* — click it to open it
3. Press **Choose file** and pick a photo
   - You'll get a cropping window. Drag to frame the piece, then confirm.
   - The photo is automatically squared and compressed, so it loads fast.
     **You don't need to resize anything first — a photo straight off your
     phone is fine.**
4. Fill in:
   - **Title** — the bold line, e.g. *"Lifetime Achievement"*
   - **Caption** — the line underneath, e.g. *"Aldridge"*
   - **Photo description** — what's in the photo, in plain words. Nobody sees
     this on the page; it's what a blind visitor's screen reader says aloud, and
     it's what Google reads. e.g. *"Crystal lifetime achievement award engraved
     for Aldridge"*
   - **Filter category** — which chip it shows under (Awards, Plaques, Gifts,
     Engraving, The shop)
5. Tick **Visible on the site**
6. Press **Save piece**

Refresh your Portfolio page — it's there.

### Putting a piece on the homepage

Tick **"Also show in Recent work on the homepage"**. That's the band of photos
on your front page. Six works best there — more than that and it gets crowded.

### Changing the order

Each piece has **↑ Move up** and **↓ Move down** buttons. The order in the
admin is the order on the page. The first piece in the list is the first one a
visitor sees.

### Taking something down

Two ways, and the difference matters:

- **Untick "Visible on the site"** — takes it off the website but keeps it here.
  You can put it back any time. **This is what you want almost always.**
- **Delete** — gone permanently. Only use this for a photo you'll never want
  again.

If a customer asks you to take their piece down, untick Visible. If they change
their mind next month, it's one click to restore.

### Good photos, quickly

You don't need a camera or a lightbox. A phone photo works if:

- **Light from a window, not overhead.** Shop ceiling lights make engraving look
  flat; side light shows the depth of the cut.
- **Plain background.** A clean bit of counter beats a cluttered bench.
- **Fill the frame.** Get close. The crop tool can only cut, not add.
- **Turn the piece slightly.** A dead-straight shot loses the bevel; a few
  degrees off-square catches the light in the engraving.

### Where your photos live (the "Photos" screen)

Click **Photo library** in the menu. This is every image you've ever uploaded.

**These files are on your own Supabase account, not ours.** If you ever stopped
working with us, the photos stay yours — you own the account they sit in.

For each photo you can see:

- **How big it is** and when you uploaded it
- **"In use"** or **"Not used"** — whether it's currently on the website anywhere
- **Copy link** — the web address of the photo, if you ever need to paste it
  somewhere else
- **Delete** — removes it permanently

At the top you'll see how much space you're using. You get **1 GB free**, and
photos come in around half a megabyte each after we compress them — so that's
roughly two thousand photos before you'd ever need to think about it.

If you try to delete a photo that's still on a page, it will tell you exactly
where it's being used and make you confirm. That's on purpose — deleting one
that's in use would leave a broken image on the site.

**Rule of thumb:** don't bother tidying up. Storage is effectively free at your
volume. The only reason to delete is if you uploaded something by mistake.

### If something goes wrong

- **Photo won't upload** — it's probably over 10 MB. Take a normal photo rather
  than a Live Photo or RAW.
- **Saved but not showing** — check **Visible on the site** is ticked, then
  hard-refresh (Cmd/Ctrl + Shift + R).
- **Something looks broken** — nothing you do here can break the website. If the
  list is empty or won't load, the site quietly falls back to the twelve photos
  it shipped with. Call us and we'll sort it.

---

## PART 3 — What I changed (for our records)

| File | Change |
|---|---|
| `supabase/migrations/20260818_portfolio_items.sql` | **New.** `portfolio_items` table, RLS mirroring `reviews`, seeded with the existing 12 pieces |
| `site-content.js` | Added `renderPortfolio()` — renders the gallery from the table, falls back to static markup when empty or offline |
| `portfolio.html` | Tagged the gallery `data-ae-list="portfolio"` |
| `index.html` | Tagged the homepage mosaic `data-ae-list="portfolio-featured"` |
| `site.js` | **Bug fix.** The filter chips cached their figure list at page load, so filtering broke the moment the gallery re-rendered from the CMS. Now queried at click time, and the active filter re-applies after render. |
| `admin/admin.js` | Added the Portfolio manager — add / edit / photo upload via the existing cropper / category / feature / show-hide / reorder / delete, plus sidebar, dashboard card and command-palette entries |
| `admin/admin.css` | Thumbnail and preview styles for the manager, plus the photo-library grid |
| `admin/admin.js` | Added the **Photos** library — every upload, size, in-use/not-used, copy link, guarded delete, storage total |
| `admin/admin.js` | Added **View live site** to the sidebar and the Cmd+K palette |

### Design decisions worth knowing

- **Hide instead of delete** is the default path, matching how reviews already
  work — a client taking something down by accident is a phone call we don't
  want.
- **Reorder is up/down buttons, not drag-and-drop.** Nothing to learn, and it
  behaves identically on a phone.
- **Static markup is the fallback, not a placeholder.** If Supabase is down or
  the table is empty, the page keeps the twelve original figures. Crawlers and
  no-JS visitors always see real work.
- **Ordering rewrites both rows' indexes** on a swap, so a fresh table where
  every `order_index` is 0 still reorders correctly.

### Not done

- The homepage band's featured set is capped by whatever Daniel ticks — there's
  no hard limit in the UI. Six looks right; more will wrap. Worth a word in the
  walkthrough rather than a code constraint.
- No bulk upload. Adding ten pieces means ten rows. Fine for the volume he
  actually adds; worth revisiting if he starts batching.

---

## PART 4 — Agreed next: services & client logos

**Status: not built. Confirmed as a must-do, scheduled after the 19 Aug meeting.**

Same limitation the portfolio had until tonight — the client can reword these
but cannot add, remove or reorder them.

### Services (6 blocks)
Live in `services.html` (6) and `index.html` (3 teasers). Each block carries
more structure than a portfolio piece:

- Roman numeral, heading + `<em>` accent word, body paragraph
- Price chip + 4–5 tag chips
- CTA label and link, and a photo

Needs: a `services` table, a renderer in `site-content.js` with static fallback,
and a manager with a repeatable tag editor. The homepage teasers should read
from the same table so the two never drift.

### Client logos (15 + 16)
`index.html` is a plain logo strip; `about.html` is a richer wall with company
name and category per logo. Note the `.on-light` special case — X-Golf only
publishes a white-on-transparent mark and needs a dark-ink variant on the cream
band, so the manager needs that as a per-logo toggle rather than a hardcoded class.

Needs: a `clients` table (name, category, logo, `on_light`, order, visible),
plus SVG in the upload allow-list — the bucket already permits `image/svg+xml`,
but the cropper is raster-only, so SVG uploads must bypass it.

### Deliberately not doing
- **Quote requests** — handled by phone and email, so no lead-status workflow needed.
- **Instagram reels** — being replaced by a pitched embed feature (IG + YouTube
  Shorts) rather than a URL manager, to save storage.
