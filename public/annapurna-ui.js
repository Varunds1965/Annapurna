/* ──────────────────────────────────────────────────────────────────────────
   Annapurna UI layer — single additive behaviour script

   Replaces public/color-ui.js and public/v3-ui.js, which both ran on every
   page and did the same work twice: two sets of aria-labels, two form
   submit listeners, two OTP handlers on the same inputs, two toast timers
   racing each other, and two offline banners stacked in the same corner.

   Touches no API call, no auth token, no payment flow, and no page logic.
   ────────────────────────────────────────────────────────────────────────── */
(() => {
  'use strict';

  if (window.AnnapurnaUI) return; // hard guard against double execution

  const $ = (selector, root = document) => root.querySelector(selector);
  const $$ = (selector, root = document) => [...root.querySelectorAll(selector)];

  const ready = (fn) => (document.readyState === 'loading'
    ? document.addEventListener('DOMContentLoaded', fn, { once: true })
    : fn());

  const ESCAPES = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };

  /**
   * Escape a value for safe interpolation into innerHTML.
   * Use this anywhere server data reaches a template literal.
   */
  const escape = (value) => String(value ?? '').replace(/[&<>"']/g, (char) => ESCAPES[char]);

  /** Strip anything that isn't safe inside a class attribute. */
  const slug = (value) => String(value ?? '').toLowerCase().replace(/[^a-z0-9_-]/g, '');

  /** Announce to screen readers, and mirror into #toast when a page has one. */
  function announce(message, kind = 'info') {
    let live = $('#au-live-region');
    if (!live) {
      live = document.createElement('div');
      live.id = 'au-live-region';
      live.setAttribute('aria-live', 'polite');
      live.setAttribute('aria-atomic', 'true');
      Object.assign(live.style, {
        position: 'fixed', width: '1px', height: '1px', padding: '0',
        margin: '-1px', overflow: 'hidden', clip: 'rect(0,0,0,0)',
        whiteSpace: 'nowrap', border: '0',
      });
      document.body.appendChild(live);
    }
    live.textContent = message;

    const toast = $('#toast');
    if (toast) {
      toast.textContent = message;
      toast.classList.add('show');
      toast.dataset.kind = kind;
      clearTimeout(window.__auToastTimer);
      window.__auToastTimer = setTimeout(() => toast.classList.remove('show'), 2800);
    }
  }

  ready(() => {
    // ── Labels for icon-only controls ──────────────────────────────────
    const labels = {
      '.cart-btn': 'Open shopping cart',
      '#cart-btn': 'Open shopping cart',
      '.theme-btn': 'Toggle appearance',
      '#theme-btn': 'Toggle appearance',
      '.refresh-btn': 'Refresh',
      '#refresh-kitchens-btn': 'Refresh kitchens',
      '#logout-btn': 'Log out',
      '#geolocate-btn': 'Use my current location',
      '.back-btn': 'Go back',
      '.close': 'Close',
    };

    Object.entries(labels).forEach(([selector, label]) => {
      $$(selector).forEach((el) => {
        if (!el.getAttribute('aria-label') && !el.textContent.trim()) {
          el.setAttribute('aria-label', label);
        }
      });
    });

    // ── Double-submit protection ───────────────────────────────────────
    // Marks the submit control busy for 8s. Purely a UI guard; it does not
    // cancel or retry the request the page already makes.
    $$('form').forEach((form) => {
      form.addEventListener('submit', () => {
        const submit = $('button[type="submit"], button.primary, .btn', form);
        if (!submit || submit.getAttribute('aria-busy') === 'true') return;
        submit.setAttribute('aria-busy', 'true');
        setTimeout(() => submit.removeAttribute('aria-busy'), 8000);
      });
    });

    // ── OTP inputs: auto-advance, backspace, arrows, paste ─────────────
    const otpInputs = $$('.otp-boxes input, input[data-otp]')
      .filter((input) => !input.dataset.auOtpBound);

    otpInputs.forEach((input, index) => {
      input.dataset.auOtpBound = 'true';
      input.inputMode = 'numeric';
      input.autocomplete = index === 0 ? 'one-time-code' : 'off';
      input.maxLength = 1;

      input.addEventListener('input', (event) => {
        event.target.value = event.target.value.replace(/\D/g, '').slice(-1);
        if (event.target.value && otpInputs[index + 1]) otpInputs[index + 1].focus();
      });

      input.addEventListener('keydown', (event) => {
        if (event.key === 'Backspace' && !input.value && otpInputs[index - 1]) otpInputs[index - 1].focus();
        if (event.key === 'ArrowLeft' && otpInputs[index - 1]) otpInputs[index - 1].focus();
        if (event.key === 'ArrowRight' && otpInputs[index + 1]) otpInputs[index + 1].focus();
      });

      input.addEventListener('paste', (event) => {
        const code = (event.clipboardData || window.clipboardData)
          .getData('text').replace(/\D/g, '').slice(0, otpInputs.length);
        if (!code) return;
        event.preventDefault();
        otpInputs.forEach((box, i) => { box.value = code[i] || ''; });
        otpInputs[Math.min(code.length, otpInputs.length) - 1]?.focus();
        announce('Verification code pasted');
      });
    });

    // ── Offline pill. Exactly one, ever. ───────────────────────────────
    function renderNetworkState() {
      const existing = $('#au-offline-banner');
      if (navigator.onLine) { existing?.remove(); return; }
      if (existing) return;

      const banner = document.createElement('div');
      banner.id = 'au-offline-banner';
      banner.className = 'au-offline';
      banner.setAttribute('role', 'status');
      banner.textContent = 'You are offline. Saved screens still work.';
      document.body.appendChild(banner);
    }

    window.addEventListener('online', () => { announce('Connection restored'); renderNetworkState(); });
    window.addEventListener('offline', renderNetworkState);
    renderNetworkState();
  });

  window.AnnapurnaUI = { escape, slug, announce, version: '2.0.0' };

  // Back-compat: the two retired packs exposed these globals.
  window.AnnapurnaV3 = window.AnnapurnaUI;
  window.AnnapurnaColorUI = window.AnnapurnaUI;
})();
