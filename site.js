/* Awards & Engraving — site behavior */
(function () {
  // preloader
  var pre = document.getElementById('preloader');
  if (pre) {
    var hide = function () {
      pre.classList.add('done');
      setTimeout(function () { if (pre.parentNode) pre.parentNode.removeChild(pre); }, 700);
    };
    if (document.readyState === 'complete') setTimeout(hide, 500);
    else window.addEventListener('load', function () { setTimeout(hide, 450); }, { once: true });
    setTimeout(hide, 3500); // safety
  }

  var yr = document.getElementById('yr');
  if (yr) yr.textContent = new Date().getFullYear();

  // floating nav scroll state
  var navF = document.getElementById('navFloat');
  if (navF) {
    var onNav = function () { navF.classList.toggle('scrolled', (window.scrollY || document.documentElement.scrollTop) > 24); };
    window.addEventListener('scroll', onNav, { passive: true });
    onNav();
  }

  // sticky mobile CTA bar — appears after scrolling past the hero
  var sticky = document.getElementById('stickyCta');
  if (sticky) {
    var onSticky = function () { sticky.classList.toggle('show', (window.scrollY || document.documentElement.scrollTop) > 480); };
    window.addEventListener('scroll', onSticky, { passive: true });
    onSticky();
  }

  // mobile menu
  var burger = document.getElementById('navBurger'), menu = document.getElementById('navMenu');
  if (burger && menu) {
    var setMenu = function (o) {
      document.body.classList.toggle('nav-open', o);
      burger.setAttribute('aria-expanded', o ? 'true' : 'false');
      burger.setAttribute('aria-label', o ? 'Close menu' : 'Open menu');
      menu.setAttribute('aria-hidden', o ? 'false' : 'true');
    };
    burger.addEventListener('click', function () { setMenu(!document.body.classList.contains('nav-open')); });
    menu.querySelectorAll('a').forEach(function (a) { a.addEventListener('click', function () { setMenu(false); }); });
    document.addEventListener('keydown', function (e) { if (e.key === 'Escape' && document.body.classList.contains('nav-open')) setMenu(false); });
    window.addEventListener('resize', function () { if (window.innerWidth > 820 && document.body.classList.contains('nav-open')) setMenu(false); });
  }

  // reveal on scroll
  var io = new IntersectionObserver(function (es) {
    es.forEach(function (en) { if (en.isIntersecting) { en.target.classList.add('in'); io.unobserve(en.target); } });
  }, { threshold: 0.12 });
  document.querySelectorAll('.reveal').forEach(function (el) { io.observe(el); });

  // gallery filter chips (work page)
  var chips = document.querySelectorAll('.chip');
  var figs = document.querySelectorAll('.gal figure[data-cat]');
  if (chips.length && figs.length) {
    chips.forEach(function (c) {
      c.addEventListener('click', function () {
        chips.forEach(function (x) { x.classList.remove('on'); x.setAttribute('aria-pressed', 'false'); });
        c.classList.add('on');
        c.setAttribute('aria-pressed', 'true');
        var f = c.getAttribute('data-filter');
        figs.forEach(function (fig) { fig.classList.toggle('hide', f !== 'all' && fig.getAttribute('data-cat') !== f); });
      });
    });
  }

  // contact form — endpoint-ready.
  // To go live: set data-endpoint="https://..." on #quoteForm (e.g. Web3Forms/Formspree URL,
  // or a /api/quote serverless function) and allow that host in vercel.json CSP connect-src.
  // With no endpoint set, the form runs in demo mode.
  var form = document.getElementById('quoteForm'), success = document.getElementById('formSuccess');
  if (form && success) {
    form.addEventListener('submit', function (e) {
      e.preventDefault();
      var name = document.getElementById('name').value.trim();
      var email = document.getElementById('email').value.trim();
      var ok = name.length > 1 && /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email);
      if (!ok) { var bad = !name ? document.getElementById('name') : document.getElementById('email'); bad.style.borderColor = '#e0603f'; bad.focus(); return; }
      var done = function () { form.style.display = 'none'; success.classList.add('show'); };
      var endpoint = form.getAttribute('data-endpoint');
      if (endpoint) {
        var btn = form.querySelector('.f-submit');
        btn.disabled = true; btn.textContent = 'Sending…';
        fetch(endpoint, { method: 'POST', body: new FormData(form), headers: { Accept: 'application/json' } })
          .then(function (r) { if (!r.ok) throw new Error('send failed'); done(); })
          .catch(function () {
            btn.disabled = false;
            btn.innerHTML = 'Send request <span class="arrow">&rarr;</span>';
            alert('Something went wrong sending your request — please call (847) 549-1923 or email info@awardsandengraving.com.');
          });
      } else {
        done(); // demo mode
      }
    });
  }
})();
