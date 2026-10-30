/* Landing page interactions: nav state, reveal-on-scroll, the Study Together scene, Nuru state preview, feeling demo. */
(() => {
  'use strict';
  const nav = document.getElementById('site-nav');
  const onScroll = () => nav && nav.classList.toggle('scrolled', window.scrollY > 40);
  onScroll();
  window.addEventListener('scroll', onScroll, { passive: true });

  // Showcase scene: a few desk keepsakes, and day or evening by the visitor's clock.
  document.querySelectorAll('.hero-scene .scene-svg, .auth-art .scene-svg').forEach(svg => {
    ['reading_lamp', 'succulent', 'paper_garland', 'tea_set', 'index_cards'].forEach(k => svg.classList.add('has-' + k));
    const h = new Date().getHours();
    svg.dataset.theme = h >= 18 || h < 6 ? 'evening' : 'day';
    const fit = () => { const box = svg.parentElement.getBoundingClientRect(); const tall = box.width / Math.max(1, box.height) < 1.9;
      svg.setAttribute('viewBox', tall ? '300 40 620 360' : '0 0 1200 460'); svg.setAttribute('preserveAspectRatio', tall ? 'xMidYMid slice' : 'xMidYMax slice'); };
    fit(); if ('ResizeObserver' in window) new ResizeObserver(fit).observe(svg.parentElement);
  });

  const reveal = document.querySelectorAll('.reveal');
  if ('IntersectionObserver' in window) {
    document.documentElement.classList.add('js-reveal');
    const io = new IntersectionObserver(entries => entries.forEach(e => {
      if (e.isIntersecting) { e.target.classList.add('is-visible'); io.unobserve(e.target); }
    }), { threshold: 0.12, rootMargin: '0px 0px -40px 0px' });
    reveal.forEach((el, i) => { el.style.transitionDelay = `${(i % 4) * 70}ms`; io.observe(el); });
  } else reveal.forEach(el => el.classList.add('is-visible'));

  const nuru = document.querySelector('.meet-stage .nuru');
  document.querySelectorAll('[data-nuru]').forEach(btn => btn.addEventListener('click', () => {
    document.querySelectorAll('[data-nuru]').forEach(b => b.setAttribute('aria-pressed', String(b === btn)));
    if (nuru) nuru.dataset.state = btn.dataset.nuru;
  }));

  const bubble = document.getElementById('feel-bubble');
  document.querySelectorAll('[data-feel]').forEach(btn => btn.addEventListener('click', () => {
    document.querySelectorAll('[data-feel]').forEach(b => b.setAttribute('aria-pressed', String(b === btn)));
    bubble.style.opacity = 0;
    setTimeout(() => { bubble.textContent = btn.dataset.msg; bubble.style.opacity = 1; }, 180);
  }));
})();
