/* Retired. Consolidated into /annapurna-ui.js.
   Kept as a loader so any <script> tag still pointing here keeps working. */
(() => {
  'use strict';
  if (window.__annapurnaUIRequested) return;
  window.__annapurnaUIRequested = true;

  const script = document.createElement('script');
  script.src = '/annapurna-ui.js';
  script.async = false;
  document.head.appendChild(script);
})();
