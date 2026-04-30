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
    return JSON.stringify({
      responses: [{ message: prompt, sender: 1, promptSource: '', fileAttachments: [] }],
      systemPromptName: '',
      grokModelOptionId: 'grok-3-latest',
      modelMode: 'MODEL_MODE_FAST',
      conversationId: makeConversationId(),
      returnSearchResults: true,
      returnCitations: true,
      promptMetadata: { promptSource: 'NATURAL', action: 'INPUT' },
      imageGenerationCount: 4,
      requestFeatures: { eagerTweets: true, serverHistory: true },
      enableSideBySide: true,
      toolOverrides: {},
      modelConfigOverride: {},
      isTemporaryChat: opts.temporaryChat !== false,
    });
  }

  async function buildHeaders() {
    if (!window.__xvmXct) {
      throw new Error('插件未正确加载（lib/x-client-transaction.js 缺失），请重载扩展');
    }
    let txId;
    try {
      txId = await window.__xvmXct.generateTxId('POST', ENDPOINT_PATH);
    } catch (e) {
      console.error('[XVM-GROK] tx-id context build failed:', e);
      throw new Error('X 反爬算法上下文初始化失败（可能 X 改了页面结构），详见 Console');
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

  // Parses Grok's NDJSON response stream into a deduped list of comments.
  function extractComments(rawText) {
    const chunks = [];
    const codeBlocks = [];
    const lines = String(rawText || '').split(/\r?\n/);
    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed) continue;
      const data = trimmed.startsWith('data:') ? trimmed.slice(5).trim() : trimmed;
      if (!data || data === '[DONE]') continue;
      if (data.startsWith('{') || data.startsWith('[')) {
        try {
          const payload = JSON.parse(data);
          const result = payload?.result || payload;
          if (result?.sender === 'ASSISTANT' && result?.messageTag === 'final' && typeof result.message === 'string') {
            chunks.push(result.message);
          }
        } catch (_) {}
      }
    }
    const joined = chunks.join('');
    const blockRe = /```(?:[\w-]+)?\s*([\s\S]*?)```/g;
    let match;
    while ((match = blockRe.exec(joined))) {
      const comment = match[1].trim();
      if (comment) codeBlocks.push(comment);
    }
    if (!codeBlocks.length) {
      // Fallback: numbered / bulleted list. Cap each item to a tweet-length range.
      return joined.split(/\n+(?=\s*(?:\d+[\).]|[-*])\s+)/)
        .map((s) => s.replace(/^\s*(?:\d+[\).]|[-*])\s+/, '').trim())
        .filter((s) => s.length >= 2 && s.length <= 280)
        .slice(0, 10);
    }
    return Array.from(new Set(codeBlocks)).slice(0, 10);
  }

  // Use the unhooked native fetch so our own request isn't fed back into the
  // net-hook subscribers (it isn't matched by any of them today, but defensive).
  const sendFetch = window.__xvmNet?.originalFetch || window.fetch;

  async function send(body) {
    const headers = await buildHeaders();
    return sendFetch(ENDPOINT, { method: 'POST', headers, body, credentials: 'include' });
  }

  async function generate({ tweetText, promptTemplate, temporaryChat }) {
    const prompt = renderPrompt(tweetText, promptTemplate);
    const body = buildBody(prompt, { temporaryChat });

    let res = await send(body);
    // 404 = tx-id signature rejected (usually X rotated the on-demand chunk
    // hash or our cached animationKey aged out). Reset ctx and retry once.
    if (res.status === 404) {
      try { res.body?.cancel?.(); } catch (_) {}
      window.__xvmXct?.reset();
      res = await send(body);
    }
    const text = await res.text();
    if (!res.ok) {
      throw new Error(`Grok 请求失败：${res.status} ${res.statusText || ''}`.trim());
    }
    const comments = extractComments(text);
    if (!comments.length) throw new Error('Grok 返回中没有解析到评论代码块');
    return comments;
  }

  window.__xvmGrok = {
    ENDPOINT,
    DEFAULT_PROMPT,
    PLACEHOLDER,
    renderPrompt,
    extractComments, // exported for tests
    generate,
  };
})();
