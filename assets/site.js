/* Small, dependency-free behaviours: theme toggle, hide-on-scroll nav, mobile menu,
   reveal-on-scroll, TOC highlighting, print button, Web3Forms contact form. */
(function () {
  'use strict';
  var root = document.documentElement;

  // Theme ------------------------------------------------------------------
  function setTheme(t) {
    if (t === 'dark') root.setAttribute('data-theme', 'dark'); else root.removeAttribute('data-theme');
    try { localStorage.setItem('theme', t); } catch (e) {}
  }
  var toggle = document.querySelector('.theme-toggle');
  if (toggle) toggle.addEventListener('click', function () {
    setTheme(root.getAttribute('data-theme') === 'dark' ? 'light' : 'dark');
  });

  // Hide the top bar when scrolling down, show when scrolling up ------------
  var bar = document.getElementById('topbar');
  var lastY = window.scrollY, ticking = false;
  window.addEventListener('scroll', function () {
    if (ticking) return;
    ticking = true;
    requestAnimationFrame(function () {
      var y = window.scrollY;
      if (bar) {
        if (y > lastY && y > 160 && !document.querySelector('.nav-links.open')) bar.classList.add('is-hidden');
        else bar.classList.remove('is-hidden');
      }
      lastY = y;
      ticking = false;
    });
  }, { passive: true });

  // Mobile menu --------------------------------------------------------------
  var navToggle = document.querySelector('.nav-toggle');
  var navLinks = document.getElementById('nav-links');
  if (navToggle && navLinks) {
    navToggle.addEventListener('click', function () {
      var open = navLinks.classList.toggle('open');
      navToggle.setAttribute('aria-expanded', open ? 'true' : 'false');
    });
    document.addEventListener('keydown', function (e) {
      if (e.key === 'Escape' && navLinks.classList.contains('open')) { navLinks.classList.remove('open'); navToggle.setAttribute('aria-expanded', 'false'); }
    });
  }

  // Reveal on scroll ---------------------------------------------------------
  var reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  var cards = document.querySelectorAll('.work-index .reveal, .featured-grid .work-card');
  if (!reduce && 'IntersectionObserver' in window && cards.length) {
    var io = new IntersectionObserver(function (entries) {
      entries.forEach(function (en) { if (en.isIntersecting) { en.target.classList.add('in'); io.unobserve(en.target); } });
    }, { rootMargin: '0px 0px -8% 0px' });
    cards.forEach(function (el, i) { el.classList.add('reveal', 'io'); el.style.transitionDelay = (Math.min(i, 8) * 40) + 'ms'; io.observe(el); });
  }

  // TOC active state ---------------------------------------------------------
  var tocLinks = document.querySelectorAll('.toc a');
  if (tocLinks.length && 'IntersectionObserver' in window) {
    var map = {};
    tocLinks.forEach(function (a) { map[a.getAttribute('href').slice(1)] = a; });
    var headings = Array.prototype.map.call(tocLinks, function (a) { return document.getElementById(a.getAttribute('href').slice(1)); }).filter(Boolean);
    var current = null;
    var hio = new IntersectionObserver(function (entries) {
      entries.forEach(function (en) { if (en.isIntersecting) current = en.target.id; });
      if (current && map[current]) { tocLinks.forEach(function (a) { a.classList.remove('active'); }); map[current].classList.add('active'); }
    }, { rootMargin: '-20% 0px -65% 0px', threshold: 0 });
    headings.forEach(function (h) { hio.observe(h); });
  }

  // Print buttons ------------------------------------------------------------
  document.querySelectorAll('.print-action').forEach(function (b) { b.addEventListener('click', function () { window.print(); }); });

  // Contact form -> Web3Forms (falls back to mailto) -------------------------
  var form = document.getElementById('contact-form');
  if (form) form.addEventListener('submit', function (e) {
    e.preventDefault();
    var f = new FormData(form);
    var to = form.getAttribute('data-to');
    var key = form.getAttribute('data-key');
    var btn = form.querySelector('.contact-submit');
    var status = form.querySelector('.form-status');
    function mailto() {
      var subject = encodeURIComponent(f.get('subject') || 'Hello from your website');
      var body = encodeURIComponent((f.get('message') || '') + '\n\n— ' + (f.get('name') || '') + ' <' + (f.get('email') || '') + '>');
      window.location.href = 'mailto:' + to + '?subject=' + subject + '&body=' + body;
    }
    function say(msg, ok) {
      if (!status) return;
      status.hidden = false; status.textContent = msg;
      status.className = 'form-status ' + (ok ? 'is-ok' : 'is-error');
    }
    if (!key || !window.fetch) { mailto(); return; }
    if (f.get('botcheck')) return;
    var label = btn ? btn.innerHTML : '';
    if (btn) { btn.disabled = true; btn.textContent = 'Sending…'; }
    if (status) status.hidden = true;
    fetch('https://api.web3forms.com/submit', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Accept': 'application/json' },
      body: JSON.stringify({
        access_key: key,
        subject: 'Website note: ' + (f.get('subject') || ''),
        from_name: (f.get('name') || 'Website visitor') + ' (via huiguoliu911.github.io)',
        name: f.get('name'), email: f.get('email'), replyto: f.get('email'),
        message: f.get('message'), botcheck: false
      })
    }).then(function (r) { return r.json(); }).then(function (d) {
      if (!d || !d.success) throw new Error((d && d.message) || 'failed');
      form.reset();
      say('Thanks — your note is on its way. I’ll reply by email soon.', true);
    }).catch(function () {
      say('That didn’t go through. Opening your email app instead…', false);
      setTimeout(mailto, 900);
    }).then(function () {
      if (btn) { btn.disabled = false; btn.innerHTML = label; }
    });
  });
})();
