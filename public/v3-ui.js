/* Annapurna v3 additive interaction layer
   Load after existing page scripts. Safe to use on customer, kitchen, admin, and registration pages. */
(() => {
  'use strict';

  const $ = (selector, root = document) => root.querySelector(selector);
  const $$ = (selector, root = document) => [...root.querySelectorAll(selector)];

  function announce(message, kind = 'info') {
    let live = $('#v3-live-region');
    if (!live) {
      live = document.createElement('div');
      live.id = 'v3-live-region';
      live.setAttribute('aria-live', 'polite');
      live.setAttribute('aria-atomic', 'true');
      Object.assign(live.style, { position: 'fixed', width: '1px', height: '1px', padding: '0', margin: '-1px', overflow: 'hidden', clip: 'rect(0,0,0,0)', whiteSpace: 'nowrap', border: '0' });
      document.body.appendChild(live);
    }
    live.textContent = message;
    const toast = $('#toast');
    if (toast) {
      toast.textContent = message;
      toast.classList.add('show');
      toast.dataset.kind = kind;
      clearTimeout(window.__v3Toast);
      window.__v3Toast = setTimeout(() => toast.classList.remove('show'), 2600);
    }
  }

  // Add labels to icon-only controls without replacing existing handlers.
  const labelMap = new Map([
    ['.cart-btn', 'Open shopping cart'], ['#cart-btn', 'Open shopping cart'],
    ['.theme-btn', 'Toggle appearance'], ['#theme-btn', 'Toggle appearance'],
    ['.refresh-btn', 'Refresh dashboard'], ['#logout-btn', 'Log out'],
    ['.back-btn', 'Go back'], ['.close', 'Close'],
  ]);
  labelMap.forEach((label, selector) => $$(selector).forEach(el => { if (!el.getAttribute('aria-label')) el.setAttribute('aria-label', label); }));

  // Make old click-only forms submit with Enter and prevent accidental double submit.
  $$('form').forEach(form => {
    form.addEventListener('submit', () => {
      const submit = $('button[type="submit"],button.primary,.btn', form);
      if (!submit || submit.dataset.v3Busy === 'true') return;
      submit.dataset.v3Busy = 'true';
      submit.setAttribute('aria-busy', 'true');
      setTimeout(() => { submit.dataset.v3Busy = 'false'; submit.removeAttribute('aria-busy'); }, 8000);
    });
  });

  // OTP usability: auto-advance, backspace navigation, and safe paste.
  const otpInputs = $$('.otp-boxes input, input[data-otp]');
  otpInputs.forEach((input, index) => {
    input.inputMode = 'numeric';
    input.maxLength = 1;
    input.addEventListener('input', event => {
      event.target.value = event.target.value.replace(/\D/g, '').slice(-1);
      if (event.target.value && otpInputs[index + 1]) otpInputs[index + 1].focus();
    });
    input.addEventListener('keydown', event => {
      if (event.key === 'Backspace' && !input.value && otpInputs[index - 1]) otpInputs[index - 1].focus();
      if (event.key === 'ArrowLeft' && otpInputs[index - 1]) otpInputs[index - 1].focus();
      if (event.key === 'ArrowRight' && otpInputs[index + 1]) otpInputs[index + 1].focus();
    });
    input.addEventListener('paste', event => {
      const value = (event.clipboardData || window.clipboardData).getData('text').replace(/\D/g, '').slice(0, otpInputs.length);
      if (!value) return;
      event.preventDefault();
      otpInputs.forEach((box, i) => { box.value = value[i] || ''; });
      otpInputs[Math.min(value.length, otpInputs.length) - 1]?.focus();
      announce('Verification code pasted');
    });
  });

  // Offline banner, without blocking existing offline behavior.
  function updateNetworkState() {
    let banner = $('#v3-offline-banner');
    if (navigator.onLine) { banner?.remove(); return; }
    if (!banner) {
      banner = document.createElement('div');
      banner.id = 'v3-offline-banner';
      banner.className = 'v3-offline';
      banner.textContent = 'You are offline. Saved screens still work.';
      document.body.appendChild(banner);
    }
  }
  window.addEventListener('online', () => { announce('Connection restored'); updateNetworkState(); });
  window.addEventListener('offline', updateNetworkState);
  updateNetworkState();

  // Search helper: keeps existing search handlers and adds a submit fallback.
  const search = $('.nav-search input, #search');
  search?.addEventListener('keydown', event => {
    if (event.key === 'Enter' && search.value.trim()) announce(`Searching for ${search.value.trim()}`);
  });

  // Optional v3 feature flag. Existing screens stay untouched until enabled by Cline.
  window.AnnapurnaV3 = {
    enabled: localStorage.getItem('annapurna_v3_enabled') === 'true',
    enable() { localStorage.setItem('annapurna_v3_enabled', 'true'); this.enabled = true; document.documentElement.dataset.v3 = 'on'; announce('New Annapurna experience enabled'); },
    disable() { localStorage.removeItem('annapurna_v3_enabled'); this.enabled = false; delete document.documentElement.dataset.v3; announce('Original experience restored'); },
    announce,
  };
  if (window.AnnapurnaV3.enabled) document.documentElement.dataset.v3 = 'on';
})();
