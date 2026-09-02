/* ============================================================
   Awards & Engraving — Catalog browser.

   Reads the static Premier Line feed under /catalog/ (an index plus one
   product file per collection, produced by the scraper) and renders a
   three-level browse: collections -> categories -> products. Hash-routed
   and deep-linkable:
       #/                 all collections
       #/<key>            one collection (its groups + categories)
       #/<key>/<cid>      one category (its products)

   The 10,030 products are never in the database. The admin's only levers are
   hide / feature flags in the `catalog_overrides` table, read here once and
   applied on top of the feed. If that table is missing or unreachable, the
   catalog simply shows everything.

   Dependency-free, same as site-content.js — talks to Supabase's REST endpoint
   directly using the publishable anon key from /site-config.js.
   ============================================================ */
(function () {
  'use strict';

  var CFG = window.__AE_CONFIG || {};
  var SB = CFG.url, ANON = CFG.anonKey;

  /* representative product image per collection, for the landing cards
     (so the landing page needs only index.json, not every product file). */
  var HERO = {
    crystal:      'v1684243350/products/images/large/CRY048L--16e06002.png',
    sport:        'v1670509745/products/images/large/AA203--a5401ab2.png',
    acrylic:      'v1714429401/products/images/large/MAC401--85d84bd7.png',
    drinkware:    'v1669757725/products/images/large/LWB101--7cda76a7.png',
    leather:      'v1722289232/products/images/large/LTM7451--97203ba5.png',
    personalized: 'v1669750755/products/images/large/BBQ01A--098b756c.png',
    corporate:    'v1667526286/products/images/large/CPP12--28092af9.jpg',
  };
  function cloud(tail, w) {
    return 'https://res.cloudinary.com/business-products/image/upload/q_auto,f_auto,w_' + (w || 600) + '/' + tail;
  }

  var PAGE_SIZE = 60;               // products rendered per "page" in a category
  var root, index = null, overrides = null;
  var prodCache = {};               // key -> { cid: [products] }

  /* ------------------------------------------------------------- helpers */
  function el(tag, attrs, kids) {
    var n = document.createElement(tag);
    if (attrs) for (var k in attrs) {
      if (k === 'class') n.className = attrs[k];
      else if (k === 'html') n.innerHTML = attrs[k];
      else if (k === 'text') n.textContent = attrs[k];
      else if (attrs[k] != null) n.setAttribute(k, attrs[k]);
    }
    (kids || []).forEach(function (c) { if (c) n.appendChild(typeof c === 'string' ? document.createTextNode(c) : c); });
    return n;
  }
  function esc(s) { return String(s == null ? '' : s); }
  function collectionByKey(k) { return (index.collections || []).filter(function (c) { return c.key === k; })[0]; }
  function categoryByCid(coll, cid) {
    for (var i = 0; i < coll.groups.length; i++) {
      var g = coll.groups[i];
      for (var j = 0; j < g.categories.length; j++) if (g.categories[j].id === cid) return { group: g, cat: g.categories[j] };
    }
    return null;
  }

  /* override lookups (all resilient to overrides === null) */
  function isHidden(ref) { return overrides ? !!(overrides.hidden[ref]) : false; }
  function collHidden(key) { return isHidden('col:' + key); }
  function grpHidden(key, name) { return isHidden('grp:' + key + '|' + name); }
  function catHidden(cid) { return isHidden('cat:' + cid); }
  function skuHidden(sku) { return isHidden('sku:' + sku); }
  function skuFeatured(sku) { return overrides ? !!(overrides.featured[sku]) : false; }

  /* visible product count for a collection, discounting hidden groups/categories
     (SKU-level hiding is not reflected in these headline counts — close enough). */
  function visibleCount(coll) {
    var n = 0;
    coll.groups.forEach(function (g) {
      if (grpHidden(coll.key, g.name)) return;
      g.categories.forEach(function (c) { if (!catHidden(c.id)) n += c.count; });
    });
    return n;
  }

  /* --------------------------------------------------------------- fetch */
  function loadIndex() {
    if (index) return Promise.resolve(index);
    return fetch('/assets/catalog/index.json').then(function (r) { return r.json(); }).then(function (d) { index = d; return d; });
  }
  function loadOverrides() {
    if (overrides || !SB) return Promise.resolve(overrides || { hidden: {}, featured: {} });
    return fetch(SB + '/rest/v1/catalog_overrides?select=ref,hidden,featured', {
      headers: { apikey: ANON, Authorization: 'Bearer ' + ANON },
    }).then(function (r) { return r.ok ? r.json() : []; }).then(function (rows) {
      var o = { hidden: {}, featured: {} };
      (rows || []).forEach(function (row) {
        if (row.hidden) o.hidden[row.ref] = true;
        if (row.featured && row.ref.indexOf('sku:') === 0) o.featured[row.ref.slice(4)] = true;
      });
      overrides = o; return o;
    }).catch(function () { overrides = { hidden: {}, featured: {} }; return overrides; });
  }
  function loadProducts(key) {
    if (prodCache[key]) return Promise.resolve(prodCache[key]);
    return fetch('/assets/catalog/' + key + '.json').then(function (r) { return r.json(); }).then(function (d) { prodCache[key] = d; return d; });
  }

  /* ---------------------------------------------------------- fragments */
  function crumbs(items) {
    var c = el('nav', { class: 'crumbs', 'aria-label': 'Breadcrumb' });
    items.forEach(function (it, i) {
      if (i) c.appendChild(el('span', { class: 'sep', text: '/' }));
      if (it.href) c.appendChild(el('a', { href: it.href, text: it.label }));
      else c.appendChild(el('span', { class: 'here', text: it.label }));
    });
    return c;
  }
  var ARR = '→';
  function searchIcon() {
    return el('span', { html: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="11" cy="11" r="8"/><path d="m21 21-4.3-4.3"/></svg>' }).firstChild;
  }
  function ctaStrip() {
    var s = el('div', { class: 'cat-cta-strip' }, [
      el('div', { class: 'ccs-txt' }, [
        el('h3', { text: "Found something? We'll make it yours." }),
        el('p', { text: 'Prices and personalization are quoted per job — no minimums. Send us the item number and what you need engraved, and we’ll reply with a price and timeline, usually the same business day.' }),
      ]),
      el('a', { class: 'btn btn-gold', href: '/contact' }, [document.createTextNode('Get a quote '), el('span', { class: 'arrow', text: ARR })]),
    ]);
    return s;
  }
  function loading(msg) {
    return el('div', { class: 'cat-loading' }, [el('div', { class: 'cat-spin' }), el('div', { text: msg || 'Loading…' })]);
  }
  function quoteHref(p) {
    var line = 'I’d like a quote on item ' + p.sku + ' — ' + p.name + (p.size ? ' (' + p.size + ')' : '') + '. ';
    return '/contact?item=' + encodeURIComponent(line);
  }

  /* --------------------------------------------------------- view: home */
  function viewHome() {
    root.textContent = '';
    var head = el('div', { class: 'cat-head' }, [
      el('p', { class: 'kicker', html: 'Browse the collections <span class="diamond">&#10022;</span> Premier Line' }),
      el('h1', { html: 'Our full <em>catalog</em>.' }),
      el('p', { class: 'sec-sub', text: 'Thousands of crystal, glass, acrylic, drinkware, leather and corporate pieces to start your search. Find something you love, send us the item number, and we’ll engrave it in-house on Milwaukee Avenue.' }),
    ]);
    root.appendChild(el('div', { class: 'wrap' }, [head]));

    var grid = el('div', { class: 'collection-grid' });
    (index.collections || []).forEach(function (c) {
      if (collHidden(c.key)) return;
      var count = visibleCount(c);
      var card = el('a', { class: 'collection-card', href: '#/' + c.key }, [
        el('div', { class: 'cc-media' }, [el('img', { src: cloud(HERO[c.key], 600), alt: c.label, loading: 'lazy' })]),
        el('div', { class: 'cc-body' }, [
          el('div', { class: 'cc-title', text: c.label }),
          el('div', { class: 'cc-meta' }, [
            el('span', { class: 'cc-count', text: count.toLocaleString() + ' items' }),
            el('span', { class: 'cc-go' }, [document.createTextNode('Browse '), document.createTextNode(ARR)]),
          ]),
        ]),
      ]);
      grid.appendChild(card);
    });
    root.appendChild(el('div', { class: 'wrap' }, [grid, ctaStrip()]));
  }

  /* --------------------------------------------------- view: collection */
  function viewCollection(key) {
    var coll = collectionByKey(key);
    if (!coll || collHidden(key)) return viewHome();
    root.textContent = '';

    var head = el('div', { class: 'cat-head' }, [
      crumbs([{ label: 'Catalog', href: '#/' }, { label: coll.label }]),
      el('h1', { text: coll.label }),
    ]);
    var search = el('div', { class: 'cat-search' });
    var input = el('input', { type: 'search', placeholder: 'Search ' + coll.label + '…', 'aria-label': 'Search this collection' });
    search.appendChild(searchIcon()); search.appendChild(input);
    var count = el('div', { class: 'cat-count', html: '<b>' + visibleCount(coll).toLocaleString() + '</b> items' });
    var bar = el('div', { class: 'cat-bar' }, [search, count]);
    root.appendChild(el('div', { class: 'wrap' }, [head, bar]));

    var body = el('div', { class: 'wrap' });
    root.appendChild(body);
    body.appendChild(loading('Loading ' + coll.label + '…'));

    loadProducts(key).then(function (byCid) {
      body.textContent = '';
      renderGroups(body, coll, byCid);
      body.appendChild(ctaStrip());

      var t;
      input.addEventListener('input', function () {
        clearTimeout(t);
        t = setTimeout(function () { runSearch(body, coll, byCid, input.value.trim().toLowerCase()); }, 160);
      });
    }).catch(function () {
      body.textContent = '';
      body.appendChild(el('div', { class: 'cat-empty' }, [el('b', { text: 'Couldn’t load this collection' }), document.createTextNode('Please try again in a moment.')]));
    });
  }

  function renderGroups(body, coll, byCid) {
    /* featured row first */
    var feat = [];
    coll.groups.forEach(function (g) {
      if (grpHidden(coll.key, g.name)) return;
      g.categories.forEach(function (c) {
        if (catHidden(c.id)) return;
        (byCid[c.id] || []).forEach(function (p) { if (skuFeatured(p.sku) && !skuHidden(p.sku)) feat.push(p); });
      });
    });
    if (feat.length) {
      var fb = el('div', { class: 'group-block featured' });
      fb.appendChild(el('div', { class: 'group-head' }, [el('h2', { text: 'Featured' }), el('span', { class: 'g-count', text: feat.length + ' picks' })]));
      var fg = el('div', { class: 'product-grid' });
      feat.slice(0, 12).forEach(function (p) { fg.appendChild(productCard(p)); });
      fb.appendChild(fg); body.appendChild(fb);
    }

    coll.groups.forEach(function (g) {
      if (grpHidden(coll.key, g.name)) return;
      var cats = g.categories.filter(function (c) { return !catHidden(c.id); });
      if (!cats.length) return;
      var block = el('div', { class: 'group-block' });
      var gvis = cats.reduce(function (n, c) { return n + c.count; }, 0);
      block.appendChild(el('div', { class: 'group-head' }, [el('h2', { text: g.name }), el('span', { class: 'g-count', text: gvis.toLocaleString() + ' items' })]));
      var grid = el('div', { class: 'category-grid' });
      cats.forEach(function (c) {
        var prods = byCid[c.id] || [];
        var thumb = null;
        for (var i = 0; i < prods.length; i++) { if (!skuHidden(prods[i].sku)) { thumb = prods[i].image; break; } }
        var media = el('span', { class: 'cc-thumb' });
        if (thumb) media.appendChild(el('img', { src: thumb, alt: '', loading: 'lazy' }));
        grid.appendChild(el('a', { class: 'category-card', href: '#/' + coll.key + '/' + c.id }, [
          media,
          el('span', { class: 'cat-txt' }, [
            el('span', { class: 'cat-name', text: c.name }),
            el('span', { class: 'cat-n', text: c.count + ' item' + (c.count === 1 ? '' : 's') }),
          ]),
          el('span', { class: 'cat-go', html: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M9 18l6-6-6-6"/></svg>' }),
        ]));
      });
      block.appendChild(grid); body.appendChild(block);
    });
  }

  function runSearch(body, coll, byCid, q) {
    if (!q) { body.textContent = ''; renderGroups(body, coll, byCid); body.appendChild(ctaStrip()); return; }
    var hits = [];
    coll.groups.forEach(function (g) {
      if (grpHidden(coll.key, g.name)) return;
      g.categories.forEach(function (c) {
        if (catHidden(c.id)) return;
        (byCid[c.id] || []).forEach(function (p) {
          if (skuHidden(p.sku)) return;
          if ((p.name && p.name.toLowerCase().indexOf(q) > -1) || (p.sku && p.sku.toLowerCase().indexOf(q) > -1)) hits.push(p);
        });
      });
    });
    body.textContent = '';
    var block = el('div', { class: 'group-block' });
    block.appendChild(el('div', { class: 'group-head' }, [
      el('h2', { text: 'Results' }),
      el('span', { class: 'g-count', text: hits.length.toLocaleString() + ' match' + (hits.length === 1 ? '' : 'es') }),
    ]));
    if (!hits.length) {
      block.appendChild(el('div', { class: 'cat-empty' }, [el('b', { text: 'Nothing matched “' + q + '”' }), document.createTextNode('Try a broader term, or browse the categories.')]));
    } else {
      var grid = el('div', { class: 'product-grid' });
      hits.slice(0, 120).forEach(function (p) { grid.appendChild(productCard(p)); });
      block.appendChild(grid);
      if (hits.length > 120) block.appendChild(el('p', { class: 'cat-count', style: 'text-align:center;margin-top:20px', text: 'Showing first 120 of ' + hits.length + ' — narrow your search to see more.' }));
    }
    body.appendChild(block);
  }

  /* ----------------------------------------------------- view: category */
  function viewCategory(key, cid) {
    var coll = collectionByKey(key);
    if (!coll || collHidden(key)) return viewHome();
    var found = categoryByCid(coll, cid);
    if (!found || catHidden(cid) || grpHidden(key, found.group.name)) return viewCollection(key);
    root.textContent = '';

    var head = el('div', { class: 'cat-head' }, [
      crumbs([{ label: 'Catalog', href: '#/' }, { label: coll.label, href: '#/' + key }, { label: found.cat.name }]),
      el('h1', { text: found.cat.name }),
    ]);
    root.appendChild(el('div', { class: 'wrap' }, [head]));
    var body = el('div', { class: 'wrap' });
    root.appendChild(body);
    body.appendChild(loading('Loading products…'));

    loadProducts(key).then(function (byCid) {
      body.textContent = '';
      var all = (byCid[cid] || []).filter(function (p) { return !skuHidden(p.sku); });
      if (!all.length) {
        body.appendChild(el('div', { class: 'cat-empty' }, [el('b', { text: 'No products here yet' }), document.createTextNode('This category is currently empty — browse the rest of the collection.')]));
        body.appendChild(ctaStrip()); return;
      }
      body.appendChild(el('div', { class: 'cat-bar' }, [el('div', { class: 'cat-count', html: '<b>' + all.length + '</b> item' + (all.length === 1 ? '' : 's') }) ]));
      var grid = el('div', { class: 'product-grid' });
      body.appendChild(grid);
      var shown = 0;
      function more() {
        all.slice(shown, shown + PAGE_SIZE).forEach(function (p) { grid.appendChild(productCard(p)); });
        shown += PAGE_SIZE;
        if (shown < all.length) {
          if (!more.btn) { more.btn = el('button', { class: 'btn btn-line load-more', text: 'Show more (' + (all.length - shown) + ' left)' }); more.btn.addEventListener('click', more); body.appendChild(more.btn); }
          else more.btn.textContent = 'Show more (' + (all.length - shown) + ' left)';
        } else if (more.btn) { more.btn.remove(); more.btn = null; }
      }
      more();
      body.appendChild(ctaStrip());
    }).catch(function () {
      body.textContent = '';
      body.appendChild(el('div', { class: 'cat-empty' }, [el('b', { text: 'Couldn’t load products' }), document.createTextNode('Please try again in a moment.')]));
    });
  }

  function productCard(p) {
    var media = el('div', { class: 'pc-media' }, [el('img', { src: p.image, alt: p.name || p.sku, loading: 'lazy' })]);
    if (skuFeatured(p.sku)) media.appendChild(el('span', { class: 'pc-fav', text: 'Featured' }));
    var meta = [el('span', { class: 'pc-sku', text: p.sku })];
    if (p.size) meta.push(el('span', { class: 'pc-size', text: p.size }));
    return el('div', { class: 'product-card' }, [
      media,
      el('div', { class: 'pc-body' }, [
        el('div', { class: 'pc-name', text: p.name || p.sku }),
        el('div', { class: 'pc-meta' }, meta),
        el('a', { class: 'pc-cta', href: quoteHref(p) }, [document.createTextNode('Request a quote '), document.createTextNode(ARR)]),
      ]),
    ]);
  }

  /* ------------------------------------------------------------- router */
  function route() {
    var h = (location.hash || '#/').replace(/^#\/?/, '');
    var parts = h.split('/').filter(Boolean);
    window.scrollTo(0, 0);
    if (parts.length === 0) return viewHome();
    if (parts.length === 1) return viewCollection(decodeURIComponent(parts[0]));
    return viewCategory(decodeURIComponent(parts[0]), decodeURIComponent(parts.slice(1).join('/')));
  }

  function start() {
    root = document.getElementById('catalogRoot');
    if (!root) return;
    root.appendChild(el('div', { class: 'wrap' }, [loading('Loading the catalog…')]));
    Promise.all([loadIndex(), loadOverrides()]).then(function () {
      window.addEventListener('hashchange', route);
      route();
    }).catch(function () {
      root.textContent = '';
      root.appendChild(el('div', { class: 'wrap' }, [el('div', { class: 'cat-empty' }, [el('b', { text: 'Catalog unavailable' }), document.createTextNode('Please refresh the page.')])]));
    });
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start);
  else start();
})();
