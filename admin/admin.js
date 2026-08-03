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
    { id: 'services',  label: 'Services',     path: '/services',  icon: 'wrench',   blurb: 'The six service blocks and how it works.' },
    { id: 'shop',      label: 'Our Shop',     path: '/our-shop',  icon: 'building', blurb: 'The machines and what they mean for a piece.' },
    { id: 'portfolio', label: 'Portfolio',    path: '/portfolio', icon: 'image',    blurb: 'Recent work and the gallery captions.' },
    { id: 'reviewsp',  label: 'Reviews page', path: '/reviews',   icon: 'star',     blurb: 'The intro above the review wall.' },
    { id: 'about',     label: 'About',        path: '/about',     icon: 'book',     blurb: 'The shop story, timeline and client wall.' },
    { id: 'contact',   label: 'Contact',      path: '/contact',   icon: 'phone',    blurb: 'Form intro, FAQ answers, address and hours.' },
    { id: 'site',      label: 'Header & footer', path: '/',        icon: 'layers',   only: 'site',
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
    if (route.indexOf('/page/') === 0) return viewPage(main, route.slice(6));
    if (route === '/reviews') return viewReviews(main);
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
        quickCard('star', 'Add a review', 'Shown on the homepage', '#/reviews', 'tint-amber'),
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

  function viewPage(main, id) {
    var page = PAGES.filter(function (p) { return p.id === id; })[0];
    if (!page) return viewDashboard(main);
    currentPage = page; draft = {};

    var saveBtn = h('button', { class: 'btn-gold', id: 'saveBtn', disabled: true }, [icon('check'), h('span', { text: 'Save & publish' })]);
    main.appendChild(header(page.label, page.blurb,
      [h('span', { class: 'status', id: 'status', text: 'No changes yet' }), saveBtn],
      [{ label: 'Dashboard', href: '#/' }, { label: 'Pages' }, { label: page.label }]));

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
        var chosen = (window.AE_CROP ? window.AE_CROP.open(fl, aspect) : Promise.resolve(fl));
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
    });
  }

  /* ---------------------------------------------------------- reviews --- */

  function viewReviews(main) {
    main.appendChild(header('Reviews', 'Shown on the homepage and the Reviews page. Hiding one takes it off the site but keeps it here.',
      [(function () { var b = h('button', { class: 'btn-line' }, [icon('plus'), h('span', { text: 'Add review' })]); b.addEventListener('click', addReview); return b; })()],
      [{ label: 'Dashboard', href: '#/' }, { label: 'Reviews' }]));
    main.appendChild(h('div', { class: 'pane-form' }, [h('div', { class: 'rows', id: 'revRows' }, [h('p', { class: 'hint', text: 'Loading…' })])]));
    loadReviews();
  }
  function loadReviews() {
    api('reviews?select=*&order=order_index.asc,id.asc').then(function (rows) {
      var box = el('#revRows'); if (!box) return;
      box.textContent = '';
      if (!rows.length) { box.appendChild(h('p', { class: 'hint', text: 'No reviews yet — press “Add review”.' })); return; }
      rows.forEach(function (r) { box.appendChild(reviewRow(r)); });
    }).catch(function (e) { toast('Could not load reviews: ' + e.message, 'err'); });
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
        .catch(function (e) { toast('Could not save: ' + e.message, 'err'); });
    });
    var del = h('button', { class: 'btn-line btn-sm', text: 'Delete' });
    del.addEventListener('click', function () {
      if (!window.confirm('Delete this review permanently?\n\nTip: unticking “Visible on the site” hides it and keeps it here.')) return;
      api('reviews?id=eq.' + r.id, { method: 'DELETE' })
        .then(function () { logActivity('deleted', 'Review — ' + (r.author || '')); toast('Review deleted.'); loadReviews(); })
        .catch(function (e) { toast('Could not delete: ' + e.message, 'err'); });
    });
    body.appendChild(h('div', { class: 'rowacts' }, [save, del]));
    return row;
  }
  function addReview() {
    api('reviews', { method: 'POST', headers: { Prefer: 'return=minimal' },
      body: JSON.stringify({ author: 'New review', body: '', visible: false, rating: 5 }) })
      .then(function () { logActivity('created', 'Review'); toast('Added — hidden until you tick “Visible”.'); loadReviews(); })
      .catch(function (e) { toast('Could not add: ' + e.message, 'err'); });
  }

  /* ------------------------------------------------------------ leads --- */

  function viewLeads(main) {
    main.appendChild(header('Quote requests', 'Everyone who filled in the form on the website.', [],
      [{ label: 'Dashboard', href: '#/' }, { label: 'Quote requests' }]));
    main.appendChild(h('div', { class: 'pane-form' }, [h('div', { class: 'rows', id: 'leadRows' }, [h('p', { class: 'hint', text: 'Loading…' })])]));
    api('leads?select=*&order=created_at.desc&limit=100').then(function (rows) {
      var b = el('#leadRows'); if (!b) return;
      b.textContent = '';
      if (!rows.length) { b.appendChild(h('p', { class: 'hint', text: 'No quote requests yet.' })); return; }
      rows.forEach(function (l) {
        var body = h('div', { class: 'row-body' }); body.hidden = true;
        body.appendChild(h('p', { text: l.message || '(no message)' }));
        body.appendChild(h('p', { class: 'hint', text: [l.email, l.phone, l.interest].filter(Boolean).join(' · ') }));
        body.appendChild(h('a', { class: 'btn-line btn-sm', href: 'mailto:' + l.email, text: 'Reply by email' }));
        var top = h('div', { class: 'row-top' }, [
          h('span', { class: 'av', style: 'background:#4a5a7a', text: (l.name || '?').charAt(0) }),
          h('b', { text: l.name }), h('span', { class: 'meta', text: l.interest || '' }),
          h('span', { class: 'sp' }), h('span', { class: 'meta', text: ago(l.created_at) }),
        ]);
        top.addEventListener('click', function () { body.hidden = !body.hidden; });
        b.appendChild(h('div', { class: 'row' }, [top, body]));
      });
    }).catch(function (e) { toast('Could not load: ' + e.message, 'err'); });
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
        { label: 'Reviews', sub: 'Add, edit or hide reviews', href: '#/reviews', ic: 'star' },
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
          b.addEventListener('click', function () { close(); location.hash = i.href; });
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

  function buildNav() {
    var nav = el('#sideNav'); nav.textContent = '';
    nav.appendChild(navBtn('/', 'Dashboard', 'dashboard'));
    nav.appendChild(h('div', { class: 'grp', text: 'Pages' }));
    PAGES.forEach(function (p) { nav.appendChild(navBtn('/page/' + p.id, p.label, p.icon)); });
    nav.appendChild(h('div', { class: 'grp', text: 'Everything else' }));
    nav.appendChild(navBtn('/reviews', 'Reviews', 'star'));
    nav.appendChild(navBtn('/leads', 'Quote requests', 'mail'));
    nav.appendChild(navBtn('/activity', 'Activity log', 'activity'));
    nav.appendChild(navBtn('/changelog', 'What’s new', 'sparkles'));
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
  function showLogin(msg) {
    el('#appView').hidden = true; el('#loginView').hidden = false;
    if (msg) { var e = el('#loginErr'); e.hidden = false; e.textContent = msg; }
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
