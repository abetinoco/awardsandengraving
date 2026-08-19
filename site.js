/* Turnstile tokens are single-use and expire after ~300s. Reset on expiry so the
   widget re-challenges instead of holding a dead token while showing "Success!". */
window.siteTurnstileExpired = function () {
  if (window.turnstile) { try { window.turnstile.reset(); } catch (e) {} }
};
/* Awards & Engraving — site behavior */
(function () {
  // preloader
  var pre = document.getElementById('preloader');
  if (pre) {
    var hide = function () {
      pre.classList.add('done');
      setTimeout(function () { if (pre.parentNode) pre.parentNode.removeChild(pre); }, 700);
    };
    // Dismiss on whichever comes first: the document being parsed (plus a beat so
    // the mark is actually seen), or window.load. Waiting on load alone meant
    // waiting on every image on the page — the overlay is opaque and full-bleed,
    // so nothing could paint behind it and LCP sat at 5.6s on mobile.
    var kick = function () { setTimeout(hide, 400); };
    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', kick, { once: true });
    } else {
      kick();
    }
    window.addEventListener('load', function () { setTimeout(hide, 100); }, { once: true });
    setTimeout(hide, 3500); // safety
  }

  var yr = document.getElementById('yr');
  if (yr) yr.textContent = new Date().getFullYear();

  // Years-in-business counters. The markup ships with the correct number so crawlers
  // and no-JS visitors see it; this just stops it going stale on New Year's Day.
  // <span class="yrs">77</span>                      -> "78"
  // <span class="yrs" data-format="words">…</span>   -> "seventy-eight" (case follows the markup)
  // data-since="1949" overrides the founding year.
  var ONES = ['zero', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine', 'ten',
    'eleven', 'twelve', 'thirteen', 'fourteen', 'fifteen', 'sixteen', 'seventeen', 'eighteen', 'nineteen'];
  var TENS = ['', '', 'twenty', 'thirty', 'forty', 'fifty', 'sixty', 'seventy', 'eighty', 'ninety'];
  var inWords = function (n) {
    if (n < 20) return ONES[n];
    if (n > 99) return String(n); // past our vocabulary — digits are still correct
    var tens = TENS[Math.floor(n / 10)], ones = n % 10;
    return ones ? tens + '-' + ONES[ones] : tens;
  };
  document.querySelectorAll('.yrs').forEach(function (el) {
    var since = parseInt(el.getAttribute('data-since'), 10) || 1949;
    var years = new Date().getFullYear() - since;
    if (!(years > 0)) return; // bad data-since — leave the markup alone
    if (el.getAttribute('data-format') !== 'words') { el.textContent = String(years); return; }
    var word = inWords(years);
    // Match the capitalisation already in the markup, so a sentence-opening
    // "Seventy-seven" doesn't come back lowercase.
    if (/^[A-Z]/.test((el.textContent || '').trim())) word = word.charAt(0).toUpperCase() + word.slice(1);
    el.textContent = word;
  });

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
  // The gallery is re-rendered from the portfolio_items table after load, so
  // the figure list is queried at click time rather than cached — a cached
  // NodeList would point at figures that are no longer in the document and
  // filtering would silently stop working.
  // Both the chips and the figures are re-rendered from the CMS after load, so
  // this delegates from the container instead of binding to elements that may
  // be replaced. Nothing here caches a NodeList.
  var chipBar = document.querySelector('.chips');
  if (chipBar) {
    var currentFilter = 'all';
    var applyFilter = function (f) {
      currentFilter = f;
      document.querySelectorAll('.gal figure[data-cat]').forEach(function (fig) {
        fig.classList.toggle('hide', f !== 'all' && fig.getAttribute('data-cat') !== f);
      });
      chipBar.querySelectorAll('.chip').forEach(function (x) {
        var on = x.getAttribute('data-filter') === f;
        x.classList.toggle('on', on);
        x.setAttribute('aria-pressed', on ? 'true' : 'false');
      });
    };
    chipBar.addEventListener('click', function (e) {
      var c = e.target.closest ? e.target.closest('.chip') : null;
      if (!c || !chipBar.contains(c)) return;
      applyFilter(c.getAttribute('data-filter'));
    });
    // Re-apply the active filter whenever the CMS swaps chips or figures in.
    document.addEventListener('ae:portfolio-rendered', function () { applyFilter(currentFilter); });
    document.addEventListener('ae:chips-rendered', function () { applyFilter(currentFilter); });
  }

  // contact form — posts JSON to the endpoint named in data-endpoint on #quoteForm.
  // Live endpoint is /api/quote (Resend). Same-origin, so no CSP connect-src change needed;
  // a third-party host would have to be allowed there. Empty endpoint = demo mode.
  var form = document.getElementById('quoteForm'), success = document.getElementById('formSuccess');
  if (form && success) {
    // Load Cloudflare Turnstile once if a widget mount is present in the form.
    if (form.querySelector('.cf-turnstile') && !document.querySelector('script[data-turnstile-loader]')) {
      var tsScript = document.createElement('script');
      tsScript.src = 'https://challenges.cloudflare.com/turnstile/v0/api.js';
      tsScript.async = true; tsScript.defer = true; tsScript.setAttribute('data-turnstile-loader', '1');
      document.head.appendChild(tsScript);
    }
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
        var payload = {};
        new FormData(form).forEach(function (v, k) { payload[k] = v; });
        // Normalize the Cloudflare-injected token field to the name the API expects.
        payload.turnstileToken = payload['cf-turnstile-response'] || '';
        fetch(endpoint, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
          body: JSON.stringify(payload)
        })
          .then(function (r) { if (!r.ok) throw new Error('send failed'); done(); })
          .catch(function () {
            btn.disabled = false;
            btn.innerHTML = 'Send request <span class="arrow">&rarr;</span>';
            // Turnstile tokens are single-use — reset so a retry gets a fresh one.
            if (window.turnstile) { try { window.turnstile.reset(); } catch (e) {} }
            alert('Something went wrong sending your request — please call (847) 549-1923 or email daniel@awardsandengraving.com.');
          });
      } else {
        done(); // demo mode
      }
    });
  }
})();
