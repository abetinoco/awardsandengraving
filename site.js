/* Awards & Engraving — demo homepage behavior */
(function () {
  var yr = document.getElementById('yr');
  if (yr) yr.textContent = new Date().getFullYear();

  // floating nav: compact + shadow after scroll
  var navF = document.getElementById('navFloat');
  if (navF) {
    var onNav = function () {
      if ((window.scrollY || document.documentElement.scrollTop) > 24) navF.classList.add('scrolled');
      else navF.classList.remove('scrolled');
    };
    window.addEventListener('scroll', onNav, { passive: true });
    onNav();
  }

  // mobile hamburger menu
  var burger = document.getElementById('navBurger');
  var menu = document.getElementById('navMenu');
  if (burger && menu) {
    var setMenu = function (open) {
      document.body.classList.toggle('nav-open', open);
      burger.setAttribute('aria-expanded', open ? 'true' : 'false');
      burger.setAttribute('aria-label', open ? 'Close menu' : 'Open menu');
      menu.setAttribute('aria-hidden', open ? 'false' : 'true');
    };
    burger.addEventListener('click', function () {
      setMenu(!document.body.classList.contains('nav-open'));
    });
    menu.querySelectorAll('a').forEach(function (a) {
      a.addEventListener('click', function () { setMenu(false); });
    });
    document.addEventListener('keydown', function (e) {
      if (e.key === 'Escape' && document.body.classList.contains('nav-open')) setMenu(false);
    });
    window.addEventListener('resize', function () {
      if (window.innerWidth > 820 && document.body.classList.contains('nav-open')) setMenu(false);
    });
  }

  // reveal on scroll
  var io = new IntersectionObserver(function (entries) {
    entries.forEach(function (en) {
      if (en.isIntersecting) { en.target.classList.add('in'); io.unobserve(en.target); }
    });
  }, { threshold: 0.14 });
  document.querySelectorAll('.reveal').forEach(function (el) { io.observe(el); });

  // demo quote form — shows success, sends nothing
  var form = document.getElementById('quoteForm');
  var success = document.getElementById('formSuccess');
  if (form && success) {
    form.addEventListener('submit', function (e) {
      e.preventDefault();
      var name = document.getElementById('name').value.trim();
      var email = document.getElementById('email').value.trim();
      var ok = name.length > 1 && /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email);
      if (!ok) {
        var bad = !name ? document.getElementById('name') : document.getElementById('email');
        bad.style.borderColor = '#e0603f'; bad.focus(); return;
      }
      form.style.display = 'none';
      success.classList.add('show');
    });
  }
})();
