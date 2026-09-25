/* ProcureIQ motion controller — V133
 * Vanilla implementation of modern React-style motion principles.
 * Motion is decorative/feedback only; business values and controls remain real.
 */
(function () {
  'use strict';

  if (window.__PROCUREIQ_ANIMATIONS__) return;
  window.__PROCUREIQ_ANIMATIONS__ = true;

  const reduce = !!window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
  const coarse = !!window.matchMedia?.('(pointer: coarse)').matches;
  const $ = (selector, root = document) => root.querySelector(selector);
  const $$ = (selector, root = document) => Array.from(root.querySelectorAll(selector));

  function initSpecular() {
    $$('.primary-cta,.p27-button-primary,.p27-nav-primary,.review-submit-btn,.settings-footer .primary-cta,.retry-ai,.drawer-ai-button').forEach(el => {
      if (el.dataset.piqSpecular === '1') return;
      el.dataset.piqSpecular = '1';
      el.classList.add('piq-specular');
      el.addEventListener('pointermove', event => {
        const rect = el.getBoundingClientRect();
        el.style.setProperty('--piq-x', `${((event.clientX - rect.left) / Math.max(rect.width, 1)) * 100}%`);
        el.style.setProperty('--piq-y', `${((event.clientY - rect.top) / Math.max(rect.height, 1)) * 100}%`);
      }, { passive: true });
    });
  }

  function initSpotlight() {
    $$('.p27-hero-card,.p27-pillar,.pillar-card,.work-card,.dashboard-plan,.feature-outcome,.billing-current,.billing-region-picker,.supplier-scorecard,.control-pack-card').forEach(el => {
      if (el.dataset.piqSpotlight === '1') return;
      el.dataset.piqSpotlight = '1';
      el.classList.add('piq-spotlight');
      el.addEventListener('pointermove', event => {
        const rect = el.getBoundingClientRect();
        el.style.setProperty('--piq-mx', `${event.clientX - rect.left}px`);
        el.style.setProperty('--piq-my', `${event.clientY - rect.top}px`);
      }, { passive: true });
    });
  }

  function initPixelSwap() {
    const card = $('.p27-hero-card');
    if (!card || card.dataset.piqPixel === '1') return;
    card.dataset.piqPixel = '1';
    card.classList.add('piq-pixel-swap');
  }

  function initSignalSweep() {
    $$('.p27-hero-card,.p27-product-window').forEach(el => {
      if (el.dataset.piqSignal === '1') return;
      el.dataset.piqSignal = '1';
      el.classList.add('piq-signal-sweep');
    });
  }

  function initScrollExpand() {
    const el = $('.p27-product-window');
    if (!el || el.dataset.piqScroll === '1') return;
    el.dataset.piqScroll = '1';
    el.classList.add('piq-scroll-expand');
    if (reduce) return;

    let raf = 0;
    const update = () => {
      raf = 0;
      const rect = el.getBoundingClientRect();
      const viewport = window.innerHeight || 1;
      const progress = Math.max(0, Math.min(1, (viewport - rect.top) / (viewport + rect.height * .65)));
      const eased = progress * progress * (3 - 2 * progress);
      el.style.transform = `scale(${.95 + eased * .05})`;
      el.style.clipPath = `inset(${4 - eased * 4}% ${2 - eased * 2}% ${4 - eased * 4}% ${2 - eased * 2}% round ${18 - eased * 6}px)`;
      el.style.opacity = String(.93 + eased * .07);
    };
    const requestUpdate = () => { if (!raf) raf = requestAnimationFrame(update); };
    update();
    window.addEventListener('scroll', requestUpdate, { passive: true });
    window.addEventListener('resize', requestUpdate, { passive: true });
  }

  function initStepper() {
    const wrap = $('.p27-steps');
    if (!wrap || wrap.dataset.piqStepper === '1') return;
    wrap.dataset.piqStepper = '1';
    const steps = Array.from(wrap.children).filter(el => el.matches('article,div'));
    if (!steps.length) return;
    const activate = index => steps.forEach((step, i) => step.classList.toggle('piq-step-active', i === index));
    if (reduce) { activate(0); return; }

    const observer = new IntersectionObserver(entries => {
      entries.forEach(entry => {
        if (entry.isIntersecting) activate(steps.indexOf(entry.target));
      });
    }, { rootMargin: '-30% 0px -45% 0px', threshold: .01 });

    steps.forEach((step, index) => {
      step.dataset.stepIndex = String(index);
      observer.observe(step);
      step.addEventListener('mouseenter', () => activate(index));
      step.addEventListener('focusin', () => activate(index));
    });
    activate(0);
  }

  function ensureThoughtLine(box) {
    if (!box || box.querySelector('.piq-thoughtline')) return null;
    const line = document.createElement('div');
    line.className = 'piq-thoughtline';
    line.innerHTML = '<span class="piq-thought-dot" aria-hidden="true"></span><span>Tracing verified procurement evidence</span><span class="piq-thought-shimmer" aria-hidden="true"></span>';
    box.appendChild(line);
    return line;
  }

  function refreshThoughtLines() {
    $$('.ai-insight.ai-insight-analyzing').forEach(box => ensureThoughtLine(box));
    $$('.ai-insight:not(.ai-insight-analyzing)').forEach(box => {
      const line = box.querySelector('.piq-thoughtline');
      if (line && !line.classList.contains('is-done')) {
        line.classList.add('is-done');
        const label = line.querySelector('span:nth-child(2)');
        if (label) label.textContent = 'Evidence trace complete';
      }
    });
  }

  function initPeekRating() {
    const row = $('.star-rating');
    if (!row || row.dataset.piqPeek === '1') return;
    row.dataset.piqPeek = '1';
    row.classList.add('piq-peek-rating');
    const stars = $$('.rating-star', row);
    const setPeek = n => stars.forEach(star => {
      const value = Number(star.dataset.rating || 0);
      star.dataset.peekActive = value <= n ? 'true' : 'false';
    });
    stars.forEach(star => {
      star.addEventListener('mouseenter', () => setPeek(Number(star.dataset.rating || 0)));
      star.addEventListener('mouseleave', () => stars.forEach(s => delete s.dataset.peekActive));
      star.addEventListener('focus', () => setPeek(Number(star.dataset.rating || 0)));
      star.addEventListener('blur', () => stars.forEach(s => delete s.dataset.peekActive));
    });
  }

  function initReveal() {
    const targets = $$('.p27-section,.p27-workflow,.p27-contact,.p27-section-head,.p27-preview-copy,.p27-product-window,.p27-pillars,.p27-steps');
    if (reduce) {
      targets.forEach(el => el.classList.add('piq-visible'));
      return;
    }
    const observer = new IntersectionObserver(entries => entries.forEach(entry => {
      if (entry.isIntersecting) {
        entry.target.classList.add('piq-visible');
        observer.unobserve(entry.target);
      }
    }), { threshold: .12, rootMargin: '0px 0px -8% 0px' });
    targets.forEach(el => {
      if (!el.classList.contains('piq-reveal')) el.classList.add('piq-reveal');
      observer.observe(el);
    });
  }

  function initIntelligenceCards() {
    $$('.p27-pillars').forEach(wrap => {
      if (wrap.dataset.piqCards === '1') return;
      wrap.dataset.piqCards = '1';
      const cards = $$('.piq-intelligence-card', wrap);
      const activate = index => {
        wrap.classList.add('piq-has-active');
        cards.forEach((card, i) => card.classList.toggle('piq-card-active', i === index));
      };
      const clear = () => {
        wrap.classList.remove('piq-has-active');
        cards.forEach(card => card.classList.remove('piq-card-active'));
      };
      cards.forEach((card, index) => {
        card.addEventListener('mouseenter', () => activate(index));
        card.addEventListener('focusin', () => activate(index));
        card.addEventListener('mouseleave', clear);
        card.addEventListener('focusout', event => { if (!card.contains(event.relatedTarget)) clear(); });
      });
    });
  }

  function initMarketingHover() {
    $$('.p27-hero-card,.p27-product-window,.p27-preview-points>div,.p27-steps>article,.p27-contact,.p27-form').forEach(el => el.classList.add('piq-hover-lift'));
  }

  function initDashboardHover() {
    const selectors = [
      '.app-shell .work-card', '.app-shell .feature-outcome', '.app-shell .stats .card',
      '.app-shell .usage-card', '.app-shell .dashboard-plan', '.app-shell .billing-current',
      '.app-shell .billing-region-picker', '.app-shell .contact-card', '.app-shell .review-form-card',
      '.app-shell .result-card', '.app-shell .evidence-note', '.app-shell .control-pack-card',
      '.app-shell .supplier-scorecard-card', '.app-shell .supplier-scorecard', '.app-shell .runbook-step',
      '.app-shell .help-search', '.app-shell .help-grid > *', '.app-shell .feature-card-large'
    ];
    $$(selectors.join(',')).forEach(el => el.classList.add('piq-dashboard-hover'));
  }

  function initHeadingGlow() {
    $$('.piq-interactive-heading').forEach(el => {
      if (el.dataset.piqHeading === '1') return;
      el.dataset.piqHeading = '1';
      const glow = () => {
        if (reduce) return;
        el.classList.remove('piq-heading-glow');
        void el.offsetWidth;
        el.classList.add('piq-heading-glow');
        window.setTimeout(() => el.classList.remove('piq-heading-glow'), 900);
      };
      el.addEventListener('click', glow);
      el.addEventListener('keydown', event => {
        if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); glow(); }
      });
    });
  }

  function initCursor() {
    if (reduce || coarse || !$('.p27-site') || $('.piq-magnetic-cursor')) return;
    const dot = document.createElement('div');
    dot.className = 'piq-magnetic-cursor';
    dot.setAttribute('aria-hidden', 'true');
    document.body.appendChild(dot);

    let x = -100, y = -100, tx = x, ty = y, raf = 0;
    const tick = () => {
      x += (tx - x) * .22;
      y += (ty - y) * .22;
      dot.style.transform = `translate3d(${x - 3.5}px,${y - 3.5}px,0)`;
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);

    document.addEventListener('pointermove', event => {
      tx = event.clientX; ty = event.clientY;
      const target = event.target.closest?.('a,.p27-button,button');
      dot.classList.toggle('is-target', !!target && !target.closest('[data-no-magnetic]'));
    }, { passive: true });
    document.addEventListener('pointerleave', () => { dot.style.opacity = '0'; });
    document.addEventListener('pointerenter', () => { dot.style.opacity = '1'; });
    window.addEventListener('beforeunload', () => cancelAnimationFrame(raf), { once: true });
  }

  function initPageTransitions() {
    if (reduce || document.querySelector('.piq-page-transition')) return;
    const overlay = document.createElement('div');
    overlay.className = 'piq-page-transition';
    overlay.setAttribute('aria-hidden', 'true');
    document.body.appendChild(overlay);

    document.addEventListener('click', event => {
      const link = event.target.closest?.('a[href]');
      if (!link || link.target === '_blank' || link.hasAttribute('download')) return;
      if (link.origin !== location.origin || link.getAttribute('href').startsWith('#')) return;
      if (link.getAttribute('href').startsWith('mailto:') || link.getAttribute('href').startsWith('tel:')) return;
      overlay.classList.add('is-on');
      window.setTimeout(() => overlay.classList.remove('is-on'), 260);
    });
  }

  function init() {
    initSpecular();
    initSpotlight();
    initPixelSwap();
    initSignalSweep();
    initScrollExpand();
    initStepper();
    initPeekRating();
    initReveal();
    initIntelligenceCards();
    initMarketingHover();
    initDashboardHover();
    initHeadingGlow();
    initCursor();
    initPageTransitions();
    refreshThoughtLines();

    const observer = new MutationObserver(() => {
      initSpecular();
      initSpotlight();
      initSignalSweep();
      initPeekRating();
      initDashboardHover();
      refreshThoughtLines();
    });
    observer.observe(document.body, { subtree: true, childList: true });
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init, { once: true });
  else init();
})();
