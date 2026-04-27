// Velocity Monitor — Thank-You Star Chart
// Runs in MAIN world alongside content.js. Exposes window.__XVMStarChart.
(function () {
  'use strict';

  // === Defaults ===
  // These are placeholder values. Real values get learned at runtime via
  // content.js's recordStarChartTemplate (Task 3) which writes
  // chrome.storage.local.xvmStarChartTemplate_<OpName>. If both placeholders
  // and cache are missing, getTemplate returns the placeholder and the
  // caller (Task 5 onward) surfaces an error to the user telling them to
  // organically view a Retweets/Search page once.
  const DEFAULT_TEMPLATES = {
    Retweeters: {
      queryId: 'REPLACE_AT_RUNTIME',
      features: '{}',
      authorization: '',
    },
    SearchTimeline: {
      queryId: 'REPLACE_AT_RUNTIME',
      features: '{}',
      authorization: '',
    },
  };

  const PAGE_LIMIT = 100;
  const MAX_USERS = 50000;
  const __XVM_DEBUG = true;  // flipped to false in Task 10

  let cachedTemplates = null;

  // Asks bridge.js to read both per-op storage keys and posts back as
  // XVM_SC_TEMPLATES_LOAD with shape { Retweeters: {...}, SearchTimeline: {...} }.
  function loadTemplatesFromStorage() {
    return new Promise((resolve) => {
      const onMsg = (ev) => {
        if (ev.source !== window || ev.data?.type !== 'XVM_SC_TEMPLATES_LOAD') return;
        window.removeEventListener('message', onMsg);
        cachedTemplates = ev.data.templates || {};
        resolve(cachedTemplates);
      };
      window.addEventListener('message', onMsg);
      window.postMessage({ type: 'XVM_SC_TEMPLATES_REQUEST' }, '*');
      // Fail-open after 1s if bridge doesn't respond
      setTimeout(() => {
        window.removeEventListener('message', onMsg);
        if (!cachedTemplates) cachedTemplates = {};
        resolve(cachedTemplates);
      }, 1000);
    });
  }

  function getTemplate(op) {
    const cached = cachedTemplates?.[op];
    const def = DEFAULT_TEMPLATES[op] || {};
    return {
      queryId: cached?.queryId || def.queryId,
      features: cached?.features || def.features,
      authorization: cached?.authorization || def.authorization,
    };
  }

  function getCsrfToken() {
    const m = document.cookie.match(/(?:^|;\s*)ct0=([^;]+)/);
    return m ? decodeURIComponent(m[1]) : '';
  }

  // Stub — implemented in Task 6
  async function openStarChart(tweetCtx) {
    await loadTemplatesFromStorage();
    console.log('[starchart] open() called', tweetCtx, getTemplate('Retweeters'));
  }

  window.__XVMStarChart = {
    open: openStarChart,
    _internal: { getTemplate, loadTemplatesFromStorage, getCsrfToken },
  };

  if (__XVM_DEBUG) {
    window.__XVMStarChart._internal.DEFAULT_TEMPLATES = DEFAULT_TEMPLATES;
  }
})();
