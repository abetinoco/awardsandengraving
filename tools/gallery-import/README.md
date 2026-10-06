# Bailey's Drive photos → Portfolio gallery

One-time import, prepared 2026-10-06. Not deployed: `tools/` is in `.vercelignore`.

- `photos/` holds 126 web-ready photos.
- `photos.json` is the manifest: one entry per photo with its filter, its Drive folder and file name, and any flag.
- `publish.mjs` puts them on the live site through the same storage bucket and tables the admin uses.

## Order of operations

1. **Ship the code on this branch first.** It carries three fixes the import depends on:
   - **The gallery stays invisible on most phones without `site.js`.** The reveal-on-scroll only showed a section once 12% of it was on screen. A 138-piece gallery is about 14,500px tall on a phone, so it never got there. Tested in Chrome at 390×664, 375×667, 375×548, 360×640 and 1366×650: invisible before the fix, visible after. No other section on index, services, about, reviews, contact or portfolio changed behaviour.
   - **`site-content.js`:** a piece with no title or caption gets no caption bar. Without this, uncaptioned photos show an empty dark gradient on hover.
   - **`admin/admin.js`:** the category dropdown reads the filter list from the database. Before, a piece in any filter outside the original five opened with "Awards" selected, and pressing Save moved it there. That already bit any filter Daniel added himself.
   - **`.vercelignore`** is the same file as commit `078fdca` on `wholesale-blog-events-embeds`. Production still serves the `.md` notes and `supabase/` migrations publicly, and this also keeps `tools/` off the site.
   - **Show more (`site.js`, `styles.css`):** the gallery shows 24 pieces of the chosen filter, then a "Show more work (N)" button adds 24 per click. Without it, 138 photos made the page 15,000px tall on a laptop and 19,000px on a phone, and buried the review, Instagram and quote sections. 24 fills whole rows at 2, 3 and 4 columns. The admin's live preview still shows every piece.
   - **Tablet (`styles.css`):** three columns from 601 to 960px instead of two. At 820 the page was 36,500px tall.
   - **Phone filters (`styles.css`, `site.js`):** the ten buttons sit in one row that swipes sideways, with faded edges, instead of five rows above the first photo. A tapped button slides to the middle of the row.
   - **Social handles (`portfolio.html`, `index.html`):** on a phone the TikTok handle ran off the screen above "Follow the craft". Each handle now keeps its icon and wraps to its own line. This was already broken on the live site.
2. Dry run, which reads only:
   ```bash
   node tools/gallery-import/publish.mjs --env "../Awards & Engraving/.env.local"
   ```
3. Publish:
   ```bash
   node tools/gallery-import/publish.mjs --env "../Awards & Engraving/.env.local" --apply
   ```
4. Roll back everything it added, if needed:
   ```bash
   node tools/gallery-import/publish.mjs --env "../Awards & Engraving/.env.local" --undo
   ```

## What --apply changes

| Change | Detail |
|---|---|
| Filter buttons added | Outdoor Plaques, Jewelry, Wedding Gifts, Water Bottles |
| Filter renamed | "Gifts" becomes "Personalized Gifts". The slug stays `gifts`, so the tumbler and perfume pieces land there |
| Pieces added | 126, visible, after every existing piece. Bailey's seven folders are spread evenly through the order, so "All" never runs 48 gifts in a row |
| Pieces moved | Pride Award plaque: Awards → Plaques. Jeff Chadwick memorial: Plaques → Outdoor Plaques |
| Photo library | 126 rows in `media`, files named `bailey-drive-…` |
| Activity log | One entry from "Halo (Drive photo import)" |

The script refuses to run against any project but the one in `site-config.js`. It skips anything already done and journals every write to `applied.json`, which `--undo` reads.

## Counts

| Drive folder | Files | In gallery | Filter |
|---|---|---|---|
| Awards | 26 | 25 | Awards |
| Plaques | 10 | 9 | Plaques |
| Outdoor Plaques | 5 | 4 | Outdoor Plaques (new) |
| Jewelry | 9 | 9 | Jewelry (new) |
| Personalized Gifts | 52 | 48 | Personalized Gifts |
| Wedding Gifts | 22 | 19 | Wedding Gifts (new) |
| Water Bottles | 12 | 12 | Water Bottles (new) |
| **Total** | **136** | **126** | |

### Why some files aren't separate pieces

- **8 photos were filed in two folders.** Each appears once, in the more specific folder:
  - Jewelry over Personalized Gifts or Wedding Gifts.
  - Plaques over Awards.
  - Wedding Gifts over Personalized Gifts.
  - The one exception is IMG_3201, engraved "Happy 40th Birthday", which goes under Personalized Gifts.
- **2 photos are already on the site and were skipped.** IMG_5303 is the Pride Award plaque and IMG_1615 is the Jeff Chadwick memorial. The live pieces move to Bailey's folders instead.

## Processing

- **Format:** cropped to the gallery's 4:5 tile and saved as 800×1000 WebP at quality 80. The median file is 94 KB and the full set is 13.1 MB. The widest tile on the site renders at about 266px, so this covers 2× screens.
- **Colour and orientation:** rotated per the camera's orientation and converted from the iPhone's Display P3 to sRGB.
- **Metadata:** all EXIF and GPS data is stripped, since some photos were taken at customers' homes.
- **Wide shots:** two are fitted whole on the gallery navy (`#182946`) instead of cropped through the middle: the three softballs (`personalized-gifts-19`) and the Frederick Douglass award plaque (`plaques-05`).
- **Video screenshot:** `personalized-gifts-28` is a paused video, cropped to keep the Photos app controls out of frame.
- **Screenshots:** 31 of the photos are phone screenshots. Each was checked, and none shows app chrome in the final crop.

## Left for the shop

- **Titles and captions are empty on purpose.** Nothing was written for these photos, and inventing product names was ruled out. The alt text is Bailey's folder name as a placeholder. `photos.json` lists each file's Drive name so captions can be matched later.
- **Two photos are worth a look before or after publishing:**
  - `jewelry-02` (IMG_1553) shows the Tiffany & Co. logo on the box lid.
  - `wedding-gifts-10` (IMG_3391) is a frame holding a customer couple's wedding photo.
- **Daniel has an empty hidden draft** called "New piece", with no photo, left from the 19 Aug walkthrough. It is untouched. It is why the table holds 13 rows while the site shows 12.

## Review

Screenshots at 2385, 1920, 1440, 1024, 820 and 390 went to ChatGPT (gpt-6-pro) on 2026-10-06, thread `c/6ac50543-1bcc-83ea-b709-4e8783dae68a`. Round 1 scored tablet 6 and phone 7, which led to Show more, the tablet columns, the phone filter row and the handle fix. Its suggestions to replace the phone filters with a dropdown and to centre short last rows were not taken: the first replaces a finished element, and the second is moot now that every page fills whole rows.
