/* Awards & Engraving — public content bridge. Include on every public page.
 *
 * 1. Reads every row from `site_content` and overlays values onto elements
 *    marked data-ae-field="<key>". A missing key leaves the static HTML alone,
 *    so a half-filled table can never blank out the site.
 * 2. Renders the reviews wall from the `reviews` table when present.
 * 3. Inside the admin's live preview (?adminPreview=1) it listens for
 *    postMessage edits so the page updates as the admin types.
 *
 * Deliberately dependency-free: it talks to Supabase's REST endpoint directly
 * rather than pulling in the JS SDK, so the public site keeps its zero-build
 * setup and ships nothing extra to visitors. Config comes from
 * /site-config.js, which is generated and safe to publish (anon key only).
 */
(function () {
  'use strict';

  var CFG = window.__AE_CONFIG || {};
  var PREVIEW = /[?&]adminPreview=1\b/.test(window.location.search);

  /* ---------------------------------------------------------------- apply */

  function applyField(key, value) {
    if (value == null) return;
    /* "<imageKey>.alt" is a virtual field — no element carries that attribute,
       so look up the image it belongs to and set its description there. */
    var altOf = /\.alt$/.test(key) ? key.replace(/\.alt$/, '') : null;
    if (altOf) {
      var imgs = document.querySelectorAll('[data-ae-field="' + cssEscape(altOf) + '"]');
      for (var a = 0; a < imgs.length; a++) {
        if (imgs[a].tagName === 'IMG') imgs[a].setAttribute('alt', value);
      }
      return;
    }
    var nodes = document.querySelectorAll('[data-ae-field="' + cssEscape(key) + '"]');
    for (var i = 0; i < nodes.length; i++) {
      var el = nodes[i];
      var type = el.getAttribute('data-ae-type') || '';

      // Background slots take a colour or an image URL; empty restores the sheet.
      if (type === 'bg') {
        el.style.removeProperty('background');
        el.style.removeProperty('background-image');
        var v = String(value).trim();
        if (!v) continue;
        if (/^(#|rgb|hsl|linear-gradient|radial-gradient)/i.test(v)) {
          el.style.setProperty('background', v, 'important');
        } else {
          el.style.setProperty('background-image', 'url("' + v + '")', 'important');
          el.style.setProperty('background-size', 'cover', 'important');
          el.style.setProperty('background-position', 'center', 'important');
        }
        continue;
      }

      if (value === '') continue;

      if (el.tagName === 'IMG') {
        // A key ending .alt sets the description rather than the file, so the
        // same image can have its alt text edited without re-uploading.
        if (/\.alt$/.test(key)) { el.setAttribute('alt', value); continue; }
        // If the saved value is already one of the sources in the markup, leave the
        // element alone. Re-setting src would drop the srcset and pull a second copy
        // of an image the browser has already picked a size for — on the hero that
        // meant fetching both the 1000w and the 1600w file.
        var declared = (el.getAttribute('srcset') || '') + ' ' + (el.getAttribute('src') || '');
        if (declared.indexOf(value) !== -1) continue;
        el.removeAttribute('srcset'); // a stale srcset would win over the new src
        el.removeAttribute('sizes');
        el.src = value;
        continue;
      }

      if (el.tagName === 'A' && type === 'href') { el.href = value; continue; }

      // Multiline: newlines become <br>, built as nodes so no HTML can inject.
      if (type === 'multiline') {
        el.textContent = '';
        String(value).split('\n').forEach(function (line, n) {
          if (n) el.appendChild(document.createElement('br'));
          el.appendChild(document.createTextNode(line));
        });
        continue;
      }

      // Rich text from the WYSIWYG editor. Sanitised before insertion — the
      // editor also sanitises on paste, but never trust stored markup.
      if (type === 'rich') { el.innerHTML = sanitize(String(value)); continue; }

      el.textContent = value;
    }
  }

  function cssEscape(s) { return String(s).replace(/["\\]/g, '\\$&'); }

  /* Allow-list sanitiser: strips scripts, event handlers and javascript: URLs.
     Anything not on the list is unwrapped, keeping its text. */
  var OK_TAGS = ['P','BR','STRONG','B','EM','I','U','UL','OL','LI','H2','H3','H4','BLOCKQUOTE','A','SPAN'];
  function sanitize(html) {
    var doc = document.implementation.createHTMLDocument('');
    doc.body.innerHTML = html;
    (function walk(node) {
      var kids = Array.prototype.slice.call(node.childNodes);
      kids.forEach(function (child) {
        if (child.nodeType === 1) {
          walk(child);
          if (OK_TAGS.indexOf(child.tagName) === -1) {
            while (child.firstChild) node.insertBefore(child.firstChild, child);
            node.removeChild(child);
            return;
          }
          Array.prototype.slice.call(child.attributes).forEach(function (at) {
            var n = at.name.toLowerCase();
            var keep = (child.tagName === 'A' && (n === 'href' || n === 'target' || n === 'rel'));
            if (!keep) { child.removeAttribute(at.name); return; }
            if (n === 'href' && /^\s*javascript:/i.test(at.value)) child.removeAttribute('href');
          });
          if (child.tagName === 'A' && /^https?:/i.test(child.getAttribute('href') || '')) {
            child.setAttribute('target', '_blank');
            child.setAttribute('rel', 'noopener');
          }
        } else if (child.nodeType !== 3) {
          node.removeChild(child); // comments, CDATA
        }
      });
    })(doc.body);
    return doc.body.innerHTML;
  }

  /* ------------------------------------------------------------- reviews */

  function renderReviews(rows) {
    if (!rows || !rows.length) return; // keep the static wall
    var wall = document.querySelector('[data-ae-list="reviews"]');
    var feat = document.querySelector('[data-ae-list="reviews-featured"]');
    var stars = '\u2605\u2605\u2605\u2605\u2605';

    function card(r, big) {
      var fig = document.createElement('figure');
      fig.className = big ? 'tf-card reveal in' : 't-card';
      var head = document.createElement('div');
      head.className = 't-head';
      var av = document.createElement('span');
      av.className = 't-ava';
      av.style.setProperty('--av', r.avatar_hex || '#b08e4e');
      av.textContent = (r.author || '?').trim().charAt(0).toUpperCase();
      var who = document.createElement('span');
      who.className = 't-who';
      var b = document.createElement('b'); b.textContent = r.author || '';
      var m = document.createElement('span'); m.textContent = r.meta || '';
      who.appendChild(b); who.appendChild(m);
      head.appendChild(av); head.appendChild(who);
      var st = document.createElement('span');
      st.className = 'stars';
      st.setAttribute('aria-label', (r.rating || 5) + ' stars');
      st.textContent = stars.slice(0, r.rating || 5);
      var q = document.createElement('blockquote');
      q.textContent = r.body || '';
      fig.appendChild(head); fig.appendChild(st); fig.appendChild(q);
      return fig;
    }

    var featured = rows.filter(function (r) { return r.featured; });
    var rest = rows.filter(function (r) { return !r.featured; });
    if (feat && featured.length) {
      feat.textContent = '';
      featured.forEach(function (r) { feat.appendChild(card(r, true)); });
    }
    if (wall && rest.length) {
      wall.textContent = '';
      rest.forEach(function (r) { wall.appendChild(card(r, false)); });
    }
  }

  /* ----------------------------------------------------------- portfolio */

  /* The gallery ships as static <figure> markup so crawlers and no-JS visitors
     always see the work. When portfolio_items has rows we replace it wholesale;
     an empty table or a failed request leaves the static twelve in place. */
  function renderPortfolio(rows) {
    if (!rows || !rows.length) return; // keep the static gallery
    var gal = document.querySelector('[data-ae-list="portfolio"]');
    var band = document.querySelector('[data-ae-list="portfolio-featured"]');

    function figure(r) {
      var fig = document.createElement('figure');
      fig.setAttribute('data-cat', r.category || 'awards');
      var img = document.createElement('img');
      img.src = r.image_url || '';
      img.alt = r.alt || r.title || '';
      img.loading = 'lazy';
      var cap = document.createElement('figcaption');
      var b = document.createElement('b');
      b.textContent = r.title || '';
      cap.appendChild(b);
      if (r.caption) cap.appendChild(document.createTextNode(r.caption));
      fig.appendChild(img);
      fig.appendChild(cap);
      return fig;
    }

    if (gal) {
      gal.textContent = '';
      rows.forEach(function (r) { gal.appendChild(figure(r)); });
    }
    // Homepage band shows only the pieces flagged "featured"; if none are
    // flagged it falls back to the first few so the band is never empty.
    if (band) {
      var feat = rows.filter(function (r) { return r.featured; });
      if (!feat.length) feat = rows.slice(0, 6);
      band.textContent = '';
      feat.forEach(function (r) { band.appendChild(figure(r)); });
    }

    announce('ae:portfolio-rendered');
  }

  /* Tells site.js that new nodes exist, so scroll-reveal and the gallery
     filter pick them up. Both bind at load and would otherwise miss anything
     rendered from the database afterwards. */
  function announce(name) {
    try {
      document.dispatchEvent(new CustomEvent(name));
      document.dispatchEvent(new CustomEvent('ae:content-rendered'));
    } catch (e) {}
  }

  /* ------------------------------------------------- portfolio categories */

  /* The filter chips shipped as six hardcoded buttons, so a new category meant
     editing HTML. They now come from portfolio_categories; an empty table
     leaves the static chips alone. */
  function renderCategories(rows) {
    if (!rows || !rows.length) return;
    var bar = document.querySelector('[data-ae-list="portfolio-filters"]');
    if (!bar) return;
    var active = (bar.querySelector('.chip.on') || {}).getAttribute
      ? bar.querySelector('.chip.on').getAttribute('data-filter') : 'all';
    bar.textContent = '';
    function chip(slug, label, on) {
      var b = document.createElement('button');
      b.type = 'button';
      b.className = 'chip' + (on ? ' on' : '');
      b.setAttribute('data-filter', slug);
      b.setAttribute('aria-pressed', on ? 'true' : 'false');
      b.textContent = label;
      return b;
    }
    bar.appendChild(chip('all', 'All', active === 'all' || !active));
    rows.forEach(function (r) { bar.appendChild(chip(r.slug, r.label, active === r.slug)); });
    announce('ae:chips-rendered');
  }

  /* ------------------------------------------------------------- services */

  function renderServices(rows) {
    if (!rows || !rows.length) return;
    var full = document.querySelector('[data-ae-list="services"]');
    var teaser = document.querySelector('[data-ae-list="services-featured"]');

    function block(r, n) {
      var item = document.createElement('div');
      item.className = 'svc-item reveal';
      if (r.slug) item.id = r.slug;

      var num = document.createElement('span');
      num.className = 'svc-num';
      num.textContent = r.numeral || n;
      item.appendChild(num);

      var txt = document.createElement('div');
      txt.className = 'svc-txt';
      var h3 = document.createElement('h3');
      h3.appendChild(document.createTextNode((r.title_lead || '') + ' '));
      if (r.title_accent) {
        var em = document.createElement('em');
        em.textContent = r.title_accent;
        h3.appendChild(em);
      }
      txt.appendChild(h3);

      if (r.body) {
        var pEl = document.createElement('p');
        pEl.textContent = r.body;
        txt.appendChild(pEl);
      }

      var tagWrap = document.createElement('div');
      tagWrap.className = 'svc-tags';
      if (r.price) {
        var pr = document.createElement('span');
        pr.className = 'price';
        pr.textContent = r.price;
        tagWrap.appendChild(pr);
      }
      (r.tags || []).forEach(function (tg) {
        var s = document.createElement('span');
        s.textContent = tg;
        tagWrap.appendChild(s);
      });
      if (tagWrap.childNodes.length) txt.appendChild(tagWrap);

      if (r.cta_label) {
        var a = document.createElement('a');
        a.className = 'more';
        a.href = r.cta_href || '/contact';
        a.textContent = r.cta_label;
        txt.appendChild(a);
      }
      item.appendChild(txt);

      if (r.image_url) {
        var media = document.createElement('div');
        media.className = 'svc-media';
        var img = document.createElement('img');
        img.src = r.image_url;
        img.alt = r.image_alt || '';
        img.loading = 'lazy';
        media.appendChild(img);
        item.appendChild(media);
      }
      return item;
    }

    if (full) {
      full.textContent = '';
      rows.forEach(function (r, i) { full.appendChild(block(r, i + 1)); });
    }
    // Homepage shows only the flagged ones; falls back to the first three so
    // the section is never empty if nobody has ticked anything.
    if (teaser) {
      var feat = rows.filter(function (r) { return r.featured; });
      if (!feat.length) feat = rows.slice(0, 3);
      teaser.textContent = '';
      feat.forEach(function (r, i) { teaser.appendChild(block(r, i + 1)); });
    }
    announce('ae:services-rendered');
  }

  /* -------------------------------------------------------------- vendors */

  /* Supplier catalogs Daniel links customers out to. The whole section hides
     when there are no vendors, so it never renders as an empty band. */
  function renderVendors(rows) {
    var wrap = document.querySelector('[data-ae-list="vendors"]');
    if (!wrap) return;
    var section = wrap.closest('section');
    if (!rows || !rows.length) { if (section) section.hidden = true; return; }
    if (section) section.hidden = false;
    wrap.textContent = '';
    rows.forEach(function (r) {
      var card = document.createElement(r.catalog_url ? 'a' : 'div');
      card.className = 'vendor-card';
      if (r.catalog_url) {
        card.href = r.catalog_url;
        card.target = '_blank';
        card.rel = 'noopener';
      }
      if (r.logo_url) {
        var img = document.createElement('img');
        img.className = 'vendor-logo';
        img.src = r.logo_url;
        img.alt = r.name || '';
        img.loading = 'lazy';
        card.appendChild(img);
      }
      var meta = document.createElement('span');
      meta.className = 'vendor-meta';
      var b = document.createElement('b');
      b.textContent = r.name || '';
      meta.appendChild(b);
      if (r.blurb) {
        var s = document.createElement('span');
        s.textContent = r.blurb;
        meta.appendChild(s);
      }
      card.appendChild(meta);
      wrap.appendChild(card);
    });
    announce('ae:vendors-rendered');
  }

  /* ---------------------------------------------------------- list engine */

  /* One renderer for every managed list. The markup for each is a template
     function keyed by list name; the data comes from site_lists. An empty or
     failed fetch leaves the static markup alone, exactly like the other
     renderers. */

  var LIST_TPL = {
    machines: function (d, i) {
      return el('div', 'svc-item reveal', [
        el('span', 'svc-num', d.numeral || String(i + 1)),
        el('div', 'svc-txt', [
          el('h3', '', d.name),
          d.body ? el('p', '', d.body) : null,
          (d.tags && d.tags.length) ? el('div', 'svc-tags', d.tags.map(function (x) { return el('span', '', x); })) : null,
        ]),
        d.image ? el('div', 'svc-media', [img(d.image, d.alt)]) : null,
      ]);
    },
    /* Two shapes: the About page wall carries the company name and category;
       the homepage rail is a plain <ul> of logos. Same rows, same table. */
    client_logos: function (d, i, variant) {
      var logo = img(d.logo, d.alt || d.name, 'client-logo' + (d.on_light ? ' on-light' : ''));
      if (variant === 'rail') return el('li', '', [logo]);
      return el('figure', 'client', [
        logo,
        el('figcaption', 'client-meta', [el('b', '', d.name), el('span', '', d.category)]),
      ]);
    },
    faqs: function (d) {
      var det = document.createElement('details');
      det.className = 'faq-item';
      var sum = document.createElement('summary');
      sum.appendChild(document.createTextNode(d.question || ''));
      sum.appendChild(el('span', 'fx', '+'));
      det.appendChild(sum);
      det.appendChild(el('p', 'fa', d.answer));
      return det;
    },
    reels: function (d) {
      var a = document.createElement('a');
      a.className = 'ig-card';
      a.href = d.url || '#';
      a.target = '_blank'; a.rel = 'noopener';
      a.setAttribute('aria-label', 'Watch on Instagram');
      if (d.thumb) a.appendChild(img(d.thumb, ''));
      a.appendChild(el('span', 'play', '\u25B6'));
      a.appendChild(el('span', 'tag', '@awardsandengraving_'));
      return a;
    },
    process_steps: function (d, i) {
      return el('div', 'p-step reveal', [
        el('span', 'pn', d.step || String(i + 1)),
        el('h3', '', d.title),
        d.body ? el('p', '', d.body) : null,
      ]);
    },
    award_band: function (d, i) {
      return el('div', 'tb-card reveal', [
        el('span', 'tb-n', d.numeral || String(i + 1)),
        el('div', 'tb-txt', [el('h3', '', d.title), d.body ? el('p', '', d.body) : null]),
      ]);
    },
    timeline: function (d) {
      return el('div', 'tl-item reveal', [
        el('span', 'tl-y', d.year),
        el('h3', '', d.title),
        d.body ? el('p', '', d.body) : null,
      ]);
    },
    values: function (d) {
      return el('div', 'val-card reveal', [el('h3', '', d.title), d.body ? el('p', '', d.body) : null]);
    },
    trust_strip: function (d) {
      return el('div', 'trust-item', [el('b', '', d.title), document.createTextNode(' '), el('span', '', d.body)]);
    },
  };
  LIST_TPL.materials = LIST_TPL.process_steps;

  function el(tag, cls, kids) {
    var n = document.createElement(tag);
    if (cls) n.className = cls;
    if (typeof kids === 'string') n.textContent = kids;
    else if (Array.isArray(kids)) kids.forEach(function (k) { if (k) n.appendChild(k); });
    return n;
  }
  function img(src, alt, cls) {
    var n = document.createElement('img');
    n.src = src; n.alt = alt || ''; n.loading = 'lazy';
    if (cls) n.className = cls;
    return n;
  }

  function renderList(key, rows) {
    var tpl = LIST_TPL[key];
    if (!tpl || !rows || !rows.length) return;
    var mounts = document.querySelectorAll('[data-ae-list="' + key + '"]');
    if (!mounts.length) return;
    Array.prototype.forEach.call(mounts, function (mount) {
      // A mount may cap how many it shows (the homepage teasers do this).
      var cap = parseInt(mount.getAttribute('data-ae-limit'), 10);
      var use = (cap > 0) ? rows.slice(0, cap) : rows;
      mount.textContent = '';
      var variant = mount.getAttribute('data-ae-variant') || '';
      use.forEach(function (r, i) { mount.appendChild(tpl(r.data || r, i, variant)); });
    });
    announce('ae:list-rendered');
  }

  /* One request covers every list on the page. */
  function loadLists() {
    var keys = [];
    document.querySelectorAll('[data-ae-list]').forEach(function (n) {
      var k = n.getAttribute('data-ae-list');
      if (LIST_TPL[k] && keys.indexOf(k) === -1) keys.push(k);
    });
    if (!keys.length) return;
    var inList = 'in.(' + keys.join(',') + ')';
    rest('site_lists?select=list_key,data,order_index&visible=eq.true&list_key=' + inList +
         '&order=list_key.asc,order_index.asc')
      .then(function (rows) {
        if (!rows) return;
        var by = {};
        rows.forEach(function (r) { (by[r.list_key] = by[r.list_key] || []).push(r); });
        Object.keys(by).forEach(function (k) { renderList(k, by[k]); });
      })
      .catch(function () { /* offline: static markup stands */ });
  }

  /* ------------------------------------------------- auto-discovered fields
     Hand-tagging elements one at a time never reaches "the whole site is
     editable". This walks the page instead and gives every piece of content a
     stable key built from its page, section and position, so a new section
     becomes editable the moment it exists. Explicit data-ae-field attributes
     still win, which is how the curated keys (hero_sub, contact_phone…) keep
     their friendly names. */

  /* Canonicalised so the same page always yields the same keys however it is
     reached — "/", "/index.html" and "/index" must not produce three different
     sets of saved content. */
  var PAGE_ID = (function () {
    var p = location.pathname.replace(/\/+$/, '').replace(/\.html?$/i, '');
    p = p.replace(/^\//, '');
    if (p === '' || p === 'index') return 'home';
    return p.replace(/[^a-z0-9-]/gi, '-').toLowerCase();
  })();

  var SEL = 'h1,h2,h3,h4,h5,p,li,figcaption,blockquote,address,img,' +
            'a,button,summary,option,td,th,dt,dd,time,span,b,strong,em';
  /* Only these count as "this element is a container, edit its children instead".
     Inline formatting must NOT count: nearly every heading here is
     "Made to be <em>remembered.</em>", and treating that <em> as a child
     silently dropped the whole heading out of the editor. */
  var BLOCK = 'h1,h2,h3,h4,h5,p,li,figcaption,blockquote,address,img,' +
              'a,button,summary,option,td,th,dt,dd';
  var INLINE = 'span,b,strong,em,time';
  /* Nav and footer repeat identically on every page, so they carry explicit
     site.* keys (see the Site-wide editor) instead of per-page auto keys —
     otherwise the same phone number would need editing seven times. */
  var SKIP = 'nav,.nav-float,.nav-menu,.sticky-cta,footer,.preloader,.foot-word,script,style';

  /* Arrows, diamonds, stars and bullets are decoration, not copy — offering them
     as editable fields is noise that buries the text that matters. */
  var DECOR = /^[\s←-⇿☀-➿·•–—…★☆ဂ2+*\-–—·•…★☆✦→←↑↓|/\\]+$/;

  function sectionOf(el) {
    var s = el.closest('section[id],header,.hero-wrap,.page-hero');
    if (!s) return 'page';
    return s.id || String(s.className || '').split(/\s+/)[0] || s.tagName.toLowerCase();
  }

  function autoKey(el, seen) {
    var base = PAGE_ID + '.' + sectionOf(el) + '.' + el.tagName.toLowerCase();
    seen[base] = (seen[base] || 0) + 1;
    return base + '.' + seen[base];
  }

  function collectFields() {
    var out = [], seen = {}, seenKeys = {};
    var nodes = document.querySelectorAll(SEL);
    for (var i = 0; i < nodes.length; i++) {
      var el = nodes[i];
      var explicit = el.getAttribute('data-ae-field');
      // Chrome is skipped except where it carries an explicit site.* key — those
      // are the shared header/footer values, edited once for the whole site.
      var isSite = explicit && explicit.indexOf('site.') === 0;
      if (!isSite && el.closest(SKIP)) continue;
      var isImg = el.tagName === 'IMG';
      var txt = (el.textContent || '').trim();
      if (!isImg) {
        if (!txt || txt.length > 1200) continue;
        if (DECOR.test(txt)) continue;                 // arrows, stars, bullets
        if (el.querySelector(BLOCK)) continue;         // a container, not a leaf
        // Inline bits inside a block we already offer would duplicate it —
        // the heading is edited whole, including its italic half.
        if (el.matches(INLINE) && el.parentElement && el.parentElement.closest(BLOCK)) continue;
        // A link that only wraps an image adds nothing to edit.
        if (el.tagName === 'A' && el.querySelector('img')) continue;
      }
      var key = explicit;
      if (!key) { key = autoKey(el, seen); el.setAttribute('data-ae-field', key); }
      if (seenKeys[key]) continue;          // site.* repeats per page — list once
      seenKeys[key] = 1;
      var hasMarkup = !isImg && /<[a-z]/i.test(el.innerHTML);
      out.push({
        key: key,
        section: isSite ? 'site' : sectionOf(el),
        tag: el.tagName.toLowerCase(),
        type: isImg ? 'image' : (hasMarkup ? 'rich' : (el.tagName === 'P' ? 'textarea' : 'text')),
        value: isImg ? el.getAttribute('src') : (hasMarkup ? el.innerHTML : txt),
        label: isImg ? (el.getAttribute('alt') || 'Image') : txt.slice(0, 44),
        // The shape of the slot as the page actually renders it, so the cropper
        // offers the same proportions the design will show. Square-ish slots
        // report ~1; a null aspect means the slot is freeform.
        aspect: isImg ? (function () {
          var r = el.getBoundingClientRect();
          if (!r.width || !r.height) return null;
          return Math.round((r.width / r.height) * 100) / 100;
        })() : null
      });
      // Every image also gets an alt-text field — it is what screen readers
      // announce and what Google reads, and it was previously uneditable.
      if (isImg) {
        var altKey = key + '.alt';
        if (!seenKeys[altKey]) {
          seenKeys[altKey] = 1;
          out.push({
            key: altKey, section: isSite ? 'site' : sectionOf(el), tag: 'alt',
            type: 'text', value: el.getAttribute('alt') || '',
            label: 'Photo description (for Google and screen readers)'
          });
        }
      }
    }
    return out;
  }

  /* ---------------------------------------------------------------- load */

  function rest(path) {
    return fetch(CFG.url + '/rest/v1/' + path, {
      headers: { apikey: CFG.anonKey, Authorization: 'Bearer ' + CFG.anonKey },
    }).then(function (r) { return r.ok ? r.json() : null; });
  }

  function load() {
    // Stamp auto keys before applying saved values, so rows written against an
    // auto key find their element on the next page load.
    try { collectFields(); } catch (e) {}
    if (!CFG.url || !CFG.anonKey) return; // not configured yet — static copy stands
    rest('site_content?select=key,value').then(function (rows) {
      if (rows) rows.forEach(function (r) { applyField(r.key, r.value); });
    }).catch(function () { /* offline: static copy stands */ });

    if (document.querySelector('[data-ae-list^="reviews"]')) {
      rest('reviews?select=*&visible=eq.true&order=order_index.asc')
        .then(renderReviews)
        .catch(function () {});
    }

    if (document.querySelector('[data-ae-list^="portfolio"]')) {
      rest('portfolio_items?select=*&visible=eq.true&order=order_index.asc')
        .then(renderPortfolio)
        .catch(function () {});
    }

    if (document.querySelector('[data-ae-list="portfolio-filters"]')) {
      rest('portfolio_categories?select=*&visible=eq.true&order=order_index.asc')
        .then(renderCategories)
        .catch(function () {});
    }

    if (document.querySelector('[data-ae-list^="services"]')) {
      rest('services?select=*&visible=eq.true&order=order_index.asc')
        .then(renderServices)
        .catch(function () {});
    }

    loadLists();

    if (document.querySelector('[data-ae-list="vendors"]')) {
      rest('vendors?select=*&visible=eq.true&order=order_index.asc')
        .then(renderVendors)
        .catch(function () {});
    }
  }

  /* ------------------------------------------------- live preview bridge */

  if (PREVIEW) {
    document.documentElement.setAttribute('data-ae-preview', '1');
    window.addEventListener('message', function (e) {
      var d = e.data;
      if (!d || d.source !== 'ae-admin') return;
      if (d.type === 'field') applyField(d.key, d.value);
      if (d.type === 'reviews') renderReviews(d.rows);
      if (d.type === 'portfolio') renderPortfolio(d.rows);
      if (d.type === 'categories') renderCategories(d.rows);
      if (d.type === 'services') renderServices(d.rows);
      if (d.type === 'vendors') renderVendors(d.rows);
      if (d.type === 'reload') window.location.reload();
      // The admin asks the page what it contains rather than holding its own
      // copy of the field list, so the two can never fall out of step.
      if (d.type === 'getFields') {
        try {
          window.parent.postMessage({
            source: 'ae-site', type: 'fields',
            path: location.pathname, fields: collectFields()
          }, '*');
        } catch (err) {}
      }
      if (d.type === 'scrollTo') focusTarget(d.key, d.selector, d.highlight);
    });
    /* Scroll the previewed page to whatever the admin is editing and ring it, so
       the two panes never drift apart. The ring is injected here rather than in
       the site stylesheet — it must never appear for a real visitor. */
    var ringStyle = document.createElement('style');
    ringStyle.textContent =
      '.ae-focus-ring{outline:3px solid #39ff14!important;outline-offset:4px;' +
      'border-radius:3px;transition:outline-color .3s ease}';
    document.head.appendChild(ringStyle);

    var lastRing = null;
    function focusTarget(key, selector, highlight) {
      var t = null;
      if (key) t = document.querySelector('[data-ae-field="' + cssEscape(key) + '"]');
      if (!t && selector) { try { t = document.querySelector(selector); } catch (e) {} }
      if (!t && key) t = document.getElementById(String(key));
      if (!t) return;
      var block = t.getBoundingClientRect().height > window.innerHeight * 0.7 ? 'start' : 'center';
      t.scrollIntoView({ behavior: 'smooth', block: block });
      if (highlight === false) return;
      if (lastRing && lastRing !== t) lastRing.classList.remove('ae-focus-ring');
      t.classList.add('ae-focus-ring');
      lastRing = t;
    }

    // Tell the admin the frame is ready for edits.
    try { window.parent.postMessage({ source: 'ae-site', type: 'ready' }, '*'); } catch (err) {}
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', load, { once: true });
  } else {
    load();
  }
})();
