// Grok reply core API.
//
// Pure logic for talking to X's built-in Grok endpoint:
//   - prompt rendering (template + tweet text → final user message)
//   - request body assembly (matches X "快速" mode payload)
//   - request header assembly (depends on lib/x-client-transaction.js for tx-id
//     and lib/x-net-hook.js for the latest-seen Bearer token)
//   - response parsing (NDJSON stream → flat list of code-block comments)
//   - generate(): orchestrates send + 404 retry + extract
//
// No DOM access. content.js owns button injection, panel rendering, and reply
// editor manipulation; it calls window.__xvmGrok.generate(...) for the wire work.

(() => {
  const ENDPOINT = 'https://grok.x.com/2/grok/add_response.json';
  const ENDPOINT_PATH = '/2/grok/add_response.json';
  // Public web client bearer embedded verbatim in X's web bundle and stable
  // for years. Used only as fallback before net-hook captures the live one
  // off any outgoing X API call. Not a credential — replicate at will.
  const DEFAULT_BEARER = 'Bearer AAAAAAAAAAAAAAAAAAAAANRILgAAAAAAnNwIzUejRCOuH5E6I8xnZz4puTs%3D1Zv7ttfk8LF81IUq16cHjhLTvJu4FA33AGWWjCpTnA';
  const PLACEHOLDER = '[推文内容]';
  const DEFAULT_PROMPT = `${PLACEHOLDER}\n\n为我生成针对该推文的10条评论,每条评论用代码块包裹`;
  const TX_ID_MIN_LEN = 16;

  // Captured tx-id from a real X-UI request to add_response.json. Used as
  // fallback when our self-generated tx-id is rejected (404) — typically
  // because X redeployed their bundle and the open-source algorithm port
  // is briefly out of date. Captured tx-ids stay valid for 1+ hours, so a
  // single user-initiated /i/grok send unlocks generation for the session.
  //
  // On hot-reload we *re-register* the net-hook subscriber rather than
  // early-returning. The previous module instance's subscriber was wiped by
  // x-net-hook's _resetSubs, so without re-registering capture would silently
  // stop working until full page reload. We do preserve the previously-stored
  // capturedTxId across hot-reload by reading it off the old __xvmGrok.
  let capturedTxId = window.__xvmGrok?.__capturedTxId || null;

  if (window.__xvmNet) {
    // Our own outgoing calls bypass this hook (we send via __xvmNet.originalFetch)
    // so the only requests we see here are the ones X's bundle issues from
    // /i/grok — exactly the source of valid signatures.
    // x-net-hook normalizes header keys to lowercase before dispatching.
    window.__xvmNet.onRequest(/\/2\/grok\/add_response\.json/, ({ headers }) => {
      const tx = headers?.['x-client-transaction-id'];
      if (typeof tx === 'string' && tx.length > TX_ID_MIN_LEN && tx !== capturedTxId) {
        capturedTxId = tx;
        if (window.__xvmGrok) window.__xvmGrok.__capturedTxId = tx;
        try { window.postMessage({ type: 'XVM_GROK_CAPTURE_SET', txId: tx }, '*'); } catch (_) {}
        console.log('[XVM-GROK] captured tx-id from X UI:', tx.slice(0, 24) + '…');
      }
    });
  }

  // Hydrate from storage when bridge replies with settings. If we already
  // captured a fresher one in this session (race: X-bundle-fires-then-bridge-
  // replies), keep the fresh capture rather than letting stored history win.
  window.addEventListener('message', (event) => {
    if (event.source !== window) return;
    if (event.data?.type !== 'XVM_GROK_SETTINGS_LOAD') return;
    if (capturedTxId) return;
    const c = event.data.capturedTxId;
    if (c && typeof c.txId === 'string' && c.txId.length > TX_ID_MIN_LEN) {
      capturedTxId = c.txId;
      if (window.__xvmGrok) window.__xvmGrok.__capturedTxId = c.txId;
    }
  });

  function cookieValue(name) {
    const escaped = String(name).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const m = document.cookie.match(new RegExp(`(?:^|;\\s*)${escaped}=([^;]+)`));
    return m ? decodeURIComponent(m[1]) : '';
  }

  function makeConversationId() {
    try {
      const epoch = 1288834974657n;
      const ms = BigInt(Date.now()) - epoch;
      const rand = BigInt(Math.floor(Math.random() * 4194304));
      return String((ms << 22n) + rand);
    } catch (_) {
      return `${Date.now()}${Math.floor(Math.random() * 1000000).toString().padStart(6, '0')}`;
    }
  }

  function renderPrompt(tweetText, templateText) {
    const text = String(tweetText || '').trim();
    const tpl = String(templateText || DEFAULT_PROMPT).trim();
    return tpl.includes(PLACEHOLDER) ? tpl.split(PLACEHOLDER).join(text) : `${text}\n\n${tpl}`;
  }

  function buildBody(prompt, opts = {}) {
    // We only need text comments — disable search/citations/images/tweet
    // previews/server history to cut latency and avoid polluting the user's
    // Grok history (also gated by isTemporaryChat).
    return JSON.stringify({
      responses: [{ message: prompt, sender: 1, promptSource: '', fileAttachments: [] }],
      systemPromptName: '',
      grokModelOptionId: 'grok-3-latest',
      modelMode: 'MODEL_MODE_FAST',
      conversationId: makeConversationId(),
      returnSearchResults: false,
      returnCitations: false,
      promptMetadata: { promptSource: 'NATURAL', action: 'INPUT' },
      imageGenerationCount: 0,
      requestFeatures: { eagerTweets: false, serverHistory: false },
      enableSideBySide: true,
      toolOverrides: {},
      modelConfigOverride: {},
      isTemporaryChat: opts.temporaryChat !== false,
    });
  }

  async function buildHeaders({ useCapturedTxId = false } = {}) {
    let txId;
    if (useCapturedTxId) {
      if (!capturedTxId) {
        throw new Error('请打开 X 内置 Grok（x.com/i/grok）随便发一条消息，让插件抓到一个有效签名后再试。');
      }
      txId = capturedTxId;
    } else {
      if (!window.__xvmXct) {
        throw new Error('插件未正确加载（lib/x-client-transaction.js 缺失），请重载扩展');
      }
      try {
        txId = await window.__xvmXct.generateTxId('POST', ENDPOINT_PATH);
      } catch (e) {
        console.error('[XVM-GROK] tx-id context build failed:', e);
        throw new Error('X 反爬算法上下文初始化失败（可能 X 改了页面结构），详见 Console');
      }
    }
    return {
      authorization: window.__xvmNet?.getBearer() || DEFAULT_BEARER,
      'content-type': 'text/plain;charset=UTF-8',
      accept: '*/*',
      'x-csrf-token': cookieValue('ct0'),
      'x-twitter-active-user': 'yes',
      'x-twitter-auth-type': 'OAuth2Session',
      'x-twitter-client-language': navigator.language?.toLowerCase() || 'en',
      'x-xai-request-id': crypto.randomUUID(),
      'x-client-transaction-id': txId,
    };
  }

  // Pull final assistant chunks out of one or more NDJSON lines. Keeps state
  // for streaming consumers (concatenates 'final' messages as they arrive).
  function extractFinalText(rawText) {
    const chunks = [];
    const lines = String(rawText || '').split(/\r?\n/);
    for (const line of lines) {
      const t = line.trim();
      if (!t || !(t.startsWith('{') || t.startsWith('['))) continue;
      try {
        const payload = JSON.parse(t);
        const r = payload?.result || payload;
        if (r?.sender === 'ASSISTANT' && r?.messageTag === 'final' && typeof r.message === 'string') {
          chunks.push(r.message);
        }
      } catch (_) {}
    }
    return chunks.join('');
  }

  // Parses Grok output into a deduped list of comments. Accepts either:
  //   - the raw NDJSON response (each line a JSON object), or
  //   - already-concatenated final-message text.
  // If the input looks like NDJSON (starts with `{`), parse first; otherwise
  // treat as plain text. Garbage stays empty rather than getting falsely
  // emitted by the bullet-list fallback.
  //
  // Three extraction strategies, tried in order:
  //   1. Code blocks    — ```...```. The default prompt asks for this
  //                       format, so it's the most reliable.
  //   2. Numbered/bullet list — "1. xxx", "- xxx". Common when users write
  //                       custom prompts that don't ask for code blocks.
  //   3. Paragraph split — non-empty lines. Last-resort for free-form
  //                       prose responses; filters trailing prose like
  //                       "Here are 10 comments:" or sign-offs.
  function extractComments(rawText) {
    const text = String(rawText || '');
    const looksLikeNdjson = /^\s*[{[]/.test(text);
    const joined = looksLikeNdjson ? extractFinalText(text) : text;
    if (!joined.trim()) return [];

    const MIN_LEN = 2;
    const MAX_LEN = 1000;
    const dedupe = (arr) => Array.from(new Set(arr)).slice(0, 10);

    // 1. Code blocks (default prompt format).
    const codeBlocks = [];
    const blockRe = /```(?:[\w-]+)?\s*([\s\S]*?)```/g;
    let match;
    while ((match = blockRe.exec(joined))) {
      const c = match[1].trim();
      if (c) codeBlocks.push(c);
    }
    if (codeBlocks.length) return dedupe(codeBlocks);

    // 2. Numbered/bullet list (common alternate prompt format).
    const itemMarkerRe = /^\s*(?:\d+[\).]|[-*])\s+/m;
    if (itemMarkerRe.test(joined)) {
      const items = joined.split(/\n+(?=\s*(?:\d+[\).]|[-*])\s+)/)
        .map((s) => s.replace(/^\s*(?:\d+[\).]|[-*])\s+/, '').trim())
        .filter((s) => s.length >= MIN_LEN && s.length <= MAX_LEN);
      if (items.length) return dedupe(items);
    }

    // 3. Paragraph fallback — split by blank lines or single lines, whichever
    // yields more units. Only emits if there are at least 3 distinct items;
    // shorter outputs are usually error/header text rather than a real list of
    // candidates, and emitting them would be a false positive (compare:
    // "garbage\nmore garbage" should NOT yield 2 candidates).
    const FALLBACK_MIN_ITEMS = 3;
    const SHORT_TAIL_LEN = 12;
    const paragraphs = joined.split(/\n{2,}/).map((p) => p.trim()).filter(Boolean);
    const lines = joined.split(/\n+/).map((s) => s.trim()).filter(Boolean);
    let units = paragraphs.length >= FALLBACK_MIN_ITEMS ? paragraphs : lines;
    units = units.filter((s, i, all) =>
      s.length >= MIN_LEN
      && s.length <= MAX_LEN
      && !(i === all.length - 1 && s.length <= SHORT_TAIL_LEN)
    );
    if (units.length < FALLBACK_MIN_ITEMS) return [];
    return dedupe(units);
  }

  // Use the unhooked native fetch so our own request isn't fed back into the
  // net-hook subscribers (it isn't matched by any of them today, but defensive).
  const sendFetch = window.__xvmNet?.originalFetch || window.fetch;

  async function send(body, opts) {
    const headers = await buildHeaders(opts);
    return sendFetch(ENDPOINT, { method: 'POST', headers, body, credentials: 'include' });
  }

  // Streaming reader: yields the accumulated 'final' text every time a new
  // chunk arrives. onProgress receives both the running text and the running
  // comment list parsed from it, so the UI can render candidates as soon as
  // they show up instead of waiting for the entire stream to complete.
  async function readStream(res, onProgress) {
    if (!res.body || !res.body.getReader) return await res.text();
    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let pending = '';
    let finalText = '';
    let lastCommentCount = 0;
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      pending += decoder.decode(value, { stream: true });
      // Keep an incomplete trailing line in the buffer for the next chunk.
      const nl = pending.lastIndexOf('\n');
      if (nl < 0) continue;
      const ready = pending.slice(0, nl);
      pending = pending.slice(nl + 1);
      const newFinal = extractFinalText(ready);
      if (!newFinal) continue;
      finalText += newFinal;
      if (typeof onProgress === 'function') {
        const running = extractComments(finalText);
        if (running.length !== lastCommentCount) {
          lastCommentCount = running.length;
          try { onProgress(running, finalText); } catch (_) {}
        }
      }
    }
    if (pending.trim()) {
      const tail = extractFinalText(pending);
      if (tail) {
        finalText += tail;
        if (typeof onProgress === 'function') {
          const running = extractComments(finalText);
          if (running.length !== lastCommentCount) {
            try { onProgress(running, finalText); } catch (_) {}
          }
        }
      }
    }
    return finalText;
  }

  async function generate({ tweetText, promptTemplate, temporaryChat, onProgress }) {
    const prompt = renderPrompt(tweetText, promptTemplate);
    const body = buildBody(prompt, { temporaryChat });

    let res = null;
    let usedFallback = false;

    // Path 1: self-generated tx-id. Wrapped in try/catch because xct's
    // build() can throw outright when X mutates the home page structure
    // beyond our regex coverage — in which case we still want to try the
    // captured fallback rather than failing hard.
    try {
      res = await send(body);
      if (res.status === 404) {
        try { res.body?.cancel?.(); } catch (_) {}
        // Reset xct context once in case the cached animationKey is stale.
        window.__xvmXct?.reset();
        res = await send(body);
      }
    } catch (selfGenErr) {
      console.debug('[XVM-GROK] self-gen path errored:', selfGenErr?.message || selfGenErr);
      res = null;
    }

    // Path 2: captured tx-id from a real X-UI request. Used when self-gen
    // produces a 404 (signature rejected) or when self-gen threw before the
    // network call could happen at all (e.g. xct context build failure).
    const selfGenFailed = !res || res.status === 404;
    if (selfGenFailed && capturedTxId) {
      if (res) { try { res.body?.cancel?.(); } catch (_) {} }
      console.debug('[XVM-GROK] self-gen failed, falling back to captured tx-id');
      res = await send(body, { useCapturedTxId: true });
      usedFallback = true;
    }

    // No response at all? (self-gen threw and no captured to fall back to.)
    if (!res) {
      throw new Error('请打开 X 内置 Grok（x.com/i/grok）随便发一条消息，让插件抓到一个有效签名后再试。');
    }

    if (!res.ok) {
      try { res.body?.cancel?.(); } catch (_) {}
      if (res.status === 404) {
        // Snapshot captured state BEFORE clearing so the error message can
        // distinguish "had one, it died" from "never had one".
        const hadCaptured = !!capturedTxId;
        if (usedFallback) {
          // Captured tx-id is now confirmed dead — invalidate so a fresh
          // X-UI send replaces it instead of replaying the same one.
          capturedTxId = null;
          if (window.__xvmGrok) window.__xvmGrok.__capturedTxId = null;
          try { window.postMessage({ type: 'XVM_GROK_CAPTURE_CLEAR' }, '*'); } catch (_) {}
        }
        throw new Error(
          hadCaptured && usedFallback
            ? 'Grok 请求 404（捕获的签名也失效，请到 x.com/i/grok 重新发一条消息）'
            : 'Grok 请求 404（请到 x.com/i/grok 随便发一条消息让插件抓个有效签名）'
        );
      }
      throw new Error(`Grok 请求失败：${res.status} ${res.statusText || ''}`.trim());
    }
    if (usedFallback) console.debug('[XVM-GROK] using captured tx-id (self-gen path failed)');

    const finalText = await readStream(res, onProgress);
    const comments = extractComments(finalText);
    if (!comments.length) throw new Error('Grok 返回中没有解析到评论代码块');
    return comments;
  }

  // Replace the global. On hot-reload we keep __capturedTxId off the old
  // instance via the read at the top of this IIFE.
  window.__xvmGrok = {
    ENDPOINT,
    DEFAULT_PROMPT,
    PLACEHOLDER,
    renderPrompt,
    extractComments,   // exported for tests
    extractFinalText,  // exported for tests
    generate,
    // Internal — exposed only so a fresh module instance after hot-reload
    // can recover the in-memory capture without waiting for storage hydration.
    __capturedTxId: capturedTxId,
  };
})();
