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
  if (window.__xvmGrok) return;

  const ENDPOINT = 'https://grok.x.com/2/grok/add_response.json';
  const ENDPOINT_PATH = '/2/grok/add_response.json';
  const DEFAULT_BEARER = 'Bearer AAAAAAAAAAAAAAAAAAAAANRILgAAAAAAnNwIzUejRCOuH5E6I8xnZz4puTs%3D1Zv7ttfk8LF81IUq16cHjhLTvJu4FA33AGWWjCpTnA';
  const PLACEHOLDER = '[推文内容]';
  const DEFAULT_PROMPT = `${PLACEHOLDER}\n\n为我生成针对该推文的10条评论,每条评论用代码块包裹`;

  // Captured tx-id from a real X-UI request to add_response.json. Used as
  // fallback when our self-generated tx-id is rejected (404) — typically
  // because X redeployed their bundle and the open-source algorithm port
  // is briefly out of date. Captured tx-ids stay valid for 1+ hours, so a
  // single user-initiated /i/grok send unlocks generation for the session.
  let capturedTxId = null;

  if (window.__xvmNet) {
    // Our own outgoing calls bypass this hook (we send via __xvmNet.originalFetch)
    // so the only requests we see here are the ones X's bundle issues from
    // /i/grok — exactly the source of valid signatures.
    window.__xvmNet.onRequest(/\/2\/grok\/add_response\.json/, ({ headers }) => {
      const tx = headers && (headers['x-client-transaction-id'] || headers['X-Client-Transaction-Id']);
      if (typeof tx === 'string' && tx.length > 16 && tx !== capturedTxId) {
        capturedTxId = tx;
        try { window.postMessage({ type: 'XVM_GROK_CAPTURE_SET', txId: tx }, '*'); } catch (_) {}
        console.debug('[XVM-GROK] captured tx-id from X UI:', tx.slice(0, 24) + '…');
      }
    });
  }

  // Hydrate from storage when bridge replies with settings.
  window.addEventListener('message', (event) => {
    if (event.source !== window) return;
    if (event.data?.type !== 'XVM_GROK_SETTINGS_LOAD') return;
    const c = event.data.capturedTxId;
    if (c && typeof c.txId === 'string' && c.txId.length > 16) {
      capturedTxId = c.txId;
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
  function extractComments(rawText) {
    const text = String(rawText || '');
    const looksLikeNdjson = /^\s*[{[]/.test(text);
    const joined = looksLikeNdjson ? extractFinalText(text) : text;
    const codeBlocks = [];
    const blockRe = /```(?:[\w-]+)?\s*([\s\S]*?)```/g;
    let match;
    while ((match = blockRe.exec(joined))) {
      const comment = match[1].trim();
      if (comment) codeBlocks.push(comment);
    }
    if (codeBlocks.length) return Array.from(new Set(codeBlocks)).slice(0, 10);
    // Fallback: numbered / bulleted list. Only kicks in when the input
    // actually contains list markers — otherwise garbage strings would get
    // emitted as a single item. Long-form posts allowed (cap 1000).
    const itemMarkerRe = /^\s*(?:\d+[\).]|[-*])\s+/m;
    if (!itemMarkerRe.test(joined)) return [];
    return joined.split(/\n+(?=\s*(?:\d+[\).]|[-*])\s+)/)
      .map((s) => s.replace(/^\s*(?:\d+[\).]|[-*])\s+/, '').trim())
      .filter((s) => s.length >= 2 && s.length <= 1000 && !/^\s*\d+[\).]/.test(s))
      .slice(0, 10);
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
    if (pending.trim()) finalText += extractFinalText(pending);
    return finalText;
  }

  async function generate({ tweetText, promptTemplate, temporaryChat, onProgress }) {
    const prompt = renderPrompt(tweetText, promptTemplate);
    const body = buildBody(prompt, { temporaryChat });

    // Path 1: self-generated tx-id (zero user friction — works as long as our
    // algorithm port matches the live X bundle).
    let res = await send(body);
    let usedFallback = false;
    if (res.status === 404) {
      try { res.body?.cancel?.(); } catch (_) {}
      // Reset xct context once in case the cached animationKey is stale.
      window.__xvmXct?.reset();
      res = await send(body);
    }

    // Path 2: captured tx-id from a real X-UI request — used when self-gen
    // can't produce a valid signature (e.g. X redeployed and our algorithm
    // is briefly out of date).
    if (res.status === 404 && capturedTxId) {
      try { res.body?.cancel?.(); } catch (_) {}
      console.debug('[XVM-GROK] self-gen rejected, falling back to captured tx-id');
      res = await send(body, { useCapturedTxId: true });
      usedFallback = true;
    }

    if (!res.ok) {
      try { res.body?.cancel?.(); } catch (_) {}
      if (res.status === 404) {
        // Captured tx-id (if we had one) also got 404 — clear it so we don't
        // keep replaying a definitively-dead value.
        if (usedFallback) {
          capturedTxId = null;
          try { window.postMessage({ type: 'XVM_GROK_CAPTURE_CLEAR' }, '*'); } catch (_) {}
        }
        throw new Error(
          capturedTxId
            ? 'Grok 请求 404（X 反爬算法可能已更新，且捕获的签名也失效，请到 x.com/i/grok 重新发一条消息）'
            : 'Grok 请求 404（X 反爬算法可能已更新，请到 x.com/i/grok 随便发一条消息让插件抓个有效签名）'
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

  window.__xvmGrok = {
    ENDPOINT,
    DEFAULT_PROMPT,
    PLACEHOLDER,
    renderPrompt,
    extractComments,   // exported for tests
    extractFinalText,  // exported for tests
    generate,
  };
})();
