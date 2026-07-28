/* Annapurna Color UI, additive only */
(() => {
  'use strict';
  const $ = (selector, root = document) => root.querySelector(selector);
  const $$ = (selector, root = document) => [...root.querySelectorAll(selector)];

  function announce(message, kind = 'info') {
    let live = $('#color-ui-live');
    if (!live) {
      live = document.createElement('div');
      live.id = 'color-ui-live';
      live.setAttribute('aria-live', 'polite');
      live.setAttribute('aria-atomic', 'true');
      Object.assign(live.style, { position:'fixed', width:'1px', height:'1px', padding:'0', margin:'-1px', overflow:'hidden', clip:'rect(0,0,0,0)', whiteSpace:'nowrap', border:'0' });
      document.body.appendChild(live);
    }
    live.textContent = message;
    const toast = $('#toast');
    if (toast) {
      toast.textContent = message;
      toast.classList.add('show');
      toast.dataset.kind = kind;
      clearTimeout(window.__colorUiToast);
      window.__colorUiToast = setTimeout(() => toast.classList.remove('show'), 2800);
    }
  }

  // Add labels to existing icon-only controls, preserving their current event handlers.
  const labels = {
    '.cart-btn': 'Open shopping cart', '#cart-btn': 'Open shopping cart',
    '.theme-btn': 'Toggle appearance', '#theme-btn': 'Toggle appearance',
    '.refresh-btn': 'Refresh dashboard', '#refresh-kitchens-btn': 'Refresh kitchens',
    '#logout-btn': 'Log out', '.close': 'Close', '.back-btn': 'Go back',
    '#geolocate-btn': 'Use my current location'
  };
  Object.entries(labels).forEach(([selector, label]) => $$(selector).forEach(el => { if (!el.getAttribute('aria-label')) el.setAttribute('aria-label', label); }));

  // Better disabled/loading feedback without touching API logic.
  $$('form').forEach(form => {
    form.addEventListener('submit', () => {
      const submit = $('button[type="submit"], button.primary, .btn', form);
      if (!submit || submit.dataset.colorBusy === 'true') return;
      submit.dataset.colorBusy = 'true';
      submit.setAttribute('aria-busy', 'true');
      submit.classList.add('is-loading');
      setTimeout(() => { submit.dataset.colorBusy = 'false'; submit.removeAttribute('aria-busy'); submit.classList.remove('is-loading'); }, 8000);
    });
  });

  // OTP auto-advance, backspace navigation, and paste support.
  const otpBoxes = $$('.otp-boxes input, input[data-otp]');
  otpBoxes.forEach((box, index) => {
    box.inputMode = 'numeric';
    box.maxLength = 1;
    box.addEventListener('input', event => {
      event.target.value = event.target.value.replace(/\D/g, '').slice(-1);
      if (event.target.value && otpBoxes[index + 1]) otpBoxes[index + 1].focus();
    });
    box.addEventListener('keydown', event => {
      if (event.key === 'Backspace' && !box.value && otpBoxes[index - 1]) otpBoxes[index - 1].focus();
      if (event.key === 'ArrowLeft' && otpBoxes[index - 1]) otpBoxes[index - 1].focus();
      if (event.key === 'ArrowRight' && otpBoxes[index + 1]) otpBoxes[index + 1].focus();
    });
    box.addEventListener('paste', event => {
      const code = (event.clipboardData || window.clipboardData).getData('text').replace(/\D/g, '').slice(0, otpBoxes.length);
      if (!code) return;
      event.preventDefault();
      otpBoxes.forEach((item, i) => { item.value = code[i] || ''; });
      otpBoxes[Math.min(code.length, otpBoxes.length) - 1]?.focus();
      announce('Verification code pasted');
    });
  });

  // Offline feedback only. Existing network behavior stays untouched.
  function networkState() {
    let banner = $('#color-ui-offline');
    if (navigator.onLine) { banner?.remove(); return; }
    if (!banner) {
      banner = document.createElement('div');
      banner.id = 'color-ui-offline';
      banner.className = 'v3-color-offline';
      banner.textContent = 'You are offline. Saved screens still work.';
      document.body.appendChild(banner);
    }
  }
  window.addEventListener('online', () => { announce('Connection restored'); networkState(); });
  window.addEventListener('offline', networkState);
  networkState();

  // Expose a tiny helper for existing inline scripts, without replacing globals.
  window.AnnapurnaColorUI = { announce, version: '1.0.0' };
})();