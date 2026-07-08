/* Awards & Engraving — demo behavior */
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

  // contact form (demo)
  var form = document.getElementById('quoteForm'), success = document.getElementById('formSuccess');
  if (form && success) {
    form.addEventListener('submit', function (e) {
      e.preventDefault();
      var name = document.getElementById('name').value.trim();
      var email = document.getElementById('email').value.trim();
      var ok = name.length > 1 && /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email);
      if (!ok) { var bad = !name ? document.getElementById('name') : document.getElementById('email'); bad.style.borderColor = '#e0603f'; bad.focus(); return; }
      form.style.display = 'none';
      success.classList.add('show');
    });
  }
})();
