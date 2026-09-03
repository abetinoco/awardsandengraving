/* Awards & Engraving — site editor.
 *
 * Vanilla JS: the public site has no build step and adding one to ship an admin
 * screen buys nothing. Talks to Supabase over its REST, Auth and Storage APIs.
 *
 * Follows the Highview admin spec — organised by page not by table, explicit
 * save (never optimistic), dirty guards, hide-instead-of-delete, activity log,
 * one-step version restore, ⌘K search, and a live preview that scroll-follows
 * the field being edited. The form is built from what the page reports about
 * itself, so a new section becomes editable without touching this file.
 */
(function () {
  'use strict';

  var CFG = window.__AE_CONFIG || {};
  var SB = CFG.url, ANON = CFG.anonKey;
  var LS = 'ae_admin_session';
  var session = null, me = '';

  /* ============================================================ plumbing == */

  function el(s, r) { return (r || document).querySelector(s); }
  function h(tag, attrs, kids) {
    var n = document.createElement(tag);
    Object.keys(attrs || {}).forEach(function (k) {
      if (k === 'class') n.className = attrs[k];
      else if (k === 'text') n.textContent = attrs[k];
      else if (k === 'html') n.innerHTML = attrs[k];
      else if (k.slice(0, 2) === 'on') n.addEventListener(k.slice(2), attrs[k]);
      else if (attrs[k] != null && attrs[k] !== false) n.setAttribute(k, attrs[k]);
    });
    (kids || []).forEach(function (c) { if (c) n.appendChild(c); });
    return n;
  }
  function icon(name, cls) {
    var svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    svg.setAttribute('viewBox', '0 0 24 24');
    svg.setAttribute('fill', 'none');
    svg.setAttribute('stroke', 'currentColor');
    svg.setAttribute('stroke-width', '1.7');
    svg.setAttribute('stroke-linecap', 'round');
    svg.setAttribute('stroke-linejoin', 'round');
    svg.setAttribute('aria-hidden', 'true');
    svg.setAttribute('class', 'ic ' + (cls || ''));
    svg.innerHTML = (window.AE_ICONS || {})[name] || '';
    return svg;
  }
  function toast(msg, kind, link) {
    var t = h('div', { class: 'toast' + (kind === 'err' ? ' err' : '') }, [
      icon(kind === 'err' ? 'alert' : 'check'), h('span', { text: msg }),
    ]);
    if (link) t.appendChild(h('a', { href: link, target: '_blank', text: 'View it' }));
    el('#toasts').appendChild(t);
    setTimeout(function () { t.remove(); }, kind === 'err' ? 9000 : 4200);
  }
  function ago(iso) {
    var s = (Date.now() - new Date(iso).getTime()) / 1000;
    if (s < 60) return 'just now';
    if (s < 3600) return Math.floor(s / 60) + 'm ago';
    if (s < 86400) return Math.floor(s / 3600) + 'h ago';
    return Math.floor(s / 86400) + 'd ago';
  }
  function firstName(email) {
    if (!email) return 'there';
    var n = String(email).split('@')[0].split(/[._-]/)[0];
    return n.charAt(0).toUpperCase() + n.slice(1);
  }
  function greeting() {
    var hr = new Date().getHours();
    return hr < 12 ? 'Good morning' : hr < 18 ? 'Good afternoon' : 'Good evening';
  }

  /* ================================================================ auth == */

  function saveSession(s) { session = s; try { localStorage.setItem(LS, JSON.stringify(s)); } catch (e) {} }
  function loadSession() { try { return JSON.parse(localStorage.getItem(LS) || 'null'); } catch (e) { return null; } }
  function clearSession() { session = null; try { localStorage.removeItem(LS); } catch (e) {} }

  function signIn(email, password) {
    return fetch(SB + '/auth/v1/token?grant_type=password', {
      method: 'POST', headers: { apikey: ANON, 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: email, password: password }),
    }).then(function (r) {
      return r.json().then(function (j) {
        if (!r.ok) throw new Error(j.error_description || j.msg || j.message || 'Sign in failed');
        return j;
      });
    });
  }
  function refresh() {
    if (!session || !session.refresh_token) return Promise.reject(new Error('no session'));
    return fetch(SB + '/auth/v1/token?grant_type=refresh_token', {
      method: 'POST', headers: { apikey: ANON, 'Content-Type': 'application/json' },
      body: JSON.stringify({ refresh_token: session.refresh_token }),
    }).then(function (r) { if (!r.ok) throw new Error('refresh failed'); return r.json(); })
      .then(function (j) { saveSession(j); return j; });
  }
  /* A 401 gets one refresh-and-retry before bouncing to login, so a long editing
     session never loses typed work to an expired token. */
  function api(path, opts, retried) {
    opts = opts || {};
    var headers = Object.assign({
      apikey: ANON, Authorization: 'Bearer ' + (session ? session.access_token : ANON),
    }, opts.headers || {});
    if (opts.body && !headers['Content-Type']) headers['Content-Type'] = 'application/json';
    return fetch(SB + '/rest/v1/' + path, { method: opts.method || 'GET', headers: headers, body: opts.body })
      .then(function (r) {
        if (r.status === 401 && !retried) return refresh().then(function () { return api(path, opts, true); });
        if (!r.ok) return r.text().then(function (t) { throw new Error(t || ('HTTP ' + r.status)); });
        if (r.status === 204) return null;
        return (r.headers.get('content-type') || '').indexOf('json') > -1 ? r.json() : null;
      });
  }
  function logActivity(action, target, detail, before, after) {
    return api('site_activity', {
      method: 'POST', headers: { Prefer: 'return=minimal' },
      body: JSON.stringify({
        actor: me, action: action, target: target || null, detail: detail || null,
        before_text: before == null ? null : String(before).slice(0, 4000),
        after_text: after == null ? null : String(after).slice(0, 4000),
      }),
    }).catch(function () {});
  }

  /* ============================================================== pages == */

  var PAGES = [
    { id: 'home',      label: 'Homepage',     path: '/',          icon: 'home',     blurb: 'Hero, section intros, the award band and the closing call to action.' },
    { id: 'services',  label: 'Services',     path: '/services',  icon: 'wrench',   manager: 'services', blurb: 'The Services page — its wording, and the service blocks on it.' },
    { id: 'shop',      label: 'Our Shop',     path: '/our-shop',  icon: 'building', blurb: 'The machines and what they mean for a piece.' },
    { id: 'portfolio', label: 'Portfolio',    path: '/portfolio', icon: 'image',    manager: 'pictures', blurb: 'The Portfolio page — its wording, and the pictures on it.' },
    { id: 'reviewsp',  label: 'Reviews',      path: '/reviews',   icon: 'star',     manager: 'reviews',  blurb: 'The Reviews page — its wording, and the reviews themselves.' },
    { id: 'about',     label: 'About',        path: '/about',     icon: 'book',     blurb: 'The shop story, timeline and client wall.' },
    { id: 'contact',   label: 'Contact',      path: '/contact',   icon: 'phone',    blurb: 'Form intro, FAQ answers, address and hours.' },
    { id: 'site',      label: 'Header & footer', path: '/',        icon: 'monitor',  only: 'site',
      blurb: 'Phone, email, address, hours and footer wording. Edited once here and used on every page.' },
  ];

  var SECTION_LABELS = {
    'hero-wrap': 'Hero', 'page-hero': 'Top of page', services: 'What we make',
    portfolio: 'Recent work', trusted: 'Recognition that lasts', reviews: 'Reviews',
    about: 'Our story', instagram: 'Social', visit: 'Visit us', machines: 'Our shop',
    lines: 'Service blocks', process: 'How it works', shop: 'Shop teaser', byo: 'Bring your own',
    gallery: 'Gallery', quote: 'Pull quote', story: 'Story', timeline: 'Timeline',
    values: 'Values', contact: 'Contact form', faq: 'Questions', leave: 'Leave a review',
    site: 'Header & footer', elsewhere: 'Links', materials: 'Materials', inside: 'Inside the shop', page: 'Page',
  };
  function sectionLabel(id) {
    if (SECTION_LABELS[id]) return SECTION_LABELS[id];
    return String(id).replace(/[-_.]/g, ' ').replace(/\b\w/g, function (c) { return c.toUpperCase(); });
  }

  /* ============================================================== state == */

  var content = {}, previous = {}, draft = {}, dirty = false;
  var previewWin = null, currentPage = null;

  function setDirty(v) {
    dirty = v;
    var s = el('#status'); if (!s) return;
    s.className = 'status' + (v ? ' dirty' : '');
    s.textContent = v ? 'Unsaved changes' : 'No changes yet';
    var b = el('#saveBtn'); if (b) b.disabled = !v;
  }
  window.addEventListener('beforeunload', function (e) { if (dirty) { e.preventDefault(); e.returnValue = ''; } });

  function post(msg) { if (previewWin) { try { previewWin.postMessage(Object.assign({ source: 'ae-admin' }, msg), '*'); } catch (e) {} } }
  function emit(key, value) { post({ type: 'field', key: key, value: value }); }
  function focusPreview(key) { post({ type: 'scrollTo', key: key }); }

  /* ============================================================== views == */

  function render() {
    var route = (location.hash || '#/').replace(/^#/, '');
    if (dirty && !confirmLeave()) return;
    var main = el('#main'); main.textContent = '';
    Array.prototype.forEach.call(document.querySelectorAll('#sideNav button'), function (b) {
      b.setAttribute('aria-current', String('#' + b.dataset.route === (location.hash || '#/')));
    });
    if (route.indexOf('/page/') === 0) {
      var seg = route.slice(6).split('/');
      return viewPage(main, seg[0], seg[1] === 'items', seg[1] === 'categories');
    }
    // Old direct links (dashboard cards, palette, saved bookmarks) still work —
    // they land on the right tab of the merged screen.
    if (route === '/reviews') { location.hash = '#/page/reviewsp/items'; return; }
    if (route === '/portfolio') { location.hash = '#/page/portfolio/items'; return; }
    if (route === '/media') return viewMedia(main);
    if (route === '/vendors') return viewVendors(main);
    if (route === '/catalog') return viewCatalog(main);
    if (route.indexOf('/catalog/') === 0) {
      var cseg = route.slice(9).split('/');
      return viewCatalogItems(main, cseg[0], cseg.slice(1).join('/'));
    }
    if (route.indexOf('/list/') === 0) return viewList(main, route.slice(6));
    if (route === '/leads') return viewLeads(main);
    if (route === '/activity') return viewActivity(main);
    if (route === '/changelog') return viewChangelog(main);
    viewDashboard(main);
  }
  var leaving = false;
  function confirmLeave() {
    if (leaving) return true;
    var ok = window.confirm('You have unsaved changes. Leave without saving?');
    if (ok) setDirty(false);
    return ok;
  }
  function header(title, blurb, actions, crumbs) {
    return h('div', { class: 'head' }, [
      h('div', {}, [
        crumbs ? h('div', { class: 'crumb' }, crumbs.map(function (c, i) {
          return h('span', {}, [
            i ? h('span', { class: 'sep', text: '›' }) : null,
            c.href ? h('a', { href: c.href, text: c.label }) : h('span', { text: c.label }),
          ]);
        })) : null,
        h('h2', { text: title }),
        blurb ? h('p', { text: blurb }) : null,
      ]),
      h('div', { class: 'head-actions' }, actions || []),
    ]);
  }

  /* -------------------------------------------------------- dashboard --- */

  function viewDashboard(main) {
    var v = (window.AE_VERSE_OF_DAY || function () { return null; })();

    main.appendChild(h('div', { class: 'dash-top' }, [
      h('div', { class: 'dash-hello' }, [
        h('p', { class: 'eyebrow-sm', text: greeting() + ',' }),
        h('h1', { text: firstName(me) }),
        h('p', { class: 'signed' }, [
          h('span', { class: 'dot' }), document.createTextNode('Signed in as '), h('b', { text: me }),
        ]),
      ]),
      v ? h('figure', { class: 'verse' }, [
        h('blockquote', { text: '“' + v.text + '”' }),
        h('figcaption', { text: '— ' + v.ref }),
      ]) : null,
    ]));

    main.appendChild(h('div', { class: 'dash-pad' }, [
      h('button', { class: 'dash-search', onclick: openPalette }, [
        icon('search'), h('span', { text: 'What do you want to change?' }), h('kbd', { text: '⌘K' }),
      ]),
    ]));

    main.appendChild(h('div', { class: 'dash-pad' }, [
      h('h3', { class: 'dash-h', text: 'Quick actions' }),
      h('div', { class: 'quick' }, [
        quickCard('home', 'Edit the homepage', 'Hero and section text', '#/page/home', 'tint-sky'),
        quickCard('star', 'Add a review', 'Shown on the homepage', '#/page/reviewsp/items', 'tint-amber'),
        quickCard('image', 'Add a picture', 'Your Portfolio page', '#/page/portfolio/items', 'tint-violet'),
        quickCard('image', 'Change a photo', 'Any page', '#/page/home', 'tint-green'),
        quickCard('mail', 'See quote requests', 'From the website form', '#/leads', 'tint-violet'),
      ]),
    ]));

    main.appendChild(h('div', { class: 'dash-pad' }, [
      h('h3', { class: 'dash-h', text: 'Pages' }),
      h('div', { class: 'cards' }, PAGES.map(function (p) {
        return h('button', { class: 'card', onclick: function () { location.hash = '#/page/' + p.id; } }, [
          h('div', { class: 'card-top' }, [h('span', { class: 'card-ic' }, [icon(p.icon)]), icon('external', 'card-go')]),
          h('h4', { text: p.label }), h('p', { text: p.blurb }),
          h('span', { class: 'card-path', text: p.path }),
        ]);
      })),
    ]));

    var cl = (window.AE_CHANGELOG || []).slice(0, 5);
    main.appendChild(h('div', { class: 'dash-pad dash-two' }, [
      h('section', {}, [
        h('h3', { class: 'dash-h' }, [icon('sparkles'), document.createTextNode(' What’s new')]),
        h('ul', { class: 'panel' }, cl.map(function (c) {
          return h('li', {}, [
            h('div', {}, [h('b', { text: c.title }), h('p', { text: c.body })]),
            h('span', { class: 'when', text: c.date.slice(5) }),
          ]);
        })),
      ]),
      h('section', {}, [
        h('h3', { class: 'dash-h' }, [icon('activity'), document.createTextNode(' Recent changes')]),
        h('ul', { class: 'panel', id: 'feedList' }, [h('li', { text: 'Loading…' })]),
      ]),
    ]));

    api('site_activity?select=*&order=created_at.desc&limit=8').then(function (rows) {
      var ul = el('#feedList'); if (!ul) return;
      ul.textContent = '';
      if (!rows || !rows.length) { ul.appendChild(h('li', { text: 'Nothing yet — your changes will appear here.' })); return; }
      rows.forEach(function (r) {
        ul.appendChild(h('li', {}, [
          h('span', { class: 'act-ic ' + actTint(r.action) }, [icon(actIcon(r.action))]),
          h('div', {}, [h('b', { text: actVerb(r.action) + (r.target ? ' · ' + r.target : '') }),
                        h('p', { text: firstName(r.actor) })]),
          h('span', { class: 'when', text: ago(r.created_at) }),
        ]));
      });
    }).catch(function () {});
  }
  function quickCard(ic, label, sub, href, tint) {
    return h('button', { class: 'quick-card', onclick: function () { location.hash = href; } }, [
      h('span', { class: 'quick-ic ' + tint }, [icon(ic)]),
      h('span', { class: 'quick-tx' }, [h('b', { text: label }), h('small', { text: sub })]),
    ]);
  }
  function actIcon(a) {
    return a === 'login' || a === 'logout' ? 'logout' : a === 'uploaded' ? 'image'
      : a === 'deleted' ? 'trash' : a === 'created' ? 'plus' : a === 'restored' ? 'undo' : 'check';
  }
  function actVerb(a) {
    return { login: 'Signed in', logout: 'Signed out', saved: 'Saved', created: 'Added',
             deleted: 'Deleted', uploaded: 'Uploaded a photo', restored: 'Restored' }[a] || a;
  }
  function actTint(a) {
    return a === 'deleted' ? 'tint-red' : (a === 'login' || a === 'logout') ? 'tint-sky'
      : a === 'uploaded' ? 'tint-green' : 'tint-amber';
  }

  function viewChangelog(main) {
    main.appendChild(header('What’s new', 'Everything added to the website and this editor, newest first.', [],
      [{ label: 'Dashboard', href: '#/' }, { label: 'What’s new' }]));
    main.appendChild(h('div', { class: 'pane-form' }, [
      h('ul', { class: 'panel' }, (window.AE_CHANGELOG || []).map(function (c) {
        return h('li', {}, [h('div', {}, [h('b', { text: c.title }), h('p', { text: c.body })]),
                            h('span', { class: 'when', text: c.date })]);
      })),
    ]));
  }

  /* ------------------------------------------------------- page editor -- */

  function viewPage(main, id, wantItems, wantCats) {
    var page = PAGES.filter(function (p) { return p.id === id; })[0];
    if (!page) return viewDashboard(main);
    var onItems = !!(page.manager && wantItems);
    var onCats = !!(page.manager === 'pictures' && wantCats);
    currentPage = page; draft = {};

    var saveBtn = h('button', { class: 'btn-gold', id: 'saveBtn', disabled: true }, [icon('check'), h('span', { text: 'Save & publish' })]);
    main.appendChild(header(page.label, page.blurb,
      (onItems || onCats) ? [] : [h('span', { class: 'status', id: 'status', text: 'No changes yet' }), saveBtn],
      [{ label: 'Dashboard', href: '#/' }, { label: page.label }]));

    /* Pages that own a list of things (Portfolio → its pictures, Reviews → the
       reviews) show both here instead of appearing twice in the sidebar. */
    if (page.manager) {
      var LBL = { pictures: 'Pictures', reviews: 'Reviews', services: 'Service blocks' };
      var tabs = [['', 'Wording'], ['/items', LBL[page.manager] || 'Items']];
      if (page.manager === 'pictures') tabs.push(['/categories', 'Filter buttons']);
      var bar = h('div', { class: 'tabs' });
      tabs.forEach(function (tb) {
        var on = (tb[0] === '' && !wantItems && !wantCats) ||
                 (tb[0] === '/items' && wantItems) ||
                 (tb[0] === '/categories' && wantCats);
        var b = h('button', { class: 'tab' + (on ? ' on' : ''), type: 'button', text: tb[1] });
        b.addEventListener('click', function () { location.hash = '#/page/' + page.id + tb[0]; });
        bar.appendChild(b);
      });
      main.appendChild(bar);
    }

    if (onCats) return renderCategoryManager(main);
    if (onItems) {
      if (page.manager === 'pictures') return renderPortfolioManager(main);
      if (page.manager === 'reviews') return renderReviewsManager(main);
      if (page.manager === 'services') return renderServicesManager(main);
    }

    var form = h('div', { class: 'pane-form', id: 'paneForm' }, [h('p', { class: 'hint', text: 'Reading the page…' })]);

    var frameW = 1280;
    var iframe = h('iframe', { src: page.path + '?adminPreview=1', width: frameW, height: 900, title: 'Live preview' });
    var frameBox = h('div', { class: 'prev-frame' }, [iframe]);
    var btnDesk = h('button', { class: 'icobtn on', title: 'Desktop' }, [icon('monitor')]);
    var btnPhone = h('button', { class: 'icobtn', title: 'Phone' }, [icon('smartphone')]);
    btnDesk.addEventListener('click', function () { setW(1280, btnDesk); });
    btnPhone.addEventListener('click', function () { setW(430, btnPhone); });

    var prev = h('div', { class: 'pane-prev' }, [
      h('div', { class: 'prev-bar' }, [
        h('strong', { text: 'Live preview' }),
        h('span', { class: 'follow', id: 'following' }),
        h('span', { class: 'sp' }),
        btnDesk, btnPhone,
        h('button', { class: 'icobtn', title: 'Reload', onclick: function () { iframe.src = iframe.src; } }, [icon('refresh')]),
        h('a', { class: 'icobtn', href: page.path, target: '_blank', title: 'Open in a new tab' }, [icon('external')]),
      ]),
      h('div', { class: 'prev-wrap', id: 'prevWrap' }, [frameBox]),
    ]);
    main.appendChild(h('div', { class: 'split' }, [form, prev]));

    function setW(w, btn) {
      frameW = w; iframe.width = w;
      [btnDesk, btnPhone].forEach(function (b) { b.classList.remove('on'); });
      btn.classList.add('on'); fitSoon();
    }
    /* The frame is absolutely positioned so a 1280px iframe cannot inflate its own
       container and defeat the width measurement used to scale it. */
    function fit() {
      var wrap = el('#prevWrap'); if (!wrap) return;
      var pane = wrap.parentElement;
      var avail = (pane ? pane.clientWidth : wrap.clientWidth) - 32;
      if (avail <= 0) return;
      var scale = Math.min(1, avail / frameW);
      frameBox.style.width = frameW + 'px';
      frameBox.style.height = '900px';
      frameBox.style.transform = 'translateX(-50%) scale(' + scale + ')';
      wrap.style.minHeight = Math.round(900 * scale + 32) + 'px';
    }
    function fitSoon() { fit(); requestAnimationFrame(fit); setTimeout(fit, 150); setTimeout(fit, 600); }
    iframe.addEventListener('load', function () {
      previewWin = iframe.contentWindow;
      fitSoon();
      post({ type: 'getFields' });   // ask the page what it contains
    });
    window.addEventListener('resize', fit);
    fitSoon();

    saveBtn.addEventListener('click', function () { savePage(page, saveBtn); });
    setDirty(false);
  }

  /* The page answers with everything editable on it, so the form is generated
     from the live DOM rather than a hand-written list that drifts out of date. */
  window.addEventListener('message', function (e) {
    var d = e.data;
    if (!d || d.source !== 'ae-site') return;
    if (d.type === 'fields') buildForm(d.fields || []);
  });

  function buildForm(fields) {
    var form = el('#paneForm'); if (!form) return;
    fields = fields.filter(function (f) {
      return currentPage && currentPage.only ? f.section === currentPage.only : f.section !== 'site';
    });
    form.textContent = '';
    if (!fields.length) { form.appendChild(h('p', { class: 'hint', text: 'Nothing editable found on this page.' })); return; }

    var groups = {}, order = [];
    fields.forEach(function (f) {
      if (!groups[f.section]) { groups[f.section] = []; order.push(f.section); }
      groups[f.section].push(f);
    });

    form.appendChild(h('p', { class: 'hint', text: fields.length + ' editable items. Changes preview instantly — press Save & publish to put them live.' }));

    order.forEach(function (sec) {
      var wrap = h('div', { class: 'sec' });
      wrap.appendChild(h('h3', {}, [icon('layers'), document.createTextNode(' ' + sectionLabel(sec)),
                                    h('span', { class: 'cnt', text: groups[sec].length })]));
      groups[sec].forEach(function (f) { wrap.appendChild(fieldControl(f)); });
      form.appendChild(wrap);

      /* Scroll-follow: when a group crosses a band ~40% down the form, the preview
         jumps to that part of the page, so the two panes stay in step. */
      try {
        var io = new IntersectionObserver(function (entries) {
          entries.forEach(function (en) {
            if (!en.isIntersecting) return;
            var first = groups[sec][0];
            if (first) focusPreview(first.key);
            var lab = el('#following'); if (lab) lab.textContent = 'showing: ' + sectionLabel(sec);
          });
        }, { root: form, rootMargin: '-40% 0px -55% 0px' });
        io.observe(wrap);
      } catch (err) {}
    });
  }

  function fieldControl(f) {
    var wrap = h('div', { class: 'field' });
    var saved = content[f.key];
    var val = saved != null ? saved : (f.value != null ? f.value : '');
    var label = f.label || f.key;

    if (f.type === 'image') {
      var img = h('img', { class: 'img-thumb', src: val || '/assets/favicon.svg', alt: '' });
      var file = h('input', { type: 'file', accept: 'image/*' });
      var bar = h('i'); var prog = h('div', { class: 'prog' }, [bar]); prog.style.display = 'none';
      file.addEventListener('change', function () {
        var fl = file.files && file.files[0]; if (!fl) return;
        var aspect = f.aspect || null;
        var chosen = (window.AE_CROP ? window.AE_CROP.open(fl, aspect) : toWebp(fl));
        chosen.then(function (blob) {
          if (blob.size > 10 * 1024 * 1024) { toast('That photo is still over 10 MB after cropping.', 'err'); return; }
          prog.style.display = ''; bar.style.width = '35%';
          return uploadImage(blob, fl.name);
        }).then(function (url) {
          if (!url) return;
          bar.style.width = '100%'; img.src = url;
          draft[f.key] = url; setDirty(true); emit(f.key, url); focusPreview(f.key);
          setTimeout(function () { prog.style.display = 'none'; bar.style.width = '0'; }, 500);
          toast('Photo uploaded — press Save to publish it.');
        }).catch(function (e) {
          prog.style.display = 'none';
          if (e && e.message === 'cancelled') return;      // closing the cropper is not an error
          toast('Upload failed: ' + e.message, 'err');
        });
        file.value = '';   // let the same file be re-picked after a cancel
      });
      wrap.appendChild(h('label', { text: 'Photo — ' + label }));
      wrap.appendChild(h('div', { class: 'img-slot' }, [img, h('div', { class: 'img-side' }, [file, prog])]));
      wrap.appendChild(peekBtn(f));
      return wrap;
    }

    if (f.type === 'rich') {
      var tools = h('div', { class: 'rt-tools' });
      [['B', 'bold'], ['I', 'italic'], ['H2', 'formatBlock:h2'], ['H3', 'formatBlock:h3'],
       ['List', 'insertUnorderedList'], ['1.', 'insertOrderedList'], ['Quote', 'formatBlock:blockquote'],
       ['Link', 'link'], ['Clear', 'removeFormat']].forEach(function (t) {
        tools.appendChild(h('button', { type: 'button', text: t[0],
          onmousedown: function (e) { e.preventDefault(); }, onclick: function () { richCmd(t[1]); } }));
      });
      var rt = h('div', { class: 'rt', contenteditable: 'true', html: val });
      rt.addEventListener('paste', function (e) {   // Word/Docs junk stripped
        e.preventDefault();
        var txt = (e.clipboardData || window.clipboardData).getData('text/plain');
        document.execCommand('insertText', false, txt);
      });
      rt.addEventListener('input', function () { draft[f.key] = rt.innerHTML; setDirty(true); emit(f.key, rt.innerHTML); });
      rt.addEventListener('focus', function () { focusPreview(f.key); });
      wrap.appendChild(h('label', { text: label }));
      wrap.appendChild(tools); wrap.appendChild(rt);
      var rrc = restoreControl(f, function (v) { rt.innerHTML = v; });
      if (rrc) wrap.appendChild(rrc);
      wrap.appendChild(peekBtn(f));
      return wrap;
    }

    var long = f.type === 'textarea' || String(val).length > 90;
    var input = long ? h('textarea', {}) : h('input', { type: 'text' });
    input.value = val;
    var counter = h('span', { class: 'count' });
    function tick() { counter.textContent = input.value.length + ' chars'; }
    tick();
    input.addEventListener('input', function () { draft[f.key] = input.value; setDirty(true); tick(); emit(f.key, input.value); });
    input.addEventListener('focus', function () { focusPreview(f.key); });

    wrap.appendChild(h('label', {}, [document.createTextNode(label), counter]));
    wrap.appendChild(input);
    var rc = restoreControl(f, function (v) { input.value = v; tick(); });
    if (rc) wrap.appendChild(rc);
    wrap.appendChild(peekBtn(f));
    return wrap;
  }

  function peekBtn(f) {
    var b = h('button', { class: 'peek', type: 'button', title: 'Scroll the preview to this' }, [icon('eye'), h('span', { text: 'Show on page' })]);
    b.addEventListener('click', function () { focusPreview(f.key); });
    return b;
  }

  /* Every save stores the prior value via a Postgres trigger, so a one-step undo
     needs no history table — it covers the commonest "put it back" request. */
  function restoreControl(f, setValue) {
    var prev = previous[f.key];
    if (prev == null || prev === '' || prev === content[f.key]) return null;
    var label = String(prev).replace(/<[^>]+>/g, '').slice(0, 46);
    var btn = h('button', { type: 'button', class: 'linkish', text: 'Restore' });
    btn.addEventListener('click', function () {
      setValue(prev); draft[f.key] = prev; setDirty(true); emit(f.key, prev);
      toast('Previous version restored — press Save to publish it.');
    });
    return h('div', { class: 'sub' }, [
      icon('undo'), document.createTextNode(' Previous: “' + label + (String(prev).length > 46 ? '…' : '') + '” '), btn,
    ]);
  }

  function richCmd(cmd) {
    if (cmd === 'link') {
      var u = window.prompt('Link address (https://…)'); if (!u) return;
      if (!/^https?:\/\//i.test(u)) { toast('Links must start with https://', 'err'); return; }
      document.execCommand('createLink', false, u); return;
    }
    if (cmd.indexOf('formatBlock:') === 0) { document.execCommand('formatBlock', false, cmd.split(':')[1]); return; }
    document.execCommand(cmd, false, null);
  }

  /* Safety net for the upload path. The cropper normally re-encodes every photo
     to WebP, but both upload call sites fall back to the raw File if crop.js
     failed to load — which would put a 12 MB HEIC straight into storage and
     onto the page. This re-encodes without any UI so the fallback is still a
     web-sized WebP. Returns the original blob if the browser can't do it. */
  function toWebp(file, maxEdge, quality) {
    var cap = maxEdge || 2400, q = quality || 0.82;
    if (!window.createImageBitmap && !window.Image) return Promise.resolve(file);
    return new Promise(function (resolve) {
      var img = new Image();
      var url = URL.createObjectURL(file);
      img.onload = function () {
        URL.revokeObjectURL(url);
        try {
          var w = img.naturalWidth, hgt = img.naturalHeight;
          var k = Math.min(1, cap / Math.max(w, hgt));
          var c = document.createElement('canvas');
          c.width = Math.round(w * k); c.height = Math.round(hgt * k);
          c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
          c.toBlob(function (b) { resolve(b || file); }, 'image/webp', q);
        } catch (e) { resolve(file); }
      };
      img.onerror = function () { URL.revokeObjectURL(url); resolve(file); };
      img.src = url;
    });
  }

  function uploadImage(file, origName) {
    var safe = String(origName || file.name || 'photo.jpg').toLowerCase().replace(/[^a-z0-9.]+/g, '-').replace(/^-|-$/g, '');
    safe = safe.replace(/\.(heic|heif|png|jpg|jpeg)$/, '.webp');  // cropper always emits WebP
    var path = Date.now() + '-' + safe;
    return fetch(SB + '/storage/v1/object/site-photos/' + encodeURIComponent(path), {
      method: 'POST',
      headers: { apikey: ANON, Authorization: 'Bearer ' + session.access_token, 'Content-Type': file.type || 'image/webp' },
      body: file,
    }).then(function (r) {
      if (!r.ok) return r.text().then(function (t) { throw new Error(t.slice(0, 120)); });
      var url = SB + '/storage/v1/object/public/site-photos/' + encodeURIComponent(path);
      api('media', { method: 'POST', headers: { Prefer: 'return=minimal' },
        body: JSON.stringify({ path: path, url: url, bytes: file.size, created_by: me }) }).catch(function () {});
      logActivity('uploaded', 'Photo — ' + safe);
      return url;
    });
  }

  function savePage(page, btn) {
    var keys = Object.keys(draft); if (!keys.length) return;
    btn.disabled = true; el('#status').textContent = 'Saving…';
    var rows = keys.map(function (k) { return { key: k, value: draft[k], updated_by: me }; });
    api('site_content?on_conflict=key', {
      method: 'POST',
      headers: { Prefer: 'resolution=merge-duplicates,return=representation' },
      body: JSON.stringify(rows),
    }).then(function (saved) {
      (saved || []).forEach(function (r) { content[r.key] = r.value; previous[r.key] = r.previous_value; });
      keys.forEach(function (k) { logActivity('saved', page.label + ' — ' + k, null, content[k], draft[k]); });
      draft = {}; setDirty(false);
      var s = el('#status'); s.className = 'status saved'; s.textContent = 'All changes saved';
      toast('Saved — the website is updated.', null, page.path);
      post({ type: 'reload' });
    }).catch(function (e) {
      btn.disabled = false;
      el('#status').className = 'status dirty'; el('#status').textContent = 'Unsaved changes';
      toast('Couldn’t reach the server — your text is still here. Try again.', 'err');
      console.error(e);
          window.AE_SENTRY.capture(e, { step: 'save-page' });
    });
  }

  /* ---------------------------------------------------------- reviews --- */

  function renderReviewsManager(main) {
    main.appendChild(h('div', { class: 'pane-form' }, [
      h('div', { class: 'toolbar' }, [
        h('p', { class: 'hint', text: 'Reviews shown on your homepage and Reviews page.' }),
        h('span', { class: 'sp' }),
        (function () {
          var b = h('button', { class: 'btn-gold btn-sm' }, [icon('plus'), h('span', { text: 'Add review' })]);
          b.addEventListener('click', addReview);
          return b;
        })(),
      ]),
      h('div', { class: 'rows', id: 'revRows' }, [h('p', { class: 'hint', text: 'Loading…' })]),
    ]));
    loadReviews();
  }

  function viewReviewsLegacy(main) {
    main.appendChild(header('Reviews', 'Shown on the homepage and the Reviews page. Hiding one takes it off the site but keeps it here.',
      [(function () { var b = h('button', { class: 'btn-line' }, [icon('plus'), h('span', { text: 'Add review' })]); b.addEventListener('click', addReview); return b; })()],
      [{ label: 'Dashboard', href: '#/' }, { label: 'Customer reviews' }]));
    main.appendChild(h('div', { class: 'pane-form' }, [h('div', { class: 'rows', id: 'revRows' }, [h('p', { class: 'hint', text: 'Loading…' })])]));
    loadReviews();
  }
  function loadReviews() {
    api('reviews?select=*&order=order_index.asc,id.asc').then(function (rows) {
      var box = el('#revRows'); if (!box) return;
      box.textContent = '';
      if (!rows.length) { box.appendChild(h('p', { class: 'hint', text: 'No reviews yet — press “Add review”.' })); return; }
      rows.forEach(function (r) { box.appendChild(reviewRow(r)); });
    }).catch(function (e) { toast('Could not load reviews: ' + e.message, 'err'); window.AE_SENTRY.capture(e, { step: 'load-reviews' }); window.AE_SENTRY.capture(e, { step: 'load-reviews' }); });
  }
  function reviewRow(r) {
    var body = h('div', { class: 'row-body' }); body.hidden = true;
    var top = h('div', { class: 'row-top' }, [
      h('span', { class: 'av', style: 'background:' + (r.avatar_hex || '#b08e4e'), text: (r.author || '?').charAt(0) }),
      h('b', { text: r.author || '(no name)' }), h('span', { class: 'meta', text: r.meta || '' }),
      h('span', { class: 'sp' }),
      r.featured ? h('span', { class: 'pill feat', text: 'Featured' }) : null,
      h('span', { class: 'pill ' + (r.visible ? 'on' : 'off') }, [icon(r.visible ? 'eye' : 'eyeOff'), h('span', { text: r.visible ? 'On site' : 'Hidden' })]),
    ]);
    top.addEventListener('click', function () { body.hidden = !body.hidden; });
    var row = h('div', { class: 'row' }, [top, body]);

    var author = h('input', { type: 'text', value: r.author || '' });
    var meta = h('input', { type: 'text', value: r.meta || '' });
    var text = h('textarea', {}); text.value = r.body || '';
    var feat = h('input', { type: 'checkbox' }); feat.checked = !!r.featured;
    var vis = h('input', { type: 'checkbox' }); vis.checked = !!r.visible;
    body.appendChild(h('div', { class: 'field' }, [h('label', { text: 'Name' }), author]));
    body.appendChild(h('div', { class: 'field' }, [h('label', { text: 'When / source' }), meta]));
    body.appendChild(h('div', { class: 'field' }, [h('label', { text: 'Review' }), text]));
    body.appendChild(h('div', { class: 'checks' }, [
      h('label', {}, [feat, document.createTextNode(' Show as a large featured review')]),
      h('label', {}, [vis, document.createTextNode(' Visible on the site')]),
    ]));
    var save = h('button', { class: 'btn-gold btn-sm', text: 'Save review' });
    save.addEventListener('click', function () {
      api('reviews?id=eq.' + r.id, { method: 'PATCH', headers: { Prefer: 'return=minimal' },
        body: JSON.stringify({ author: author.value, meta: meta.value, body: text.value, featured: feat.checked, visible: vis.checked }) })
        .then(function () { logActivity('saved', 'Review — ' + author.value); toast('Review saved.'); loadReviews(); })
        .catch(function (e) { toast('Could not save: ' + e.message, 'err'); window.AE_SENTRY.capture(e, { step: 'save-review' }); });
    });
    var del = h('button', { class: 'btn-line btn-sm', text: 'Delete' });
    del.addEventListener('click', function () {
      if (!window.confirm('Delete this review permanently?\n\nTip: unticking “Visible on the site” hides it and keeps it here.')) return;
      api('reviews?id=eq.' + r.id, { method: 'DELETE' })
        .then(function () { logActivity('deleted', 'Review — ' + (r.author || '')); toast('Review deleted.'); loadReviews(); })
        .catch(function (e) { toast('Could not delete: ' + e.message, 'err'); window.AE_SENTRY.capture(e, { step: 'delete-review' }); });
    });
    body.appendChild(h('div', { class: 'rowacts' }, [save, del]));
    return row;
  }
  function addReview() {
    api('reviews', { method: 'POST', headers: { Prefer: 'return=minimal' },
      body: JSON.stringify({ author: 'New review', body: '', visible: false, rating: 5 }) })
      .then(function () { logActivity('created', 'Review'); toast('Added — hidden until you tick “Visible”.'); loadReviews(); })
      .catch(function (e) { toast('Could not add: ' + e.message, 'err'); window.AE_SENTRY.capture(e, { step: 'add-review' }); });
  }

  /* -------------------------------------------------------- portfolio --- */

  var PF_CATS = [
    ['awards', 'Awards'], ['plaques', 'Plaques'], ['gifts', 'Gifts'],
    ['engraving', 'Engraving'], ['shop', 'The shop'],
  ];

  function renderPortfolioManager(main) {
    main.appendChild(h('div', { class: 'pane-form' }, [
      h('div', { class: 'toolbar' }, [
        h('p', { class: 'hint', text: 'These are the photos on your Portfolio page. Click one to edit it.' }),
        h('span', { class: 'sp' }),
        (function () {
          var b = h('button', { class: 'btn-gold btn-sm' }, [icon('plus'), h('span', { text: 'Add picture' })]);
          b.addEventListener('click', addPortfolioItem);
          return b;
        })(),
      ]),
      h('div', { class: 'pf-grid', id: 'pfRows' }, [h('p', { class: 'hint', text: 'Loading…' })]),
    ]));
    loadPortfolio();
  }

  function viewPortfolioLegacy(main) {
    main.appendChild(header(
      'Portfolio pictures',
      'The photos shown on your Portfolio page. Ticking the homepage box also puts a piece in the Recent work band on the front page. Hiding takes a piece off the site but keeps it here.',
      [(function () {
        var b = h('button', { class: 'btn-line' }, [icon('plus'), h('span', { text: 'Add piece' })]);
        b.addEventListener('click', addPortfolioItem);
        return b;
      })()],
      [{ label: 'Dashboard', href: '#/' }, { label: 'Portfolio pictures' }]));
    main.appendChild(h('div', { class: 'pane-form' }, [
      h('div', { class: 'pf-grid', id: 'pfRows' }, [h('p', { class: 'hint', text: 'Loading…' })]),
    ]));
    loadPortfolio();
  }

  function loadPortfolio() {
    api('portfolio_items?select=*&order=order_index.asc,created_at.asc').then(function (rows) {
      var box = el('#pfRows'); if (!box) return;
      box.textContent = '';
      if (!rows.length) {
        box.appendChild(h('p', { class: 'hint', text: 'No pieces yet — press “Add piece”. Until you add one, the twelve photos already on the site stay put.' }));
        return;
      }
      rows.forEach(function (r, i) { box.appendChild(portfolioRow(r, i, rows.length)); });
    }).catch(function (e) {
      toast('Could not load the portfolio: ' + e.message, 'err');
      window.AE_SENTRY.capture(e, { step: 'load-portfolio' });
    });
  }

  /* A card grid, not a list. This screen is about pictures, so the picture is
     the row — big enough to recognise a trophy at a glance. Selecting a card
     expands it to the full grid width and shows the editor underneath, so
     there is one place to look instead of a list plus a detail pane. */
  function portfolioRow(r, idx, total) {
    var card = h('div', { class: 'pf-card' + (r.visible ? '' : ' is-hidden') });

    var badges = h('div', { class: 'pf-badges' }, [
      r.featured ? h('span', { class: 'pf-badge feat', text: 'Homepage' }) : null,
      r.visible ? null : h('span', { class: 'pf-badge off', text: 'Hidden' }),
    ]);

    var shot = h('div', { class: 'pf-shot' }, [
      h('img', { src: r.image_url || '', alt: '', loading: 'lazy' }),
      badges,
    ]);
    var cap = h('div', { class: 'pf-cap' }, [
      h('b', { text: r.title || '(untitled)' }),
      h('span', { text: r.caption || '' }),
    ]);
    var head = h('button', { class: 'pf-head', type: 'button' }, [shot, cap]);
    card.appendChild(head);

    var body = h('div', { class: 'pf-body' }); body.hidden = true;
    card.appendChild(body);
    head.addEventListener('click', function () {
      var open = body.hidden;
      // Only one card open at a time — otherwise the grid reflows constantly.
      Array.prototype.forEach.call(document.querySelectorAll('.pf-card.is-open'), function (c) {
        c.classList.remove('is-open');
        var b = c.querySelector('.pf-body'); if (b) b.hidden = true;
      });
      if (open) { card.classList.add('is-open'); body.hidden = false; }
    });

    var title = h('input', { type: 'text', value: r.title || '' });
    var caption = h('input', { type: 'text', value: r.caption || '' });
    var alt = h('input', { type: 'text', value: r.alt || '' });
    var cat = h('select', {});
    PF_CATS.forEach(function (c) {
      var o = h('option', { value: c[0], text: c[1] });
      if (c[0] === r.category) o.selected = true;
      cat.appendChild(o);
    });
    var feat = h('input', { type: 'checkbox' }); feat.checked = !!r.featured;
    var vis = h('input', { type: 'checkbox' }); vis.checked = !!r.visible;

    var imgUrl = r.image_url || '';
    var preview = h('img', { src: imgUrl, alt: '', class: 'pf-preview' });
    var file = h('input', { type: 'file', accept: 'image/*' });
    file.addEventListener('change', function () {
      var f = file.files && file.files[0]; if (!f) return;
      // 4/5 matches the gallery tile on the site; 1400px is ~2x the rendered size.
      var chosen = (window.AE_CROP ? window.AE_CROP.open(f, 4 / 5, 1400) : toWebp(f, 1400));
      chosen.then(function (blob) {
        if (!blob) return;
        toast('Uploading photo…');
        return uploadImage(blob, f.name).then(function (url) {
          imgUrl = url; preview.src = url;
          var thumb = shot.querySelector('img'); if (thumb) thumb.src = url;
          toast('Photo uploaded — press “Save” to keep it.');
        });
      }).catch(function (e) {
        toast('Could not upload: ' + e.message, 'err');
        window.AE_SENTRY.capture(e, { step: 'upload-portfolio-photo' });
      });
      file.value = '';
    });

    var grid2 = h('div', { class: 'pf-form' }, [
      h('div', { class: 'pf-form-photo' }, [preview, file]),
      h('div', { class: 'pf-form-fields' }, [
        h('div', { class: 'field' }, [h('label', { text: 'Title (the bold line)' }), title]),
        h('div', { class: 'field' }, [h('label', { text: 'Caption (the line under it)' }), caption]),
        h('div', { class: 'field' }, [h('label', { text: 'Photo description (screen readers & Google)' }), alt]),
        h('div', { class: 'field' }, [h('label', { text: 'Filter category' }), cat]),
        h('div', { class: 'checks' }, [
          h('label', {}, [feat, document.createTextNode(' Also show on the homepage')]),
          h('label', {}, [vis, document.createTextNode(' Visible on the site')]),
        ]),
      ]),
    ]);
    body.appendChild(grid2);

    var save = h('button', { class: 'btn-gold btn-sm', text: 'Save' });
    save.addEventListener('click', function () {
      api('portfolio_items?id=eq.' + r.id, {
        method: 'PATCH', headers: { Prefer: 'return=minimal' },
        body: JSON.stringify({
          title: title.value, caption: caption.value, alt: alt.value,
          image_url: imgUrl, category: cat.value,
          featured: feat.checked, visible: vis.checked, updated_by: me,
        }),
      }).then(function () {
        logActivity('saved', 'Portfolio — ' + title.value);
        toast('Saved — the website is updated.', null, '/portfolio');
        loadPortfolio();
      }).catch(function (e) {
        toast('Could not save: ' + e.message, 'err');
        window.AE_SENTRY.capture(e, { step: 'save-portfolio' });
      });
    });

    function move(dir) {
      var b = h('button', { class: 'btn-line btn-sm', text: dir < 0 ? '← Earlier' : 'Later →' });
      if ((dir < 0 && idx === 0) || (dir > 0 && idx === total - 1)) b.disabled = true;
      b.addEventListener('click', function () {
        api('portfolio_items?select=id,order_index&order=order_index.asc,created_at.asc').then(function (all) {
          var i = all.findIndex(function (x) { return x.id === r.id; });
          var j = i + dir;
          if (i < 0 || j < 0 || j >= all.length) return;
          return Promise.all([
            api('portfolio_items?id=eq.' + all[i].id, { method: 'PATCH', headers: { Prefer: 'return=minimal' }, body: JSON.stringify({ order_index: (j + 1) * 10 }) }),
            api('portfolio_items?id=eq.' + all[j].id, { method: 'PATCH', headers: { Prefer: 'return=minimal' }, body: JSON.stringify({ order_index: (i + 1) * 10 }) }),
          ]);
        }).then(function () { loadPortfolio(); })
          .catch(function (e) {
            toast('Could not reorder: ' + e.message, 'err');
            window.AE_SENTRY.capture(e, { step: 'reorder-portfolio' });
          });
      });
      return b;
    }

    var del = h('button', { class: 'btn-line btn-sm danger', text: 'Delete' });
    del.addEventListener('click', function () {
      if (!window.confirm('Delete this piece permanently?\n\nTip: unticking “Visible on the site” hides it and keeps it here.')) return;
      api('portfolio_items?id=eq.' + r.id, { method: 'DELETE' })
        .then(function () {
          logActivity('deleted', 'Portfolio — ' + (r.title || ''));
          toast('Piece deleted.'); loadPortfolio();
        })
        .catch(function (e) {
          toast('Could not delete: ' + e.message, 'err');
          window.AE_SENTRY.capture(e, { step: 'delete-portfolio' });
        });
    });

    body.appendChild(h('div', { class: 'pf-acts' }, [save, move(-1), move(1), h('span', { class: 'sp' }), del]));
    return card;
  }

  function addPortfolioItem() {
    api('portfolio_items', {
      method: 'POST', headers: { Prefer: 'return=minimal' },
      body: JSON.stringify({ title: 'New piece', visible: false, category: 'awards', order_index: 999, updated_by: me }),
    }).then(function () {
      logActivity('created', 'Portfolio piece');
      toast('Added — add a photo, then tick “Visible” to put it on the site.');
      loadPortfolio();
    }).catch(function (e) {
      toast('Could not add: ' + e.message, 'err');
      window.AE_SENTRY.capture(e, { step: 'add-portfolio' });
    });
  }

  /* ------------------------------------------------------------ photos --- */

  /* Every image the client has ever uploaded, in one place. The files live in
     the `site-photos` storage bucket; the `media` table is the index of them.
     Deleting is deliberately guarded — a photo that is still on a page would
     leave a broken image, so we check first and say where it is used. */

  function fmtBytes(n) {
    if (!n) return '—';
    if (n < 1024) return n + ' B';
    if (n < 1024 * 1024) return Math.round(n / 1024) + ' KB';
    return (n / 1048576).toFixed(1) + ' MB';
  }

  function viewMedia(main) {
    main.appendChild(header(
      'Photo library',
      'Every photo on your website, in one place. The ones you upload yourself sit in your own Supabase storage; the rest were built into the site when we made it.',
      [], [{ label: 'Dashboard', href: '#/' }, { label: 'Photo library' }]));
    main.appendChild(h('div', { class: 'pane-form' }, [
      h('h3', { class: 'media-h', text: 'Photos you have uploaded' }),
      h('p', { class: 'hint', id: 'mediaTotals', text: 'Loading…' }),
      h('div', { class: 'media-grid', id: 'mediaGrid' }),

      h('h3', { class: 'media-h', text: 'Photos built into your site' }),
      h('p', { class: 'hint', id: 'builtinTotals', text: 'Loading…' }),
      h('div', { class: 'media-grid', id: 'builtinGrid' }),
    ]));
    loadMedia();
    loadBuiltIn();
  }

  /* The photos that shipped with the site live in /assets in the codebase, not
     in Supabase storage — so they genuinely cannot be deleted from here. They
     are still shown, read-only, because a "Photos" screen that hides most of
     the site's photos is the kind of half-truth the panel is meant to avoid. */
  function loadBuiltIn() {
    fetch('/admin/site-photos.json', { cache: 'no-store' })
      .then(function (r) { return r.ok ? r.json() : null; })
      .then(function (d) {
        var grid = el('#builtinGrid'), totals = el('#builtinTotals');
        if (!grid || !totals) return;
        var items = (d && d.items) || [];
        if (!items.length) { totals.textContent = 'Could not list these right now.'; return; }
        var bytes = items.reduce(function (a, i) { return a + (i.bytes || 0); }, 0);
        totals.textContent = items.length + ' photos · ' + fmtBytes(bytes) +
          ' · these are part of the website itself. To swap one, edit the page it appears on, or ask us.';
        grid.textContent = '';
        items.forEach(function (i) {
          grid.appendChild(h('figure', { class: 'media-tile is-builtin' }, [
            h('img', { src: i.url, alt: '', loading: 'lazy' }),
            h('figcaption', {}, [
              h('span', { class: 'media-meta', text: i.name }),
              h('span', { class: 'pill off', text: 'Built in' }),
            ]),
          ]));
        });
      })
      .catch(function () {
        var totals = el('#builtinTotals');
        if (totals) totals.textContent = 'Could not list these right now.';
      });
  }

  function loadMedia() {
    Promise.all([
      api('media?select=*&order=created_at.desc&limit=300'),
      api('portfolio_items?select=title,image_url').catch(function () { return []; }),
      api('site_content?select=key,value').catch(function () { return []; }),
    ]).then(function (res) {
      var rows = res[0] || [], pieces = res[1] || [], content = res[2] || [];
      var grid = el('#mediaGrid'), totals = el('#mediaTotals');
      if (!grid) return;

      var bytes = rows.reduce(function (a, r) { return a + (r.bytes || 0); }, 0);
      totals.textContent = rows.length
        ? rows.length + ' photo' + (rows.length === 1 ? '' : 's') + ' · ' + fmtBytes(bytes) + ' used'
        : 'Nothing uploaded yet — this fills up as you add photos to your Portfolio or your pages.';

      grid.textContent = '';
      if (!rows.length) return;

      function usedBy(url) {
        var where = [];
        pieces.forEach(function (x) { if (x.image_url === url) where.push('Portfolio — ' + (x.title || 'untitled')); });
        content.forEach(function (c) { if (c.value && String(c.value).indexOf(url) !== -1) where.push('Page — ' + c.key); });
        return where;
      }

      rows.forEach(function (r) {
        var where = usedBy(r.url);
        var tile = h('figure', { class: 'media-tile' }, [
          h('img', { src: r.url, alt: r.alt || '', loading: 'lazy' }),
          h('figcaption', {}, [
            h('span', { class: 'media-meta', text: fmtBytes(r.bytes) + ' · ' + ago(r.created_at) }),
            where.length
              ? h('span', { class: 'pill on', text: 'In use' })
              : h('span', { class: 'pill off', text: 'Not used' }),
          ]),
        ]);

        var copy = h('button', { class: 'btn-line btn-sm', text: 'Copy link' });
        copy.addEventListener('click', function () {
          if (navigator.clipboard) {
            navigator.clipboard.writeText(r.url)
              .then(function () { toast('Web address copied.'); })
              .catch(function () { window.prompt('Copy this address:', r.url); });
          } else { window.prompt('Copy this address:', r.url); }
        });

        var del = h('button', { class: 'btn-line btn-sm', text: 'Delete' });
        del.addEventListener('click', function () {
          var msg = where.length
            ? 'This photo is still being used here:\n\n  ' + where.join('\n  ') +
              '\n\nDeleting it will leave a broken image on the website. Delete anyway?'
            : 'Delete this photo permanently?';
          if (!window.confirm(msg)) return;
          deleteMedia(r);
        });

        tile.appendChild(h('div', { class: 'rowacts', style: 'padding:0 8px 10px' }, [copy, del]));
        grid.appendChild(tile);
      });
    }).catch(function (e) {
      var t2 = el('#mediaTotals'); if (t2) t2.textContent = 'Could not load your photos: ' + e.message;
      window.AE_SENTRY.capture(e, { step: 'load-media' });
    });
  }

  function deleteMedia(r) {
    // Remove the file from the bucket first; only drop the index row if that
    // succeeded, so we never show an empty library while files linger.
    fetch(SB + '/storage/v1/object/site-photos/' + encodeURIComponent(r.path), {
      method: 'DELETE',
      headers: { apikey: ANON, Authorization: 'Bearer ' + session.access_token },
    }).then(function (res) {
      if (!res.ok && res.status !== 404) return res.text().then(function (x) { throw new Error(x.slice(0, 120)); });
      return api('media?id=eq.' + r.id, { method: 'DELETE' });
    }).then(function () {
      logActivity('deleted', 'Photo — ' + r.path);
      toast('Photo deleted.');
      loadMedia();
    }).catch(function (e) {
      toast('Could not delete: ' + e.message, 'err');
      window.AE_SENTRY.capture(e, { step: 'delete-media' });
    });
  }

  /* ------------------------------------------------ portfolio categories --
     The filter chips on the Portfolio page. Adding one here makes it available
     as a category on every picture and adds a chip to the public page. */

  function renderCategoryManager(main) {
    main.appendChild(h('div', { class: 'pane-form' }, [
      h('div', { class: 'toolbar' }, [
        h('p', { class: 'hint', text: 'These are the filter buttons on your Portfolio page. Every picture belongs to one.' }),
        h('span', { class: 'sp' }),
        (function () {
          var b = h('button', { class: 'btn-gold btn-sm' }, [icon('plus'), h('span', { text: 'Add category' })]);
          b.addEventListener('click', addCategory);
          return b;
        })(),
      ]),
      h('div', { class: 'rows', id: 'catRows' }, [h('p', { class: 'hint', text: 'Loading…' })]),
    ]));
    loadCategories();
  }

  function loadCategories() {
    Promise.all([
      api('portfolio_categories?select=*&order=order_index.asc'),
      api('portfolio_items?select=category').catch(function () { return []; }),
    ]).then(function (res) {
      var rows = res[0] || [], items = res[1] || [];
      var box = el('#catRows'); if (!box) return;
      box.textContent = '';
      if (!rows.length) { box.appendChild(h('p', { class: 'hint', text: 'No categories yet.' })); return; }
      var counts = {};
      items.forEach(function (i) { counts[i.category] = (counts[i.category] || 0) + 1; });
      rows.forEach(function (r, i) { box.appendChild(categoryRow(r, i, rows.length, counts[r.slug] || 0)); });
    }).catch(function (e) {
      toast('Could not load categories: ' + e.message, 'err');
      window.AE_SENTRY.capture(e, { step: 'load-categories' });
    });
  }

  function categoryRow(r, idx, total, count) {
    var body = h('div', { class: 'row-body' }); body.hidden = true;
    var top = h('div', { class: 'row-top' }, [
      h('b', { text: r.label || r.slug }),
      h('span', { class: 'meta', text: count + (count === 1 ? ' picture' : ' pictures') }),
      h('span', { class: 'sp' }),
      h('span', { class: 'pill ' + (r.visible ? 'on' : 'off') },
        [icon(r.visible ? 'eye' : 'eyeOff'), h('span', { text: r.visible ? 'Showing' : 'Hidden' })]),
    ]);
    top.addEventListener('click', function () { body.hidden = !body.hidden; });
    var row = h('div', { class: 'row' }, [top, body]);

    var label = h('input', { type: 'text', value: r.label || '' });
    var vis = h('input', { type: 'checkbox' }); vis.checked = !!r.visible;
    body.appendChild(h('div', { class: 'field' }, [h('label', { text: 'Button text' }), label]));
    body.appendChild(h('div', { class: 'checks' }, [
      h('label', {}, [vis, document.createTextNode(' Show this filter button on the site')]),
    ]));

    var save = h('button', { class: 'btn-gold btn-sm', text: 'Save' });
    save.addEventListener('click', function () {
      api('portfolio_categories?id=eq.' + r.id, {
        method: 'PATCH', headers: { Prefer: 'return=minimal' },
        body: JSON.stringify({ label: label.value, visible: vis.checked }),
      }).then(function () {
        logActivity('saved', 'Category — ' + label.value);
        toast('Saved.'); loadCategories();
      }).catch(function (e) { toast('Could not save: ' + e.message, 'err'); });
    });

    function move(dir) {
      var b = h('button', { class: 'btn-line btn-sm', text: dir < 0 ? '↑' : '↓' });
      if ((dir < 0 && idx === 0) || (dir > 0 && idx === total - 1)) b.disabled = true;
      b.addEventListener('click', function () { swapOrder('portfolio_categories', r.id, dir, loadCategories); });
      return b;
    }

    var del = h('button', { class: 'btn-line btn-sm danger', text: 'Delete' });
    del.addEventListener('click', function () {
      if (count) {
        window.alert('“' + (r.label || r.slug) + '” still has ' + count + ' picture' + (count === 1 ? '' : 's') +
          ' in it.\n\nMove those to another category first, or untick “Show this filter button” to hide it instead.');
        return;
      }
      if (!window.confirm('Delete the “' + (r.label || r.slug) + '” filter permanently?')) return;
      api('portfolio_categories?id=eq.' + r.id, { method: 'DELETE' })
        .then(function () { logActivity('deleted', 'Category — ' + (r.label || '')); toast('Deleted.'); loadCategories(); })
        .catch(function (e) { toast('Could not delete: ' + e.message, 'err'); });
    });

    body.appendChild(h('div', { class: 'rowacts' }, [save, move(-1), move(1), h('span', { class: 'sp' }), del]));
    return row;
  }

  function addCategory() {
    var name = window.prompt('What should the new filter button say?\n(e.g. "Corporate")');
    if (!name) return;
    var slug = name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
    if (!slug) { toast('That name cannot be used — try letters and numbers.', 'err'); return; }
    api('portfolio_categories', {
      method: 'POST', headers: { Prefer: 'return=minimal' },
      body: JSON.stringify({ slug: slug, label: name, order_index: 999, visible: true }),
    }).then(function () {
      logActivity('created', 'Category — ' + name);
      toast('Added — you can now put pictures in it.'); loadCategories();
    }).catch(function (e) {
      toast(/duplicate/i.test(e.message) ? 'There is already a category with that name.' : 'Could not add: ' + e.message, 'err');
    });
  }

  /* Shared reorder: rewrites both rows' indexes so ties still move. */
  function swapOrder(table, id, dir, done) {
    api(table + '?select=id,order_index&order=order_index.asc,id.asc').then(function (all) {
      var i = all.findIndex(function (x) { return x.id === id; });
      var j = i + dir;
      if (i < 0 || j < 0 || j >= all.length) return;
      return Promise.all([
        api(table + '?id=eq.' + all[i].id, { method: 'PATCH', headers: { Prefer: 'return=minimal' }, body: JSON.stringify({ order_index: (j + 1) * 10 }) }),
        api(table + '?id=eq.' + all[j].id, { method: 'PATCH', headers: { Prefer: 'return=minimal' }, body: JSON.stringify({ order_index: (i + 1) * 10 }) }),
      ]);
    }).then(function () { done(); })
      .catch(function (e) { toast('Could not reorder: ' + e.message, 'err'); });
  }

  /* -------------------------------------------------------- services --- */

  function renderServicesManager(main) {
    main.appendChild(h('div', { class: 'pane-form' }, [
      h('div', { class: 'toolbar' }, [
        h('p', { class: 'hint', text: 'The blocks on your Services page. Ticking “homepage” also shows one on the front page.' }),
        h('span', { class: 'sp' }),
        (function () {
          var b = h('button', { class: 'btn-gold btn-sm' }, [icon('plus'), h('span', { text: 'Add service' })]);
          b.addEventListener('click', addService);
          return b;
        })(),
      ]),
      h('div', { class: 'rows', id: 'svcRows' }, [h('p', { class: 'hint', text: 'Loading…' })]),
    ]));
    loadServices();
  }

  function loadServices() {
    api('services?select=*&order=order_index.asc,id.asc').then(function (rows) {
      var box = el('#svcRows'); if (!box) return;
      box.textContent = '';
      if (!rows.length) { box.appendChild(h('p', { class: 'hint', text: 'No services yet — press “Add service”.' })); return; }
      rows.forEach(function (r, i) { box.appendChild(serviceRow(r, i, rows.length)); });
    }).catch(function (e) {
      toast('Could not load services: ' + e.message, 'err');
      window.AE_SENTRY.capture(e, { step: 'load-services' });
    });
  }

  /* Repeatable chip editor for the tag list — add with Enter, remove with ×.
     Beats asking a client to type comma-separated values. */
  function tagEditor(initial) {
    var tags = (initial || []).slice();
    var wrap = h('div', { class: 'tag-edit' });
    var input = h('input', { type: 'text', placeholder: 'Type a tag and press Enter' });

    function draw() {
      wrap.textContent = '';
      tags.forEach(function (tg, i) {
        var x = h('button', { class: 'tag-x', type: 'button', text: '×', title: 'Remove' });
        x.addEventListener('click', function () { tags.splice(i, 1); draw(); });
        wrap.appendChild(h('span', { class: 'tag-chip' }, [h('span', { text: tg }), x]));
      });
      wrap.appendChild(input);
    }
    input.addEventListener('keydown', function (e) {
      if (e.key === 'Enter') {
        e.preventDefault();
        var v = input.value.trim();
        if (v && tags.indexOf(v) === -1) { tags.push(v); input.value = ''; draw(); input.focus(); }
      } else if (e.key === 'Backspace' && !input.value && tags.length) {
        tags.pop(); draw(); input.focus();
      }
    });
    draw();
    return { node: wrap, value: function () { return tags; } };
  }

  function serviceRow(r, idx, total) {
    var body = h('div', { class: 'row-body' }); body.hidden = true;
    var top = h('div', { class: 'row-top' }, [
      h('span', { class: 'svc-numeral', text: r.numeral || String(idx + 1) }),
      h('b', { text: ((r.title_lead || '') + ' ' + (r.title_accent || '')).trim() || '(untitled)' }),
      h('span', { class: 'sp' }),
      r.featured ? h('span', { class: 'pill feat', text: 'Homepage' }) : null,
      h('span', { class: 'pill ' + (r.visible ? 'on' : 'off') },
        [icon(r.visible ? 'eye' : 'eyeOff'), h('span', { text: r.visible ? 'On site' : 'Hidden' })]),
    ]);
    top.addEventListener('click', function () { body.hidden = !body.hidden; });
    var row = h('div', { class: 'row' }, [top, body]);

    var lead = h('input', { type: 'text', value: r.title_lead || '' });
    var accent = h('input', { type: 'text', value: r.title_accent || '' });
    var numeral = h('input', { type: 'text', value: r.numeral || '' });
    var bodyTxt = h('textarea', {}); bodyTxt.value = r.body || '';
    var price = h('input', { type: 'text', value: r.price || '' });
    var tags = tagEditor(r.tags);
    var ctaLabel = h('input', { type: 'text', value: r.cta_label || '' });
    var ctaHref = h('input', { type: 'text', value: r.cta_href || '' });
    var feat = h('input', { type: 'checkbox' }); feat.checked = !!r.featured;
    var vis = h('input', { type: 'checkbox' }); vis.checked = !!r.visible;

    var imgUrl = r.image_url || '';
    var preview = h('img', { src: imgUrl, alt: '', class: 'svc-preview' });
    var file = h('input', { type: 'file', accept: 'image/*' });
    file.addEventListener('change', function () {
      var f = file.files && file.files[0]; if (!f) return;
      var chosen = (window.AE_CROP ? window.AE_CROP.open(f, 4 / 3, 1600) : toWebp(f, 1600));
      chosen.then(function (blob) {
        if (!blob) return;
        toast('Uploading photo…');
        return uploadImage(blob, f.name).then(function (url) {
          imgUrl = url; preview.src = url;
          toast('Photo uploaded — press “Save” to keep it.');
        });
      }).catch(function (e) { toast('Could not upload: ' + e.message, 'err'); });
      file.value = '';
    });

    body.appendChild(h('div', { class: 'svc-form' }, [
      h('div', {}, [preview, file]),
      h('div', { class: 'svc-form-fields' }, [
        h('div', { class: 'two-up' }, [
          h('div', { class: 'field' }, [h('label', { text: 'Heading' }), lead]),
          h('div', { class: 'field' }, [h('label', { text: 'Italic word' }), accent]),
        ]),
        h('div', { class: 'field' }, [h('label', { text: 'Description' }), bodyTxt]),
        h('div', { class: 'two-up' }, [
          h('div', { class: 'field' }, [h('label', { text: 'Price chip (blank hides it)' }), price]),
          h('div', { class: 'field' }, [h('label', { text: 'Number shown beside it' }), numeral]),
        ]),
        h('div', { class: 'field' }, [h('label', { text: 'Tags' }), tags.node]),
        h('div', { class: 'two-up' }, [
          h('div', { class: 'field' }, [h('label', { text: 'Button text' }), ctaLabel]),
          h('div', { class: 'field' }, [h('label', { text: 'Button link' }), ctaHref]),
        ]),
        h('div', { class: 'checks' }, [
          h('label', {}, [feat, document.createTextNode(' Also show on the homepage')]),
          h('label', {}, [vis, document.createTextNode(' Visible on the site')]),
        ]),
      ]),
    ]));

    var save = h('button', { class: 'btn-gold btn-sm', text: 'Save' });
    save.addEventListener('click', function () {
      api('services?id=eq.' + r.id, {
        method: 'PATCH', headers: { Prefer: 'return=minimal' },
        body: JSON.stringify({
          title_lead: lead.value, title_accent: accent.value, numeral: numeral.value,
          body: bodyTxt.value, price: price.value, tags: tags.value(),
          image_url: imgUrl, cta_label: ctaLabel.value, cta_href: ctaHref.value,
          featured: feat.checked, visible: vis.checked, updated_by: me,
        }),
      }).then(function () {
        logActivity('saved', 'Service — ' + lead.value);
        toast('Saved — the website is updated.', null, '/services');
        loadServices();
      }).catch(function (e) { toast('Could not save: ' + e.message, 'err'); });
    });

    function move(dir) {
      var b = h('button', { class: 'btn-line btn-sm', text: dir < 0 ? '↑' : '↓' });
      if ((dir < 0 && idx === 0) || (dir > 0 && idx === total - 1)) b.disabled = true;
      b.addEventListener('click', function () { swapOrder('services', r.id, dir, loadServices); });
      return b;
    }

    var del = h('button', { class: 'btn-line btn-sm danger', text: 'Delete' });
    del.addEventListener('click', function () {
      if (!window.confirm('Delete this service permanently?\n\nTip: unticking “Visible on the site” hides it and keeps it here.')) return;
      api('services?id=eq.' + r.id, { method: 'DELETE' })
        .then(function () { logActivity('deleted', 'Service — ' + (r.title_lead || '')); toast('Deleted.'); loadServices(); })
        .catch(function (e) { toast('Could not delete: ' + e.message, 'err'); });
    });

    body.appendChild(h('div', { class: 'rowacts' }, [save, move(-1), move(1), h('span', { class: 'sp' }), del]));
    return row;
  }

  function addService() {
    var name = window.prompt('What is the new service called?');
    if (!name) return;
    var slug = name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || ('service-' + Date.now());
    api('services', {
      method: 'POST', headers: { Prefer: 'return=minimal' },
      body: JSON.stringify({ slug: slug, title_lead: name, visible: false, order_index: 999, updated_by: me }),
    }).then(function () {
      logActivity('created', 'Service — ' + name);
      toast('Added — hidden until you tick “Visible”.'); loadServices();
    }).catch(function (e) {
      toast(/duplicate/i.test(e.message) ? 'A service with that name already exists.' : 'Could not add: ' + e.message, 'err');
    });
  }

  /* --------------------------------------------------------- vendors --- */

  function viewVendors(main) {
    main.appendChild(header('Vendors',
      'Suppliers whose catalogs you link customers to. These appear on your Services page.',
      [(function () {
        var b = h('button', { class: 'btn-line' }, [icon('plus'), h('span', { text: 'Add vendor' })]);
        b.addEventListener('click', addVendor); return b;
      })()],
      [{ label: 'Dashboard', href: '#/' }, { label: 'Vendors' }]));
    main.appendChild(h('div', { class: 'pane-form' }, [
      h('div', { class: 'rows', id: 'venRows' }, [h('p', { class: 'hint', text: 'Loading…' })]),
    ]));
    loadVendors();
  }

  function loadVendors() {
    api('vendors?select=*&order=order_index.asc,id.asc').then(function (rows) {
      var box = el('#venRows'); if (!box) return;
      box.textContent = '';
      if (!rows.length) {
        box.appendChild(h('p', { class: 'hint', text: 'No vendors yet. Add one and the “Shop our suppliers” section appears on your Services page — until then it stays hidden.' }));
        return;
      }
      rows.forEach(function (r, i) { box.appendChild(vendorRow(r, i, rows.length)); });
    }).catch(function (e) {
      toast('Could not load vendors: ' + e.message, 'err');
      window.AE_SENTRY.capture(e, { step: 'load-vendors' });
    });
  }

  function vendorRow(r, idx, total) {
    var body = h('div', { class: 'row-body' }); body.hidden = true;
    var thumb = h('img', { src: r.logo_url || '', alt: '', class: 'ven-thumb' });
    var top = h('div', { class: 'row-top' }, [
      thumb,
      h('b', { text: r.name || '(unnamed)' }),
      h('span', { class: 'meta', text: r.blurb || '' }),
      h('span', { class: 'sp' }),
      h('span', { class: 'pill ' + (r.visible ? 'on' : 'off') },
        [icon(r.visible ? 'eye' : 'eyeOff'), h('span', { text: r.visible ? 'On site' : 'Hidden' })]),
    ]);
    top.addEventListener('click', function () { body.hidden = !body.hidden; });
    var row = h('div', { class: 'row' }, [top, body]);

    var name = h('input', { type: 'text', value: r.name || '' });
    var blurb = h('input', { type: 'text', value: r.blurb || '' });
    var link = h('input', { type: 'url', value: r.catalog_url || '', placeholder: 'https://…' });
    var vis = h('input', { type: 'checkbox' }); vis.checked = !!r.visible;

    var logoUrl = r.logo_url || '';
    var preview = h('img', { src: logoUrl, alt: '', class: 'ven-preview' });
    var file = h('input', { type: 'file', accept: 'image/*' });
    file.addEventListener('change', function () {
      var f = file.files && file.files[0]; if (!f) return;
      // Vendor logos are often SVG — those must skip the cropper, which is
      // canvas-based and would rasterise them.
      var isSvg = /svg/i.test(f.type) || /\.svg$/i.test(f.name);
      var chosen = isSvg ? Promise.resolve(f)
        : (window.AE_CROP ? window.AE_CROP.open(f, 1, 600) : toWebp(f, 600));
      chosen.then(function (blob) {
        if (!blob) return;
        toast('Uploading logo…');
        return uploadImage(blob, f.name).then(function (url) {
          logoUrl = url; preview.src = url; thumb.src = url;
          toast('Logo uploaded — press “Save” to keep it.');
        });
      }).catch(function (e) { toast('Could not upload: ' + e.message, 'err'); });
      file.value = '';
    });

    body.appendChild(h('div', { class: 'field' }, [h('label', { text: 'Logo' }), preview, file]));
    body.appendChild(h('div', { class: 'field' }, [h('label', { text: 'Vendor name' }), name]));
    body.appendChild(h('div', { class: 'field' }, [h('label', { text: 'One line about them' }), blurb]));
    body.appendChild(h('div', { class: 'field' }, [h('label', { text: 'Link to their catalog' }), link]));
    body.appendChild(h('div', { class: 'checks' }, [
      h('label', {}, [vis, document.createTextNode(' Visible on the site')]),
    ]));

    var save = h('button', { class: 'btn-gold btn-sm', text: 'Save' });
    save.addEventListener('click', function () {
      api('vendors?id=eq.' + r.id, {
        method: 'PATCH', headers: { Prefer: 'return=minimal' },
        body: JSON.stringify({
          name: name.value, blurb: blurb.value, catalog_url: link.value,
          logo_url: logoUrl, visible: vis.checked, updated_by: me,
        }),
      }).then(function () {
        logActivity('saved', 'Vendor — ' + name.value);
        toast('Saved.', null, '/services#vendors'); loadVendors();
      }).catch(function (e) { toast('Could not save: ' + e.message, 'err'); });
    });

    function move(dir) {
      var b = h('button', { class: 'btn-line btn-sm', text: dir < 0 ? '↑' : '↓' });
      if ((dir < 0 && idx === 0) || (dir > 0 && idx === total - 1)) b.disabled = true;
      b.addEventListener('click', function () { swapOrder('vendors', r.id, dir, loadVendors); });
      return b;
    }

    var del = h('button', { class: 'btn-line btn-sm danger', text: 'Delete' });
    del.addEventListener('click', function () {
      if (!window.confirm('Delete this vendor permanently?')) return;
      api('vendors?id=eq.' + r.id, { method: 'DELETE' })
        .then(function () { logActivity('deleted', 'Vendor — ' + (r.name || '')); toast('Deleted.'); loadVendors(); })
        .catch(function (e) { toast('Could not delete: ' + e.message, 'err'); });
    });

    body.appendChild(h('div', { class: 'rowacts' }, [save, move(-1), move(1), h('span', { class: 'sp' }), del]));
    return row;
  }

  function addVendor() {
    var name = window.prompt('What is the vendor called?\n(e.g. "JD’s")');
    if (!name) return;
    api('vendors', {
      method: 'POST', headers: { Prefer: 'return=minimal' },
      body: JSON.stringify({ name: name, visible: false, order_index: 999, updated_by: me }),
    }).then(function () {
      logActivity('created', 'Vendor — ' + name);
      toast('Added — add their link, then tick “Visible”.'); loadVendors();
    }).catch(function (e) { toast('Could not add: ' + e.message, 'err'); });
  }

  /* ========================================================= list engine ==
     One manager for every list defined in site-lists.js. The form is built
     from that schema, so a new managed list needs no code here at all. */

  function listDefs() { return window.AE_LISTS || {}; }

  function viewList(main, key) {
    var def = listDefs()[key];
    if (!def) return viewDashboard(main);
    main.appendChild(header(def.label, def.blurb,
      [(function () {
        var b = h('button', { class: 'btn-line' }, [icon('plus'), h('span', { text: 'Add ' + (def.itemLabel || 'item') })]);
        b.addEventListener('click', function () { addListItem(key); });
        return b;
      })()],
      [{ label: 'Dashboard', href: '#/' }, { label: def.label }]));
    main.appendChild(h('div', { class: 'pane-form' }, [
      h('div', { class: 'rows', id: 'listRows' }, [h('p', { class: 'hint', text: 'Loading…' })]),
    ]));
    loadListRows(key);
  }

  function loadListRows(key) {
    api('site_lists?select=*&list_key=eq.' + key + '&order=order_index.asc,created_at.asc').then(function (rows) {
      var box = el('#listRows'); if (!box) return;
      box.textContent = '';
      var def = listDefs()[key];
      if (!rows.length) {
        box.appendChild(h('p', { class: 'hint', text: 'Nothing here yet — press “Add ' + (def.itemLabel || 'item') + '”.' }));
        return;
      }
      rows.forEach(function (r, i) { box.appendChild(listRow(key, def, r, i, rows.length)); });
    }).catch(function (e) {
      toast('Could not load: ' + e.message, 'err');
      window.AE_SENTRY.capture(e, { step: 'load-list-' + key });
    });
  }

  /* Builds one control per schema field and hands back a value getter. */
  function fieldControl2(f, value) {
    if (f.type === 'textarea') {
      var ta = h('textarea', {}); ta.value = value || '';
      return { node: ta, get: function () { return ta.value; } };
    }
    if (f.type === 'check') {
      var cb = h('input', { type: 'checkbox' }); cb.checked = !!value;
      return { node: h('label', { class: 'inline-check' }, [cb, document.createTextNode(' ' + f.label)]),
               get: function () { return cb.checked; }, ownLabel: true };
    }
    if (f.type === 'tags') {
      var te = tagEditor(value || []);
      return { node: te.node, get: te.value };
    }
    if (f.type === 'image') {
      var url = value || '';
      var prev = h('img', { src: url, alt: '', class: 'list-img' });
      var file = h('input', { type: 'file', accept: 'image/*' });
      file.addEventListener('change', function () {
        var fl = file.files && file.files[0]; if (!fl) return;
        // SVG must skip the cropper — it is canvas-based and would rasterise it.
        var isSvg = /svg/i.test(fl.type) || /\.svg$/i.test(fl.name);
        var chosen = (isSvg && f.svg) ? Promise.resolve(fl)
          : (window.AE_CROP ? window.AE_CROP.open(fl, f.aspect || null, 1600) : toWebp(fl, 1600));
        chosen.then(function (blob) {
          if (!blob) return;
          toast('Uploading…');
          return uploadImage(blob, fl.name).then(function (u) {
            url = u; prev.src = u; toast('Uploaded — press “Save” to keep it.');
          });
        }).catch(function (e) { toast('Could not upload: ' + e.message, 'err'); });
        file.value = '';
      });
      return { node: h('div', {}, [prev, file]), get: function () { return url; } };
    }
    var inp = h('input', { type: f.type === 'link' ? 'url' : 'text', value: value == null ? '' : String(value) });
    if (f.type === 'link') inp.placeholder = 'https://…';
    return { node: inp, get: function () { return inp.value; } };
  }

  function listRow(key, def, r, idx, total) {
    var d = r.data || {};
    var body = h('div', { class: 'row-body' }); body.hidden = true;
    var titleField = def.title || (def.fields[0] && def.fields[0].key);
    var thumbKey = (def.fields.filter(function (f) { return f.type === 'image'; })[0] || {}).key;

    var top = h('div', { class: 'row-top' }, [
      thumbKey ? h('img', { src: d[thumbKey] || '', alt: '', class: 'list-thumb' }) : null,
      h('b', { text: String(d[titleField] || '(untitled)').slice(0, 60) }),
      h('span', { class: 'sp' }),
      h('span', { class: 'pill ' + (r.visible ? 'on' : 'off') },
        [icon(r.visible ? 'eye' : 'eyeOff'), h('span', { text: r.visible ? 'On site' : 'Hidden' })]),
    ]);
    top.addEventListener('click', function () { body.hidden = !body.hidden; });
    var row = h('div', { class: 'row' }, [top, body]);

    var ctrls = {};
    var pending = [];
    def.fields.forEach(function (f) {
      var c = fieldControl2(f, d[f.key]);
      ctrls[f.key] = c;
      var wrap = c.ownLabel
        ? h('div', { class: 'field' }, [c.node])
        : h('div', { class: 'field' }, [h('label', { text: f.label }), c.node]);
      if (f.width === 'half') { pending.push(wrap); if (pending.length === 2) { body.appendChild(h('div', { class: 'two-up' }, pending.splice(0, 2))); } }
      else { if (pending.length) body.appendChild(h('div', { class: 'two-up' }, pending.splice(0))); body.appendChild(wrap); }
    });
    if (pending.length) body.appendChild(h('div', { class: 'two-up' }, pending.splice(0)));

    var vis = h('input', { type: 'checkbox' }); vis.checked = !!r.visible;
    body.appendChild(h('div', { class: 'checks' }, [
      h('label', {}, [vis, document.createTextNode(' Visible on the site')]),
    ]));

    var save = h('button', { class: 'btn-gold btn-sm', text: 'Save' });
    save.addEventListener('click', function () {
      var out = {};
      def.fields.forEach(function (f) { out[f.key] = ctrls[f.key].get(); });
      api('site_lists?id=eq.' + r.id, {
        method: 'PATCH', headers: { Prefer: 'return=minimal' },
        body: JSON.stringify({ data: out, visible: vis.checked, updated_by: me }),
      }).then(function () {
        logActivity('saved', def.label + ' — ' + (out[titleField] || ''));
        toast('Saved — the website is updated.', null, def.page);
        loadListRows(key);
      }).catch(function (e) { toast('Could not save: ' + e.message, 'err'); });
    });

    function move(dir) {
      var b = h('button', { class: 'btn-line btn-sm', text: dir < 0 ? '↑' : '↓' });
      if ((dir < 0 && idx === 0) || (dir > 0 && idx === total - 1)) b.disabled = true;
      b.addEventListener('click', function () {
        api('site_lists?select=id,order_index&list_key=eq.' + key + '&order=order_index.asc,created_at.asc').then(function (all) {
          var i = all.findIndex(function (x) { return x.id === r.id; });
          var j = i + dir;
          if (i < 0 || j < 0 || j >= all.length) return;
          return Promise.all([
            api('site_lists?id=eq.' + all[i].id, { method: 'PATCH', headers: { Prefer: 'return=minimal' }, body: JSON.stringify({ order_index: (j + 1) * 10 }) }),
            api('site_lists?id=eq.' + all[j].id, { method: 'PATCH', headers: { Prefer: 'return=minimal' }, body: JSON.stringify({ order_index: (i + 1) * 10 }) }),
          ]);
        }).then(function () { loadListRows(key); })
          .catch(function (e) { toast('Could not reorder: ' + e.message, 'err'); });
      });
      return b;
    }

    var del = h('button', { class: 'btn-line btn-sm danger', text: 'Delete' });
    del.addEventListener('click', function () {
      if (!window.confirm('Delete this ' + (def.itemLabel || 'item') + ' permanently?\n\nTip: unticking “Visible on the site” hides it and keeps it here.')) return;
      api('site_lists?id=eq.' + r.id, { method: 'DELETE' })
        .then(function () { logActivity('deleted', def.label); toast('Deleted.'); loadListRows(key); })
        .catch(function (e) { toast('Could not delete: ' + e.message, 'err'); });
    });

    body.appendChild(h('div', { class: 'rowacts' }, [save, move(-1), move(1), h('span', { class: 'sp' }), del]));
    return row;
  }

  function addListItem(key) {
    api('site_lists', {
      method: 'POST', headers: { Prefer: 'return=minimal' },
      body: JSON.stringify({ list_key: key, data: {}, visible: false, order_index: 999, updated_by: me }),
    }).then(function () {
      logActivity('created', (listDefs()[key] || {}).label || key);
      toast('Added — fill it in, then tick “Visible”.'); loadListRows(key);
    }).catch(function (e) { toast('Could not add: ' + e.message, 'err'); });
  }

  /* ------------------------------------------------------------ leads --- */

  var LEAD_STATUSES = [
    { key: 'new',       label: 'New' },
    { key: 'contacted', label: 'Contacted' },
    { key: 'won',       label: 'Won' },
    { key: 'lost',      label: 'Lost' },
  ];
  var leadFilter = 'all';
  var leadRowsData = [];

  function viewLeads(main) {
    main.appendChild(header('Quote requests', 'Everyone who filled in the form on the website. Set each one’s status to track which convert.', [],
      [{ label: 'Dashboard', href: '#/' }, { label: 'Quote requests' }]));
    main.appendChild(h('div', { class: 'pane-form' }, [
      h('div', { class: 'lead-summary', id: 'leadSummary' }),
      h('div', { class: 'lead-filters', id: 'leadFilters' }),
      h('div', { class: 'rows', id: 'leadRows' }, [h('p', { class: 'hint', text: 'Loading…' })]),
    ]));
    api('leads?select=*&order=created_at.desc&limit=200').then(function (rows) {
      leadRowsData = rows || [];
      renderLeadSummary();
      renderLeadFilters();
      renderLeadRows();
    }).catch(function (e) { toast('Could not load: ' + e.message, 'err'); window.AE_SENTRY.capture(e, { step: 'load-leads' }); });
  }

  function leadCounts() {
    var c = { all: leadRowsData.length, new: 0, contacted: 0, won: 0, lost: 0 };
    leadRowsData.forEach(function (l) { var s = l.status || 'new'; if (c[s] != null) c[s]++; });
    return c;
  }
  function renderLeadSummary() {
    var box = el('#leadSummary'); if (!box) return; box.textContent = '';
    var c = leadCounts();
    var rate = c.all ? Math.round((c.won / c.all) * 100) : 0;
    box.appendChild(h('div', { class: 'lead-stat' }, [h('b', { text: String(c.all) }), h('span', { text: 'total' })]));
    box.appendChild(h('div', { class: 'lead-stat won' }, [h('b', { text: String(c.won) }), h('span', { text: 'converted' })]));
    box.appendChild(h('div', { class: 'lead-stat' }, [h('b', { text: rate + '%' }), h('span', { text: 'conversion rate' })]));
  }
  function renderLeadFilters() {
    var box = el('#leadFilters'); if (!box) return; box.textContent = '';
    var c = leadCounts();
    var defs = [{ key: 'all', label: 'All' }].concat(LEAD_STATUSES);
    defs.forEach(function (d) {
      var chip = h('button', { class: 'lead-chip' + (leadFilter === d.key ? ' on' : '') + (d.key !== 'all' ? ' st-' + d.key : ''), type: 'button',
        text: d.label + ' (' + (c[d.key] || 0) + ')' });
      chip.addEventListener('click', function () { leadFilter = d.key; renderLeadFilters(); renderLeadRows(); });
      box.appendChild(chip);
    });
  }
  function renderLeadRows() {
    var b = el('#leadRows'); if (!b) return; b.textContent = '';
    var rows = leadRowsData.filter(function (l) { return leadFilter === 'all' || (l.status || 'new') === leadFilter; });
    if (!rows.length) { b.appendChild(h('p', { class: 'hint', text: leadRowsData.length ? 'No requests with this status.' : 'No quote requests yet.' })); return; }
    rows.forEach(function (l) { b.appendChild(leadRow(l)); });
  }

  function leadRow(l) {
    var status = l.status || 'new';
    var body = h('div', { class: 'row-body' }); body.hidden = true;
    body.appendChild(h('p', { text: l.message || '(no message)' }));
    body.appendChild(h('p', { class: 'hint', text: [l.email, l.phone, l.interest].filter(Boolean).join(' · ') }));
    body.appendChild(h('a', { class: 'btn-line btn-sm', href: 'mailto:' + l.email, text: 'Reply by email' }));

    var pill = h('span', { class: 'st-pill st-' + status, text: (LEAD_STATUSES.filter(function (s) { return s.key === status; })[0] || {}).label || status });

    /* status dropdown — click doesn't toggle the row open */
    var sel = h('select', { class: 'lead-status-sel st-' + status });
    LEAD_STATUSES.forEach(function (s) {
      var o = h('option', { value: s.key, text: s.label }); if (s.key === status) o.selected = true; sel.appendChild(o);
    });
    sel.addEventListener('click', function (e) { e.stopPropagation(); });
    sel.addEventListener('change', function () {
      var next = sel.value, prev = l.status || 'new';
      sel.disabled = true;
      api('leads?id=eq.' + l.id, { method: 'PATCH', headers: { Prefer: 'return=minimal' },
        body: JSON.stringify({ status: next, status_updated_at: new Date().toISOString() }) })
        .then(function () {
          l.status = next; sel.className = 'lead-status-sel st-' + next;
          pill.className = 'st-pill st-' + next;
          pill.textContent = (LEAD_STATUSES.filter(function (s) { return s.key === next; })[0] || {}).label || next;
          logActivity('saved', 'Lead — ' + (l.name || l.email), next, prev, next);
          toast('Marked “' + (l.name || 'lead') + '” as ' + next + '.');
          renderLeadSummary(); renderLeadFilters();
        })
        .catch(function (e) { sel.value = prev; toast('Could not update: ' + e.message, 'err'); window.AE_SENTRY.capture(e, { step: 'lead-status' }); })
        .then(function () { sel.disabled = false; });
    });

    var top = h('div', { class: 'row-top' }, [
      h('span', { class: 'av', style: 'background:#4a5a7a', text: (l.name || '?').charAt(0) }),
      h('b', { text: l.name }), pill,
      h('span', { class: 'sp' }), h('span', { class: 'meta', text: ago(l.created_at) }), sel,
    ]);
    top.addEventListener('click', function () { body.hidden = !body.hidden; });
    return h('div', { class: 'row' }, [top, body]);
  }

  /* --------------------------------------------------------- activity --- */

  function viewActivity(main) {
    main.appendChild(header('Activity log', 'Every sign-in and every change, newest first.', [],
      [{ label: 'Dashboard', href: '#/' }, { label: 'Activity' }]));
    main.appendChild(h('div', { class: 'pane-form' }, [h('ul', { class: 'panel', id: 'actList' }, [h('li', { text: 'Loading…' })])]));
    api('site_activity?select=*&order=created_at.desc&limit=200').then(function (rows) {
      var ul = el('#actList'); if (!ul) return;
      ul.textContent = '';
      if (!rows.length) { ul.appendChild(h('li', { text: 'Nothing logged yet.' })); return; }
      rows.forEach(function (r) {
        ul.appendChild(h('li', {}, [
          h('span', { class: 'act-ic ' + actTint(r.action) }, [icon(actIcon(r.action))]),
          h('div', {}, [h('b', { text: actVerb(r.action) + (r.target ? ' · ' + r.target : '') }),
                        h('p', { text: r.actor || '' })]),
          h('span', { class: 'when', text: ago(r.created_at) }),
        ]));
      });
    }).catch(function () {});
  }

  /* ====================================================== search (⌘K) ==== */

  function openPalette() {
    if (el('#palette')) return;
    var items = PAGES.map(function (p) { return { label: p.label, sub: 'Page · ' + p.path, href: '#/page/' + p.id, ic: p.icon }; })
      .concat([
        { label: 'Customer reviews', sub: 'Add, edit or hide reviews', href: '#/page/reviewsp/items', ic: 'star' },
        { label: 'Portfolio pictures', sub: 'The photos on your Portfolio page', href: '#/page/portfolio/items', ic: 'image' },
        { label: 'Photo library', sub: 'Every photo on your website', href: '#/media', ic: 'file' },
        { label: 'Vendors', sub: 'Supplier catalogs you link to', href: '#/vendors', ic: 'building' },
        { label: 'Service blocks', sub: 'Add, edit or reorder services', href: '#/page/services/items', ic: 'wrench' },
        { label: 'Filter buttons', sub: 'Portfolio categories', href: '#/page/portfolio/categories', ic: 'image' },
        { label: 'View live site', sub: 'Open the website in a new tab', href: 'site:/', ic: 'external' },
        { label: 'Quote requests', sub: 'Enquiries from the website', href: '#/leads', ic: 'mail' },
        { label: 'Activity log', sub: 'Who changed what', href: '#/activity', ic: 'activity' },
        { label: 'What’s new', sub: 'Recent updates', href: '#/changelog', ic: 'sparkles' },
      ]);
    var input = h('input', { type: 'text', placeholder: 'Search pages and settings…' });
    var list = h('div', { class: 'pal-list' });
    var box = h('div', { class: 'pal' }, [h('div', { class: 'pal-in' }, [icon('search'), input]), list]);
    var overlay = h('div', { class: 'pal-overlay', id: 'palette' }, [box]);
    overlay.addEventListener('click', function (e) { if (e.target === overlay) close(); });
    function close() { overlay.remove(); document.removeEventListener('keydown', onKey); }
    function onKey(e) { if (e.key === 'Escape') close(); }
    function draw() {
      var q = input.value.toLowerCase();
      list.textContent = '';
      items.filter(function (i) { return !q || (i.label + ' ' + i.sub).toLowerCase().indexOf(q) > -1; })
        .forEach(function (i) {
          var b = h('button', { class: 'pal-row' }, [icon(i.ic), h('span', {}, [h('b', { text: i.label }), h('small', { text: i.sub })])]);
          b.addEventListener('click', function () {
            close();
            // "site:" entries open the public website instead of routing inside the panel.
            if (i.href.indexOf('site:') === 0) { window.open(i.href.slice(5), '_blank', 'noopener'); return; }
            location.hash = i.href;
          });
          list.appendChild(b);
        });
      if (!list.children.length) list.appendChild(h('p', { class: 'hint', text: 'Nothing matches that.' }));
    }
    input.addEventListener('input', draw);
    input.addEventListener('keydown', function (e) {
      if (e.key === 'Enter') { var f = list.querySelector('.pal-row'); if (f) f.click(); }
    });
    document.addEventListener('keydown', onKey);
    document.body.appendChild(overlay); draw(); input.focus();
  }
  document.addEventListener('keydown', function (e) {
    if ((e.metaKey || e.ctrlKey) && String(e.key).toLowerCase() === 'k') { e.preventDefault(); openPalette(); }
  });

  /* =============================================================== boot == */

  /* ============================================================ catalog ==
     The Premier Line catalog (10,030 items across 7 collections) lives in
     static JSON under /catalog/ and is refreshed by re-running the scraper —
     never edited here. This screen writes ONLY hide / feature decisions into
     the catalog_overrides table, which the public catalog layers on top.

     Refs (must match assets/catalog.js exactly):
       col:<key>              a whole collection
       grp:<key>|<group>      a group within a collection
       cat:<cid>             a category
       sku:<SKU>             one product   (also the only ref that can be featured)
  */
  var catIndex = null;        // parsed /catalog/index.json
  var catState = {};          // ref -> { hidden:bool, featured:bool }
  var catProds = {};          // collection key -> products-by-cid (lazy)

  function catLabelFor(key) {
    var c = (catIndex.collections || []).filter(function (x) { return x.key === key; })[0];
    return c ? c.label : key;
  }
  function loadCatData() {
    return Promise.all([
      catIndex ? Promise.resolve(catIndex) : fetch('/assets/catalog/index.json').then(function (r) { return r.json(); }).then(function (d) { catIndex = d; return d; }),
      api('catalog_overrides?select=ref,hidden,featured').catch(function () { return []; }),
    ]).then(function (res) {
      catState = {};
      (res[1] || []).forEach(function (row) { catState[row.ref] = { hidden: !!row.hidden, featured: !!row.featured }; });
      return catIndex;
    });
  }
  function catFlag(ref, which) { return !!(catState[ref] && catState[ref][which]); }

  /* Always writes the complete row so a merge-duplicates upsert can't drop the
     other flag; deletes the row when nothing is set, to keep the table tidy. */
  function writeOverride(ref, patch, label) {
    var cur = catState[ref] || { hidden: false, featured: false };
    var next = { hidden: patch.hidden != null ? patch.hidden : cur.hidden,
                 featured: patch.featured != null ? patch.featured : cur.featured };
    catState[ref] = next;
    var p;
    if (!next.hidden && !next.featured) {
      p = api('catalog_overrides?ref=eq.' + encodeURIComponent(ref), { method: 'DELETE', headers: { Prefer: 'return=minimal' } });
    } else {
      p = api('catalog_overrides', {
        method: 'POST',
        headers: { Prefer: 'resolution=merge-duplicates,return=minimal' },
        body: JSON.stringify({ ref: ref, hidden: next.hidden, featured: next.featured, label: label || null, updated_by: me }),
      });
    }
    return p.then(function () {
      logActivity('saved', 'Catalog — ' + ref, JSON.stringify(next));
    }).catch(function (e) {
      toast('Could not save: ' + e.message, 'err');
      window.AE_SENTRY.capture(e, { step: 'catalog-override', ref: ref });
    });
  }

  /* A "Shown / Hidden" switch. onToggle(nowShown) fires after the write. */
  function showSwitch(ref, label, onAfter) {
    var shown = !catFlag(ref, 'hidden');
    var cb = h('input', { type: 'checkbox' }); cb.checked = shown;
    var txt = h('span', { class: 'cat-sw-txt', text: shown ? 'Shown' : 'Hidden' });
    var wrap = h('label', { class: 'cat-sw' + (shown ? '' : ' off') }, [cb, txt]);
    cb.addEventListener('change', function () {
      var nowHidden = !cb.checked;
      txt.textContent = nowHidden ? 'Hidden' : 'Shown';
      wrap.classList.toggle('off', nowHidden);
      writeOverride(ref, { hidden: nowHidden }, label).then(function () {
        toast(nowHidden ? '“' + label + '” hidden from the site.' : '“' + label + '” is back on the site.');
        if (onAfter) onAfter(!nowHidden);
      });
    });
    return wrap;
  }

  function viewCatalog(main) {
    main.appendChild(header('Product catalog',
      'Everything from Premier Line — 10,030 items across 7 collections. The catalog itself refreshes on its own; here you just choose what to show. Hide a whole collection, a group, or a single category. To hide or feature individual products, open a category’s “Manage items”.',
      [], [{ label: 'Dashboard', href: '#/' }, { label: 'Product catalog' }]));
    var box = h('div', { class: 'pane-form' }, [h('p', { class: 'hint', text: 'Loading the catalog…' })]);
    main.appendChild(box);
    loadCatData().then(function () {
      box.textContent = '';
      (catIndex.collections || []).forEach(function (c) { box.appendChild(catCollectionBlock(c)); });
    }).catch(function (e) {
      box.textContent = '';
      box.appendChild(h('p', { class: 'hint', text: 'Could not load the catalog: ' + e.message }));
    });
  }

  function catCollectionBlock(c) {
    var ref = 'col:' + c.key;
    var det = h('details', { class: 'cat-block' });
    var sum = h('summary', {}, [
      h('span', { class: 'cat-name', text: c.label }),
      h('span', { class: 'cat-meta', text: c.count.toLocaleString() + ' items · ' + c.groups.length + ' groups' }),
    ]);
    det.appendChild(sum);
    var inner = h('div', { class: 'cat-inner' });
    inner.appendChild(h('div', { class: 'cat-row cat-row-top' }, [
      h('span', { class: 'cat-row-lbl', text: 'Show this whole collection' }),
      showSwitch(ref, c.label),
    ]));
    c.groups.forEach(function (g) {
      var gref = 'grp:' + c.key + '|' + g.name;
      inner.appendChild(h('div', { class: 'cat-row cat-grp' }, [
        h('span', { class: 'cat-row-lbl', text: g.name }),
        h('span', { class: 'cat-row-n', text: g.count.toLocaleString() }),
        showSwitch(gref, g.name),
      ]));
      g.categories.forEach(function (cat) {
        var cref = 'cat:' + cat.id;
        var manage = h('button', { class: 'linkish cat-manage', type: 'button' }, [document.createTextNode('Manage items')]);
        manage.addEventListener('click', function () { location.hash = '#/catalog/' + c.key + '/' + cat.id; });
        inner.appendChild(h('div', { class: 'cat-row cat-cat' }, [
          h('span', { class: 'cat-row-lbl', text: cat.name }),
          h('span', { class: 'cat-row-n', text: String(cat.count) }),
          manage,
          showSwitch(cref, cat.name),
        ]));
      });
    });
    det.appendChild(inner);
    return det;
  }

  function findCat(key, cid) {
    var c = (catIndex.collections || []).filter(function (x) { return x.key === key; })[0];
    if (!c) return null;
    for (var i = 0; i < c.groups.length; i++) for (var j = 0; j < c.groups[i].categories.length; j++)
      if (c.groups[i].categories[j].id === cid) return { coll: c, group: c.groups[i], cat: c.groups[i].categories[j] };
    return null;
  }

  function viewCatalogItems(main, key, cid) {
    (catIndex ? Promise.resolve() : loadCatData()).then(function () {
      var f = findCat(key, cid);
      if (!f) { location.hash = '#/catalog'; return; }
      main.appendChild(header(f.cat.name,
        'Hide individual products, or ⭐ feature a few to pin them to the top of “' + f.coll.label + '”.',
        [], [{ label: 'Dashboard', href: '#/' }, { label: 'Product catalog', href: '#/catalog' },
             { label: f.coll.label, href: '#/catalog' }, { label: f.cat.name }]));
      var box = h('div', { class: 'pane-form' }, [h('p', { class: 'hint', text: 'Loading products…' })]);
      main.appendChild(box);
      var pp = catProds[key] ? Promise.resolve(catProds[key]) : fetch('/assets/catalog/' + key + '.json').then(function (r) { return r.json(); }).then(function (d) { catProds[key] = d; return d; });
      pp.then(function (byCid) {
        box.textContent = '';
        var items = byCid[cid] || [];
        if (!items.length) { box.appendChild(h('p', { class: 'hint', text: 'This category has no products.' })); return; }
        var grid = h('div', { class: 'cat-prod-grid' });
        items.forEach(function (p) { grid.appendChild(catProductCard(p)); });
        box.appendChild(grid);
      }).catch(function (e) { box.textContent = ''; box.appendChild(h('p', { class: 'hint', text: 'Could not load products: ' + e.message })); });
    });
  }

  function catProductCard(p) {
    var ref = 'sku:' + p.sku;
    var img = h('img', { src: p.image, alt: p.name || p.sku, loading: 'lazy' });
    var star = h('button', { class: 'cat-star' + (catFlag(ref, 'featured') ? ' on' : ''), type: 'button', title: 'Feature this product', 'aria-label': 'Feature this product', text: '★' });
    var eye = h('button', { class: 'cat-eye', type: 'button' }, [document.createTextNode(catFlag(ref, 'hidden') ? 'Hidden — show' : 'Hide')]);
    var card = h('div', { class: 'cat-prod' + (catFlag(ref, 'hidden') ? ' is-hidden' : '') }, [
      h('div', { class: 'cat-prod-media' }, [img, star]),
      h('div', { class: 'cat-prod-body' }, [
        h('div', { class: 'cat-prod-name', text: p.name || p.sku }),
        h('div', { class: 'cat-prod-sku', text: p.sku + (p.size ? ' · ' + p.size : '') }),
        eye,
      ]),
    ]);
    star.addEventListener('click', function () {
      var now = !catFlag(ref, 'featured');
      star.classList.toggle('on', now);
      writeOverride(ref, { featured: now }, p.name || p.sku).then(function () { toast(now ? 'Featured “' + (p.name || p.sku) + '”.' : 'Unfeatured.'); });
    });
    eye.addEventListener('click', function () {
      var nowHidden = !catFlag(ref, 'hidden');
      card.classList.toggle('is-hidden', nowHidden);
      eye.textContent = nowHidden ? 'Hidden — show' : 'Hide';
      writeOverride(ref, { hidden: nowHidden }, p.name || p.sku).then(function () { toast(nowHidden ? 'Product hidden.' : 'Product shown.'); });
    });
    return card;
  }

  function buildNav() {
    var nav = el('#sideNav'); nav.textContent = '';
    nav.appendChild(navBtn('/', 'Dashboard', 'dashboard'));
    nav.appendChild(h('div', { class: 'grp', text: 'Your site' }));
    PAGES.forEach(function (p) { nav.appendChild(navBtn('/page/' + p.id, p.label, p.icon)); });
    nav.appendChild(navBtn('/vendors', 'Vendors', 'building'));
    nav.appendChild(navBtn('/catalog', 'Product catalog', 'book'));
    // Every list in site-lists.js gets a menu entry automatically.
    Object.keys(listDefs()).forEach(function (k) {
      nav.appendChild(navBtn('/list/' + k, listDefs()[k].label, listDefs()[k].icon || 'file'));
    });
    nav.appendChild(navBtn('/media', 'Photo library', 'layers'));
    /* One entry per thing. Portfolio and Reviews used to appear twice — once
       for their wording and once for their contents — which is what made the
       sidebar feel duplicated. Both now open a single screen with two tabs. */
    nav.appendChild(h('div', { class: 'grp', text: 'Records' }));
    nav.appendChild(navBtn('/leads', 'Quote requests', 'mail'));
    nav.appendChild(navBtn('/activity', 'Activity log', 'activity'));
    nav.appendChild(navBtn('/changelog', 'What’s new', 'sparkles'));

    /* Persistent way out to the real website. The page editors have their own
       "open in a new tab" arrow, but there was nothing from the dashboard or
       the list views — the most common question after saving is simply
       "so what does it look like now?". */
    nav.appendChild(h('div', { class: 'grp', text: 'Your website' }));
    nav.appendChild(navLink('/', 'View live site', 'external'));
  }
  function navLink(path, label, ic) {
    var a = h('a', { class: 'navlink', href: path, target: '_blank', rel: 'noopener' },
      [icon(ic), h('span', { text: label })]);
    return a;
  }
  function navBtn(route, label, ic) {
    var b = h('button', { type: 'button' }, [icon(ic), h('span', { text: label })]);
    b.dataset.route = route;
    b.addEventListener('click', function () { location.hash = '#' + route; });
    return b;
  }

  function showApp() {
    el('#loginView').hidden = true; el('#appView').hidden = false;
    el('#whoAmI').textContent = me;
    var ini = el('#whoInitial'); if (ini) ini.textContent = (me || '?').charAt(0).toUpperCase();
    buildNav();
    api('site_content?select=key,value,previous_value').then(function (rows) {
      (rows || []).forEach(function (r) { content[r.key] = r.value; previous[r.key] = r.previous_value; });
    }).catch(function () {}).then(function () { render(); });
  }
  /* ------------------------------------------------- password recovery ---
     Supabase mails a link back to this page with a recovery token in the URL
     fragment. We swap that token for a session, then let the user set a new
     password via PUT /auth/v1/user. The password never passes through us, and
     no service-role key is involved. */

  var recoveryToken = null;

  function sendRecovery(email) {
    return fetch(SB + '/auth/v1/recover', {
      method: 'POST',
      headers: { apikey: ANON, 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: email, redirect_to: location.origin + '/admin/' }),
    }).then(function (r) {
      // Supabase intentionally returns 200 for unknown addresses so the form
      // can't be used to discover who has an account. Mirror that in the copy.
      if (!r.ok && r.status !== 422) return r.text().then(function (x) { throw new Error(x.slice(0, 140)); });
    });
  }

  function setPassword(token, password) {
    return fetch(SB + '/auth/v1/user', {
      method: 'PUT',
      headers: { apikey: ANON, Authorization: 'Bearer ' + token, 'Content-Type': 'application/json' },
      body: JSON.stringify({ password: password }),
    }).then(function (r) {
      return r.json().then(function (j) {
        if (!r.ok) throw new Error(j.error_description || j.msg || j.message || 'Could not set the password');
        return j;
      });
    });
  }

  /* A recovery link lands as #access_token=…&type=recovery. Read it, clear it
     from the address bar so the token isn't left in history, and show the
     "choose a password" form. */
  function recoveryTokenFromUrl() {
    var hash = location.hash || '';
    if (hash.indexOf('access_token=') === -1) return null;
    var params = {};
    hash.replace(/^#/, '').split('&').forEach(function (kv) {
      var i = kv.indexOf('=');
      if (i > 0) params[decodeURIComponent(kv.slice(0, i))] = decodeURIComponent(kv.slice(i + 1));
    });
    if (params.type !== 'recovery' || !params.access_token) return null;
    return params.access_token;
  }

  function wireRecovery() {
    var forgot = el('#forgotBtn');
    if (forgot) forgot.addEventListener('click', function () {
      var mail = (el('#email').value || '').trim();
      if (!mail) {
        el('#email').focus();
        showLogin('Type your email address above first, then press this again.');
        return;
      }
      forgot.disabled = true; forgot.textContent = 'Sending…';
      el('#loginErr').hidden = true;
      sendRecovery(mail).then(function () {
        var ok = el('#loginOk');
        ok.hidden = false;
        ok.textContent = 'If ' + mail + ' has an account, a reset link is on its way. Check your inbox (and the spam folder).';
      }).catch(function (e) {
        showLogin('Could not send the email: ' + e.message);
      }).then(function () {
        forgot.disabled = false; forgot.textContent = 'Forgot your password?';
      });
    });

    var rf = el('#resetForm');
    if (rf) rf.addEventListener('submit', function (ev) {
      ev.preventDefault();
      var a = el('#newPass').value, b = el('#newPass2').value;
      var err = el('#resetErr'); err.hidden = true;
      if (a.length < 8) { err.hidden = false; err.textContent = 'Use at least 8 characters.'; return; }
      if (a !== b) { err.hidden = false; err.textContent = 'The two passwords do not match.'; return; }
      var btn = el('#resetBtn'); btn.disabled = true; btn.textContent = 'Saving…';
      setPassword(recoveryToken, a).then(function () {
        recoveryToken = null;
        rf.hidden = true;
        el('#loginForm').hidden = false;
        var ok = el('#loginOk');
        ok.hidden = false;
        ok.textContent = 'Password saved. Sign in with your new password.';
      }).catch(function (e) {
        err.hidden = false;
        err.textContent = /expired|invalid/i.test(e.message)
          ? 'That reset link has expired. Request a new one below.'
          : e.message;
        rf.hidden = true; el('#loginForm').hidden = false;
      }).then(function () {
        btn.disabled = false; btn.textContent = 'Save password';
      });
    });
  }

  function showLogin(msg) {
    el('#appView').hidden = true; el('#loginView').hidden = false;
    var rf = el('#resetForm'); if (rf) rf.hidden = true;
    var lf = el('#loginForm'); if (lf) lf.hidden = false;
    if (msg) { var e = el('#loginErr'); e.hidden = false; e.textContent = msg; }
  }

  function showReset() {
    el('#appView').hidden = true; el('#loginView').hidden = false;
    el('#loginForm').hidden = true;
    el('#resetForm').hidden = false;
    el('#newPass').focus();
  }

  el('#loginForm').addEventListener('submit', function (ev) {
    ev.preventDefault();
    var btn = el('#loginBtn'); btn.disabled = true; btn.textContent = 'Signing in…';
    el('#loginErr').hidden = true;
    signIn(el('#email').value.trim(), el('#password').value).then(function (s) {
      saveSession(s); me = (s.user && s.user.email) || el('#email').value.trim();
      logActivity('login', 'Signed in'); showApp();
    }).catch(function (e) {
      showLogin(/invalid/i.test(e.message) ? 'That email or password is not right.' : e.message);
    }).then(function () { btn.disabled = false; btn.textContent = 'Sign in'; });
  });
  el('#signOut').addEventListener('click', function () {
    if (dirty && !window.confirm('You have unsaved changes. Sign out anyway?')) return;
    logActivity('logout', 'Signed out');
    clearSession(); leaving = true; location.hash = '#/'; location.reload();
  });
  window.addEventListener('hashchange', render);

  (function boot() {
    if (!SB || !ANON) { document.body.innerHTML = '<p style="padding:40px;font-family:sans-serif">Missing site-config.js — the editor is not connected to the database.</p>'; return; }
    wireRecovery();

    /* A reset link takes priority over any stored session — otherwise someone
       already signed in would never see the "choose a password" form. */
    recoveryToken = recoveryTokenFromUrl();
    if (recoveryToken) {
      history.replaceState(null, '', location.pathname + location.search);
      clearSession();
      return showReset();
    }

    session = loadSession();
    if (!session) return showLogin();
    fetch(SB + '/auth/v1/user', { headers: { apikey: ANON, Authorization: 'Bearer ' + session.access_token } })
      .then(function (r) {
        return r.ok ? r.json() : refresh().then(function () {
          return fetch(SB + '/auth/v1/user', { headers: { apikey: ANON, Authorization: 'Bearer ' + session.access_token } }).then(function (r2) { return r2.json(); });
        });
      })
      .then(function (u) { if (!u || !u.email) throw new Error('no user'); me = u.email; showApp(); })
      .catch(function () { clearSession(); showLogin(); });
  })();
})();
