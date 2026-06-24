const PLACEHOLDER = '[推文内容]';
const DEFAULT_PROVIDER = 'x-grok';
const DEFAULT_PLATFORM = 'openai';
const DEFAULT_REPLY_COUNT = 10;
const LICENSE_PROXY_URL = 'https://xvm-license.lengkuxiaomao.workers.dev';
const LICENSE_PROXY_ACTIONS = new Set(['activate', 'validate', 'deactivate']);

const OPENAI_COMPAT_PLATFORMS = {
  openai: {
    label: 'OpenAI',
    baseUrl: 'https://api.openai.com/v1',
    model: 'gpt-4o-mini',
  },
  deepseek: {
    label: 'DeepSeek',
    baseUrl: 'https://api.deepseek.com',
    model: 'deepseek-chat',
  },
  openrouter: {
    label: 'OpenRouter',
    baseUrl: 'https://openrouter.ai/api/v1',
    model: 'openai/gpt-4o-mini',
  },
  kimi: {
    label: 'Kimi / Moonshot',
    baseUrl: 'https://api.moonshot.ai/v1',
    model: 'moonshot-v1-8k',
  },
  qwen: {
    label: 'Qwen / DashScope',
    baseUrl: 'https://dashscope.aliyuncs.com/compatible-mode/v1',
    model: 'qwen-plus',
  },
  siliconflow: {
    label: 'SiliconFlow',
    baseUrl: 'https://api.siliconflow.cn/v1',
    model: 'Pro/zai-org/GLM-4.7',
  },
  lmstudio: {
    label: 'LM Studio',
    baseUrl: 'http://localhost:1234/v1',
    model: 'local-model',
    local: true,
  },
  ollamaOpenAI: {
    label: 'Ollama (OpenAI compatible)',
    baseUrl: 'http://localhost:11434/v1',
    model: 'llama3.1',
    local: true,
  },
};

const ALLOWED_OPENAI_PREFIXES = [
  'https://api.openai.com/v1',
  'https://api.deepseek.com',
  'https://openrouter.ai/api/v1',
  'https://api.moonshot.ai/v1',
  'https://api.moonshot.cn/v1',
  'https://dashscope.aliyuncs.com/compatible-mode/v1',
  'https://dashscope-intl.aliyuncs.com/compatible-mode/v1',
  'https://dashscope-us.aliyuncs.com/compatible-mode/v1',
  'https://cn-hongkong.dashscope.aliyuncs.com/compatible-mode/v1',
  'https://api.siliconflow.cn/v1',
  'https://api.siliconflow.com/v1',
  'http://localhost:1234/v1',
  'http://127.0.0.1:1234/v1',
  'http://localhost:11434/v1',
  'http://127.0.0.1:11434/v1',
];

const SYNC_DEFAULTS = {
  aiProvider: DEFAULT_PROVIDER,
  aiOpenAIPlatform: DEFAULT_PLATFORM,
  aiBaseUrl: OPENAI_COMPAT_PLATFORMS[DEFAULT_PLATFORM].baseUrl,
  aiModel: OPENAI_COMPAT_PLATFORMS[DEFAULT_PLATFORM].model,
  aiReplyCount: DEFAULT_REPLY_COUNT,
  aiLanguage: 'auto',
};
const LOCAL_DEFAULTS = { xvmAiApiKey: '' };

function trimTrailingSlash(value) {
  return String(value || '').trim().replace(/\/+$/, '');
}

function normalizeProvider(value) {
  return ['x-grok', 'ollama', 'openai-compatible'].includes(value) ? value : DEFAULT_PROVIDER;
}

function normalizeReplyCount(value) {
  const n = Number.parseInt(value, 10);
  if (!Number.isFinite(n)) return DEFAULT_REPLY_COUNT;
  return Math.max(1, Math.min(20, n));
}

function getPlatformPreset(platform) {
  return OPENAI_COMPAT_PLATFORMS[platform] || OPENAI_COMPAT_PLATFORMS[DEFAULT_PLATFORM];
}

function normalizeConfig(syncItems, localItems = {}) {
  const provider = normalizeProvider(syncItems?.aiProvider);
  const platform = OPENAI_COMPAT_PLATFORMS[syncItems?.aiOpenAIPlatform]
    ? syncItems.aiOpenAIPlatform
    : DEFAULT_PLATFORM;
  const preset = getPlatformPreset(platform);
  const baseUrl = trimTrailingSlash(syncItems?.aiBaseUrl || preset.baseUrl);
  const model = String(syncItems?.aiModel || preset.model || '').trim();
  return {
    provider,
    platform,
    baseUrl,
    model,
    replyCount: normalizeReplyCount(syncItems?.aiReplyCount),
    language: ['auto', 'zh_CN', 'en', 'ja'].includes(syncItems?.aiLanguage) ? syncItems.aiLanguage : 'auto',
    apiKey: String(localItems?.xvmAiApiKey || '').trim(),
  };
}

function isLocalHttpUrl(baseUrl) {
  try {
    const url = new URL(baseUrl);
    return url.protocol === 'http:'
      && ['localhost', '127.0.0.1'].includes(url.hostname);
  } catch (_) {
    return false;
  }
}

function assertAllowedOpenAIBaseUrl(baseUrl) {
  const normalized = trimTrailingSlash(baseUrl);
  if (ALLOWED_OPENAI_PREFIXES.some((prefix) => normalized === prefix || normalized.startsWith(`${prefix}/`))) {
    return normalized;
  }
  if (isLocalHttpUrl(normalized) && normalized.endsWith('/v1')) return normalized;
  throw new Error('暂不支持这个 Base URL。请使用内置平台预设，或本地 OpenAI-compatible 地址（localhost/127.0.0.1）。');
}

function assertAllowedOllamaBaseUrl(baseUrl) {
  const normalized = trimTrailingSlash(baseUrl || 'http://localhost:11434');
  if (!isLocalHttpUrl(normalized)) {
    throw new Error('Ollama Base URL 仅支持本机地址 localhost / 127.0.0.1。');
  }
  return normalized.replace(/\/v1$/, '');
}

function renderPrompt(tweetText, templateText, replyCount) {
  const text = String(tweetText || '').trim();
  const tpl = String(templateText || '').trim();
  const rendered = tpl
    ? (tpl.includes(PLACEHOLDER) ? tpl.split(PLACEHOLDER).join(text) : `${text}\n\n${tpl}`)
    : `${text}\n\nGenerate ${replyCount} natural replies. Output only ready-to-post reply text, each inside its own code block.`;
  return `${rendered}\n\n请只输出可直接发布的评论候选，优先使用代码块分隔。最多返回 ${replyCount} 条。`;
}

function extractComments(rawText, limit = DEFAULT_REPLY_COUNT) {
  const text = String(rawText || '').trim();
  if (!text) return [];
  const dedupe = (arr) => Array.from(new Set(arr.map((s) => s.trim()).filter(Boolean))).slice(0, limit);
  const splitLooseCandidates = (value, minItems = 3) => {
    const body = String(value || '').trim();
    if (!body) return [];
    if (/^\s*(?:\d+[\).]|[-*])\s+/m.test(body)) {
      const items = body.split(/\n+(?=\s*(?:\d+[\).]|[-*])\s+)/)
        .map((s) => s.replace(/^\s*(?:\d+[\).]|[-*])\s+/, '').trim())
        .filter((s) => s.length >= 2 && s.length <= 1000);
      if (items.length >= minItems) return items;
    }
    const lines = body.split(/\n+/)
      .map((s) => s.trim())
      .filter((s) => s.length >= 2 && s.length <= 1000);
    return lines.length >= minItems ? lines : [];
  };

  const codeBlocks = [];
  const blockRe = /```(?:[\w-]+)?\s*([\s\S]*?)```/g;
  let match;
  while ((match = blockRe.exec(text))) {
    const c = match[1].trim();
    if (c) codeBlocks.push(c);
  }
  if (codeBlocks.length) {
    if (codeBlocks.length === 1) {
      const split = splitLooseCandidates(codeBlocks[0], 3);
      if (split.length) return dedupe(split);
    }
    return dedupe(codeBlocks);
  }

  if (/^\s*(?:\d+[\).]|[-*])\s+/m.test(text)) {
    const items = splitLooseCandidates(text, 1);
    if (items.length) return dedupe(items);
  }

  return dedupe(splitLooseCandidates(text, 2));
}

async function readErrorText(res) {
  try {
    const text = await res.text();
    return text ? text.slice(0, 300) : '';
  } catch (_) {
    return '';
  }
}

function mapHttpError(status, providerLabel, detail = '') {
  // Log details internally for diagnostic purposes.
  console.error(`[XVM][Error] ${providerLabel} status: ${status}, detail: ${detail.slice(0, 300)}`);

  if (status === 401 || status === 403) return `${providerLabel} API Key 无效或没有权限`;
  if (status === 404) return `${providerLabel} 模型或接口不存在，请检查 Base URL 和 Model`;
  if (status === 429) return `${providerLabel} 触发限流，请稍后再试`;
  if (status >= 500) return `${providerLabel} 服务端错误`;
  return `${providerLabel} 请求失败`;
}

async function fetchJson(url, options, providerLabel) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 45000);
  try {
    const res = await fetch(url, { ...options, signal: controller.signal });
    if (!res.ok) throw new Error(mapHttpError(res.status, providerLabel, await readErrorText(res)));
    return await res.json();
  } catch (err) {
    if (err?.name === 'AbortError') throw new Error(`${providerLabel} 请求超时`);
    if (err instanceof TypeError) throw new Error(`${providerLabel} 无法连接，请检查服务是否启动或网络是否可用`);
    throw err;
  } finally {
    clearTimeout(timer);
  }
}

async function fetchTextStream(url, options, providerLabel, onChunk) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 65000);
  try {
    const res = await fetch(url, { ...options, signal: controller.signal });
    if (!res.ok) throw new Error(mapHttpError(res.status, providerLabel, await readErrorText(res)));
    const reader = res.body?.getReader?.();
    if (!reader) return '';
    const decoder = new TextDecoder();
    let full = '';
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      const chunk = decoder.decode(value, { stream: true });
      if (chunk) {
        full += chunk;
        onChunk?.(chunk, full);
      }
    }
    const tail = decoder.decode();
    if (tail) {
      full += tail;
      onChunk?.(tail, full);
    }
    return full;
  } catch (err) {
    if (err?.name === 'AbortError') throw new Error(`${providerLabel} 请求超时`);
    if (err instanceof TypeError) throw new Error(`${providerLabel} 无法连接，请检查服务是否启动或网络是否可用`);
    throw err;
  } finally {
    clearTimeout(timer);
  }
}

function emitParsedProgress(rawText, limit, onProgress, state) {
  if (typeof onProgress !== 'function') return;
  const comments = extractComments(rawText, limit);
  if (!comments.length) return;
  const sig = comments.join('\n---\n');
  if (sig === state.lastProgressSig) return;
  state.lastProgressSig = sig;
  onProgress(comments);
}

async function loadConfig() {
  const syncItems = await chrome.storage.sync.get(SYNC_DEFAULTS);
  const localItems = await chrome.storage.local.get(LOCAL_DEFAULTS);
  return normalizeConfig(syncItems, localItems);
}

async function generateWithOllama(config, payload, onProgress) {
  const baseUrl = assertAllowedOllamaBaseUrl(config.baseUrl || 'http://localhost:11434');
  const model = config.model || 'llama3.1';
  const prompt = renderPrompt(payload.tweetText, payload.promptTemplate, config.replyCount);
  let generated = '';
  let pending = '';
  const progressState = { lastProgressSig: '' };
  const processOllamaLine = (line) => {
    const trimmed = String(line || '').trim();
    if (!trimmed) return;
    try {
      const json = JSON.parse(trimmed);
      generated += json?.message?.content || json?.response || '';
      emitParsedProgress(generated, config.replyCount, onProgress, progressState);
    } catch (_) {}
  };
  const streamBody = await fetchTextStream(`${baseUrl}/api/chat`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      model,
      stream: true,
      messages: [{ role: 'user', content: prompt }],
      options: { temperature: 0.8 },
    }),
  }, 'Ollama', (chunk) => {
    pending += chunk;
    const lines = pending.split(/\r?\n/);
    pending = lines.pop() || '';
    for (const line of lines) {
      processOllamaLine(line);
    }
  });
  processOllamaLine(pending);
  if (!generated) {
    for (const line of streamBody.split(/\r?\n/)) {
      try {
        const json = JSON.parse(line.trim());
        generated += json?.message?.content || json?.response || '';
      } catch (_) {}
    }
  }
  const text = generated || streamBody;
  const comments = extractComments(text, config.replyCount);
  if (!comments.length) throw new Error('模型返回中没有解析到评论候选');
  return comments;
}

async function generateWithOpenAICompatible(config, payload, onProgress) {
  const baseUrl = assertAllowedOpenAIBaseUrl(config.baseUrl);
  const model = config.model;
  if (!model) throw new Error('请先填写模型名称');
  if (!config.apiKey && !isLocalHttpUrl(baseUrl)) throw new Error('请先填写 API Key');
  const prompt = renderPrompt(payload.tweetText, payload.promptTemplate, config.replyCount);
  const headers = { 'content-type': 'application/json' };
  if (config.apiKey) headers.authorization = `Bearer ${config.apiKey}`;
  if (config.platform === 'openrouter') {
    headers['x-title'] = 'X Viral Monitor';
  }
  let generated = '';
  let pending = '';
  const progressState = { lastProgressSig: '' };
  const processOpenAIEvent = (event) => {
    for (const line of String(event || '').split(/\r?\n/)) {
      const trimmed = line.trim();
      if (!trimmed.startsWith('data:')) continue;
      const data = trimmed.slice(5).trim();
      if (!data || data === '[DONE]') continue;
      try {
        const json = JSON.parse(data);
        generated += json?.choices?.[0]?.delta?.content || json?.choices?.[0]?.message?.content || json?.choices?.[0]?.text || '';
        emitParsedProgress(generated, config.replyCount, onProgress, progressState);
      } catch (_) {}
    }
  };
  const streamBody = await fetchTextStream(`${baseUrl}/chat/completions`, {
    method: 'POST',
    headers,
    body: JSON.stringify({
      model,
      stream: true,
      temperature: 0.8,
      messages: [{ role: 'user', content: prompt }],
    }),
  }, getPlatformPreset(config.platform).label || 'AI Provider', (chunk) => {
    pending += chunk;
    const events = pending.split(/\r?\n\r?\n+/);
    pending = events.pop() || '';
    for (const event of events) {
      processOpenAIEvent(event);
    }
  });
  processOpenAIEvent(pending);
  if (!generated) {
    try {
      const json = JSON.parse(streamBody);
      generated = json?.choices?.[0]?.message?.content || json?.choices?.[0]?.text || '';
    } catch (_) {}
  }
  const text = generated || streamBody;
  const comments = extractComments(text, config.replyCount);
  if (!comments.length) throw new Error('模型返回中没有解析到评论候选');
  return comments;
}

async function testOllama(config) {
  const baseUrl = assertAllowedOllamaBaseUrl(config.baseUrl || 'http://localhost:11434');
  const json = await fetchJson(`${baseUrl}/api/tags`, { method: 'GET' }, 'Ollama');
  const models = Array.isArray(json?.models) ? json.models : [];
  const model = config.model || 'llama3.1';
  if (models.length && model && !models.some((m) => m?.name === model || m?.model === model)) {
    return { ok: true, message: `Ollama 已连接，但未在本地模型列表中找到 ${model}` };
  }
  return { ok: true, message: 'Ollama 已连接' };
}

async function testOpenAICompatible(config) {
  const baseUrl = assertAllowedOpenAIBaseUrl(config.baseUrl);
  if (!config.apiKey && !isLocalHttpUrl(baseUrl)) throw new Error('请先填写 API Key');
  const headers = {};
  if (config.apiKey) headers.authorization = `Bearer ${config.apiKey}`;
  await fetchJson(`${baseUrl}/models`, { method: 'GET', headers }, getPlatformPreset(config.platform).label || 'AI Provider');
  return { ok: true, message: '连接测试通过' };
}

async function callLicenseProxy(action, body) {
  if (!LICENSE_PROXY_ACTIONS.has(action)) throw new Error('unknown_license_action');
  const res = await fetch(`${LICENSE_PROXY_URL}/${action}`, {
    method: 'POST',
    headers: { 'Accept': 'application/json', 'Content-Type': 'application/json' },
    body: JSON.stringify(body || {}),
  });
  return res.json();
}

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (!message || typeof message.type !== 'string') return false;

  if (message.type === 'XVM_LICENSE_PROXY') {
    (async () => {
      const payload = await callLicenseProxy(message.action, message.body);
      sendResponse({ ok: true, payload });
    })().catch((err) => sendResponse({ ok: false, error: err?.message || 'license_proxy_failed' }));
    return true;
  }

  if (message.type === 'XVM_AI_GET_PRESETS') {
    sendResponse({ ok: true, presets: OPENAI_COMPAT_PLATFORMS, defaults: SYNC_DEFAULTS });
    return false;
  }

  if (message.type === 'XVM_AI_GENERATE') {
    (async () => {
      const config = await loadConfig();
      const requestId = typeof message.requestId === 'string' ? message.requestId : '';
      const emitProgress = (comments) => {
        if (!requestId || !sender?.tab?.id || !Array.isArray(comments)) return;
        try {
          chrome.tabs?.sendMessage?.(sender.tab.id, {
            type: 'XVM_AI_GENERATE_PROGRESS',
            requestId,
            comments,
          });
        } catch (_) {}
      };
      if (config.provider === 'ollama') {
        sendResponse({ ok: true, comments: await generateWithOllama(config, message.payload || {}, emitProgress) });
        return;
      }
      if (config.provider === 'openai-compatible') {
        sendResponse({ ok: true, comments: await generateWithOpenAICompatible(config, message.payload || {}, emitProgress) });
        return;
      }
      sendResponse({ ok: false, error: '当前 Provider 使用 X Grok，请走页面内 Grok 生成路径' });
    })().catch((err) => sendResponse({ ok: false, error: err?.message || 'AI 生成失败' }));
    return true;
  }

  if (message.type === 'XVM_AI_TEST_CONNECTION') {
    (async () => {
      const config = await loadConfig();
      if (config.provider === 'x-grok') {
        sendResponse({ ok: true, message: 'X Grok 使用当前 X 登录态，无需 API Key' });
        return;
      }
      const result = config.provider === 'ollama'
        ? await testOllama(config)
        : await testOpenAICompatible(config);
      sendResponse(result);
    })().catch((err) => sendResponse({ ok: false, error: err?.message || '连接测试失败' }));
    return true;
  }

  return false;
});