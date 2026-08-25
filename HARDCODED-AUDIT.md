# Hardcoded content audit — Awards & Engraving

**23 Aug 2026.** Every repeated list on the site, checked page by page.

The distinction that matters: **all of this text is already editable** — the
panel auto-discovers fields and Daniel can reword any of it. What he *cannot*
do is add an item, remove one, or change the order. That's the gap.

---

## Still hardcoded

| # | Content | Page | Items | Why it will bite |
|---|---|---|---|---|
| 1 | **The machines** | `our-shop.html` | 8 | Their whole differentiator is "eight machines under one roof". Buy or sell one and the page lies. |
| 2 | **Client logos** | `index.html` 15 + `about.html` 16 | 31 | These are trophies. Every new Fortune 500 he lands, he'll want it on the wall. |
| 3 | **FAQ** | `contact.html` | 8 | Questions change as customers ask new ones. Highest-churn copy on the site. |
| 4 | **Instagram reels** | `index` 4 + `portfolio` 4 | 8 | Goes stale fastest. Being replaced by the embed system. |
| 5 | **Process steps** | `services` 4 + `our-shop` 4 | 8 | Duplicated across two pages, so they can already drift. |
| 6 | **Award / trust band** | `index.html` | 5 | "Championships, Memorials…" — the categories he sells. |
| 7 | **Timeline** | `about.html` | 4 | Shop history. 1949 → today. Will need a new milestone eventually. |
| 8 | **Values cards** | `about.html` | 3 | Custom / Tailored / Handcrafted. |
| 9 | **Trust strip** | `index.html` | 4 | Since 1949, Local, etc. |

**Total: 79 items across 9 lists.**

## Already fixed

Portfolio pictures · Portfolio filter categories · Services · Reviews · Vendors

---

## The real problem

Each of the five we've done took its own table, its own renderer and its own
manager screen — roughly two hours each. Nine more at that rate is a fortnight,
and every future list costs the same again.

That's the thing that should have been built first: **not five bespoke
managers, but one list system.**

### Proposed: a generic list engine

One table:

```sql
site_lists (id, list_key, order_index, visible, data jsonb)
```

One schema definition per list, in JS:

```js
machines: {
  label: 'The machines',
  page: '/our-shop',
  fields: [
    { key: 'name',  type: 'text',     label: 'Machine name' },
    { key: 'body',  type: 'textarea', label: 'What it does' },
    { key: 'tags',  type: 'tags',     label: 'Materials' },
    { key: 'photo', type: 'image',    label: 'Photo', aspect: 4/3 },
  ],
}
```

One manager screen that builds its form from that schema, and one renderer that
maps rows onto the existing markup. The field types already exist — text,
textarea, tags, image, link, checkbox — they're just currently written out
longhand in each manager.

**Cost:** roughly a day to build the engine and port all nine lists. After
that, a new list is a schema block — about fifteen minutes, no migration, no
new manager, no new renderer.

**Bonus:** the five existing managers can fold into it too, which deletes a
large chunk of `admin.js`.

### The alternative

Keep going bespoke: nine more tables, nine more managers, nine more renderers.
Works, but it's the same fortnight, and the tenth list costs the same as the
first.
