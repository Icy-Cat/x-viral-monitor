// === Tweet Data Store ===
const tweetDataStore = new Map();
const DEFAULT_THRESHOLDS = {
  trending: 1000,
  viral: 10000,
};
let velocityThresholds = { ...DEFAULT_THRESHOLDS };

// === i18n ===
let localizedStrings = {};
function i18n(key) { return localizedStrings[key] || key; }

function applyLocalizedUi() {
  if (!leaderboardEl) return;
  const head = leaderboardEl.querySelector('.xvm-lb-head');
  const title = leaderboardEl.querySelector('.xvm-lb-title');
  const back = leaderboardEl.querySelector('.xvm-lb-back');
  if (head) head.title = i18n('contentLeaderboardDragToMove');
  if (title) title.textContent = `🔥 ${i18n('contentLeaderboardTitle')}`;
  if (back) {
    back.title = i18n('contentLeaderboardBackToPrevious');
    back.setAttribute('aria-label', i18n('contentLeaderboardBackToPrevious'));
  }
}

function normalizeThresholds(raw) {
  const trending = Number.parseInt(raw?.trending, 10);
  const viral = Number.parseInt(raw?.viral, 10);
  const next = {
    trending: Number.isFinite(trending) && trending > 0 ? trending : DEFAULT_THRESHOLDS.trending,
    viral: Number.isFinite(viral) && viral > 0 ? viral : DEFAULT_THRESHOLDS.viral,
  };
  if (next.viral <= next.trending) {
    next.viral = Math.max(next.trending + 1, DEFAULT_THRESHOLDS.viral);
  }
  return next;
}

let leaderboardEnabled = false;
let leaderboardCount = 10;
const DEFAULT_LB_COLUMNS = [
  { id: 'rank',     visible: true  },
  { id: 'icon',     visible: true  },
  { id: 'handle',   visible: false },
  { id: 'preview',  visible: true  },
  { id: 'views',    visible: true  },
  { id: 'velocity', visible: true  },
];
let leaderboardColumns = DEFAULT_LB_COLUMNS.map((c) => ({ ...c }));
let badgeStyle = 'pill-solid';
let copyAsMarkdownEnabled = true;
let starChartEnabled = true;

function applyBadgeStyle() {
  document.documentElement.dataset.xvmBadgeStyle = badgeStyle;
}

window.addEventListener('message', (event) => {
  if (event.source !== window) return;
  if (event.data?.type !== 'XVM_SETTINGS_UPDATE') return;

  localizedStrings = event.data.messages || localizedStrings;
  applyLocalizedUi();
  velocityThresholds = normalizeThresholds(event.data.thresholds);
  badgeStyle = event.data.badgeStyle === 'inline-classic' ? 'inline-classic' : 'pill-solid';
  applyBadgeStyle();
  document.querySelectorAll('article[data-xvm-scored]').forEach((article) => {
    article.removeAttribute('data-xvm-scored');
  });
  document.querySelectorAll('.xvm-badge').forEach((badge) => {
    badge.remove();
  });
  renderBadges();

  const nextLb = !!event.data.featureVelocityLeaderboard;
  const nextCount = Number.isFinite(event.data.leaderboardCount) ? event.data.leaderboardCount : 10;
  const nextCols = Array.isArray(event.data.leaderboardColumns) && event.data.leaderboardColumns.length
    ? event.data.leaderboardColumns
    : leaderboardColumns;
  const countChanged = nextCount !== leaderboardCount;
  const colsChanged = JSON.stringify(nextCols) !== JSON.stringify(leaderboardColumns);
  leaderboardCount = nextCount;
  leaderboardColumns = nextCols;
  if (nextLb !== leaderboardEnabled) {
    leaderboardEnabled = nextLb;
    if (leaderboardEnabled) {
      renderLeaderboard();
    } else {
      hideLeaderboard();
    }
  } else if (leaderboardEnabled && (countChanged || colsChanged)) {
    renderLeaderboard();
  }

  copyAsMarkdownEnabled = event.data.featureCopyAsMarkdown !== false;
  starChartEnabled = event.data.featureStarChart !== false;
});

window.postMessage({ type: 'XVM_REQUEST_SETTINGS' }, '*');

// === Request Interception (fetch + XHR) ===
const GRAPHQL_RE = /\/i\/api\/graphql\//;
const DEFAULT_GROK_COMMENT_PROMPT = '[推文内容]\n\n为我生成针对该推文的10条评论,每条评论用代码块包裹';
const DEFAULT_GROK_PROMPT_TEMPLATES = [
  { id: 'default', name: '默认评论', prompt: DEFAULT_GROK_COMMENT_PROMPT },
  { id: 'short-cn', name: '中文短评', prompt: '[推文内容]\n\n为该推文生成10条自然、简短、像真人回复的中文评论,每条评论用代码块包裹' },
  { id: 'sharp', name: '犀利观点', prompt: '[推文内容]\n\n为该推文生成10条有观点、有信息密度、但不人身攻击的评论,每条评论用代码块包裹' },
  { id: 'tieba-laoge', name: '贴吧老哥', prompt: '[推文内容]\n\n用百度贴吧老哥的语气为该推文生成10条评论。要求：\n- 整体阴阳怪气，但不带脏字、不人身攻击\n- 自然融入老哥常用语：急了/急了急了、蚌埠住了、典/孝/乐、典中典、绷不住了、就这？、好家伙、家人们谁懂啊\n- 可适度用 🤡😅🤣 这类表情，但不要每条都用\n- 保持口语感，不要装文艺、不要写得像新闻评论\n- 每条评论控制在 30 字以内，简短精悍\n- 每条评论用代码块包裹' },
];
const DEFAULT_GROK_ARTICLE_PROMPT_TEMPLATES = [
  { id: 'article-default', name: '文章评论', prompt: '以下是一篇 X 长文 / Article：\n\n[推文内容]\n\n为这篇长文生成10条评论。要求：每条评论引用文章中具体的观点或论据进行回应（赞同/质疑/补充），避免笼统的"很有启发"这类空话；语气自然像真人；每条评论用代码块包裹。' },
  { id: 'article-deep', name: '深度回应', prompt: '以下是一篇长文：\n\n[推文内容]\n\n挑选这篇长文中最值得讨论的3-5个核心论点，针对每个论点给出1-2条有信息密度的评论（提出延伸思考、反例、或个人经验），每条评论用代码块包裹。' },
];
// Tweet length threshold separating "short tweet" templates from "long article"
// templates. X tweets cap at 280 chars by default; longer (long-form posts /
// articles) get a different prompt set with reasoning suited to long content.
const ARTICLE_LENGTH_THRESHOLD = 600;

let grokPromptTemplate = DEFAULT_GROK_COMMENT_PROMPT;
let grokPromptTemplates = DEFAULT_GROK_PROMPT_TEMPLATES.map((tpl) => ({ ...tpl }));
let grokArticlePromptTemplates = DEFAULT_GROK_ARTICLE_PROMPT_TEMPLATES.map((tpl) => ({ ...tpl }));
let grokSelectedTemplateId = 'default';
let grokSelectedArticleTemplateId = 'article-default';
let grokTemporaryChat = true;
let grokLastReplyArticle = null;

window.postMessage({ type: 'XVM_GROK_SETTINGS_REQUEST' }, '*');

// Pre-warm tx-id context so the first AI 生成 click is fast.
window.__xvmXct?.warmup?.();

window.addEventListener('message', (event) => {
  if (event.source !== window) return;
  if (event.data?.type !== 'XVM_GROK_SETTINGS_LOAD') return;
  if (typeof event.data.promptTemplate === 'string' && event.data.promptTemplate.trim()) {
    grokPromptTemplate = event.data.promptTemplate;
  }
  if (Array.isArray(event.data.promptTemplates) && event.data.promptTemplates.length) {
    grokPromptTemplates = normalizeGrokPromptTemplates(event.data.promptTemplates);
  } else if (grokPromptTemplate) {
    grokPromptTemplates = normalizeGrokPromptTemplates([{ id: 'default', name: '默认评论', prompt: grokPromptTemplate }]);
  }
  if (Array.isArray(event.data.articlePromptTemplates) && event.data.articlePromptTemplates.length) {
    grokArticlePromptTemplates = normalizeGrokPromptTemplates(event.data.articlePromptTemplates);
  }
  if (typeof event.data.selectedPromptId === 'string' && event.data.selectedPromptId) {
    grokSelectedTemplateId = event.data.selectedPromptId;
  }
  if (typeof event.data.selectedArticlePromptId === 'string' && event.data.selectedArticlePromptId) {
    grokSelectedArticleTemplateId = event.data.selectedArticlePromptId;
  }
  if (typeof event.data.temporaryChat === 'boolean') {
    grokTemporaryChat = event.data.temporaryChat;
  }
});

// === Star Chart: GraphQL endpoint template capture ===
// Learns the latest queryId + features blob X is using for known operations,
// plus the bearer token + ct0 csrf header. Persists to chrome.storage.local
// so the star-chart fetcher can replay the same shape later.
const STARCHART_OPS = ['Retweeters', 'SearchTimeline'];
const STARCHART_GRAPHQL_RE = /\/i\/api\/graphql\/([^/]+)\/([^?]+)/;

function recordStarChartTemplate(url, requestHeaders) {
  const m = url.match(STARCHART_GRAPHQL_RE);
  if (!m) return;
  const queryId = m[1];
  const opName = m[2];

  // The Bearer token is identical across all X GraphQL operations, so
  // capture it from ANY call (TweetDetail, HomeTimeline, etc.) into a
  // shared `_global` slot. queryId is per-op and only stored for our
  // target ops (Retweeters / SearchTimeline).
  // Bearer is auto-cached in __xvmNet.getBearer() — we only need to forward
  // the global capture for star chart's persistent storage.
  const auth = requestHeaders?.authorization || requestHeaders?.Authorization || null;
  if (auth) {
    window.postMessage({
      type: 'XVM_SC_TEMPLATE_CAPTURE',
      op: '_global',
      template: { authorization: auth },
    }, '*');
  }

  if (!STARCHART_OPS.includes(opName)) return;

  let featuresStr = null;
  try {
    const u = new URL(url, location.origin);
    featuresStr = u.searchParams.get('features');
  } catch (_) {}

  const update = { queryId };
  if (featuresStr) update.features = featuresStr;
  if (auth) update.authorization = auth;

  window.postMessage({
    type: 'XVM_SC_TEMPLATE_CAPTURE',
    op: opName,
    template: update,
  }, '*');
}

function normalizeGrokPromptTemplates(raw) {
  const seen = new Set();
  const out = [];
  for (const item of Array.isArray(raw) ? raw : []) {
    const prompt = String(item?.prompt || '').trim();
    if (!prompt) continue;
    const id = String(item?.id || `tpl-${out.length + 1}`).trim() || `tpl-${out.length + 1}`;
    if (seen.has(id)) continue;
    seen.add(id);
    out.push({
      id,
      name: String(item?.name || `模板 ${out.length + 1}`).trim() || `模板 ${out.length + 1}`,
      prompt,
    });
  }
  return out.length ? out : DEFAULT_GROK_PROMPT_TEMPLATES.map((tpl) => ({ ...tpl }));
}

function reportRateLimit(remaining, reset) {
  if (remaining === null || remaining === undefined) return;
  window.postMessage({
    type: 'XVM_RATE_LIMIT',
    remaining: parseInt(remaining, 10),
    reset: parseInt(reset, 10),
  }, '*');
}

// Subscribe to GraphQL traffic for star-chart template capture + tweet scanning.
window.__xvmNet?.onRequest(GRAPHQL_RE, ({ url, headers }) => {
  recordStarChartTemplate(url, headers);
});
window.__xvmNet?.onResponse(GRAPHQL_RE, async ({ url, response, source }) => {
  if (source === 'fetch') {
    reportRateLimit(response.headers.get('x-rate-limit-remaining'), response.headers.get('x-rate-limit-reset'));
    response.clone().json().then(scanForTweets).catch(() => {});
  } else {
    reportRateLimit(response.getHeader('x-rate-limit-remaining'), response.getHeader('x-rate-limit-reset'));
    try { scanForTweets(response.json()); } catch (_) {}
  }
});

// === Data Extraction ===
// Recursively scan any JSON for tweet_results objects
function scanForTweets(obj) {
  if (!obj || typeof obj !== 'object') return;
  let found = false;

  if (obj.tweet_results?.result) {
    const data = extractTweetData(obj.tweet_results.result);
    if (data) {
      tweetDataStore.set(data.id, data);
      found = true;
    }
  }

  // Recurse into arrays and objects
  if (Array.isArray(obj)) {
    for (const item of obj) scanForTweets(item);
  } else {
    for (const key of Object.keys(obj)) {
      if (key === 'tweet_results') continue; // already handled above
      const val = obj[key];
      if (val && typeof val === 'object') scanForTweets(val);
    }
  }

  if (found) { renderBadges(); }
}

function extractTweetData(result) {
  const tweet = result.tweet || result;
  const legacy = tweet.legacy;
  if (!legacy) return null;

  const rtResult = legacy.retweeted_status_result?.result;
  if (rtResult) {
    return extractTweetData(rtResult);
  }

  const viewCount = parseInt(tweet.views?.count, 10);
  if (!viewCount || tweet.views?.state !== 'EnabledWithCount') return null;

  if (legacy.promotedMetadata || tweet.promotedMetadata) return null;

  const urlMap = {};
  for (const u of legacy.entities?.urls || []) {
    if (u?.url && u.expanded_url) urlMap[u.url] = u.expanded_url;
  }

  // Long-form tweet body (note_tweet) overrides full_text if present
  const noteText = tweet.note_tweet?.note_tweet_results?.result?.text;
  for (const u of tweet.note_tweet?.note_tweet_results?.result?.entity_set?.urls || []) {
    if (u?.url && u.expanded_url && !urlMap[u.url]) urlMap[u.url] = u.expanded_url;
  }

  // X Article (long-form essay) content
  const articleResult = tweet.article?.article_results?.result;
  let articleMd = '';
  let articleTitle = '';
  if (articleResult) {
    articleMd = buildArticleMarkdown(articleResult);
    articleTitle = articleResult.title || articleResult.preview_text || '';
  }
  for (const m of legacy.extended_entities?.media || legacy.entities?.media || []) {
    if (!m?.url) continue;
    if (m.type === 'photo') {
      urlMap[m.url] = `![](${m.media_url_https})`;
    } else if (m.type === 'video' || m.type === 'animated_gif') {
      const variants = m.video_info?.variants || [];
      const mp4s = variants.filter((v) => v.content_type === 'video/mp4' && v.bitrate != null);
      mp4s.sort((a, b) => (b.bitrate || 0) - (a.bitrate || 0));
      const videoUrl = mp4s[0]?.url || m.media_url_https;
      urlMap[m.url] = `[📹 video](${videoUrl})`;
    } else {
      urlMap[m.url] = m.media_url_https;
    }
  }

  return {
    id: legacy.id_str,
    views: viewCount,
    likes: legacy.favorite_count || 0,
    retweets: legacy.retweet_count || 0,
    replies: legacy.reply_count || 0,
    bookmarks: legacy.bookmark_count || 0,
    createdAt: legacy.created_at,
    text: noteText || legacy.full_text || '',
    urlMap,
    articleMd,
    articleTitle,
  };
}

// Draft.js-style content_state → Markdown for X Articles
function buildArticleMarkdown(articleResult) {
  const title = articleResult.title || '';
  const coverUrl = articleResult.cover_media?.media_info?.original_img_url
    || articleResult.cover_media?.media_info?.media_url_https
    || '';

  let state = articleResult.content_state;
  if (typeof state === 'string') {
    try { state = JSON.parse(state); } catch (_) { state = null; }
  }

  const lines = [];
  if (title) lines.push(`# ${title}`, '');
  if (coverUrl) lines.push(`![](${coverUrl})`, '');

  if (state?.blocks?.length) {
    // Build a map of entityKey → entity (for LINK / IMAGE)
    const entityMap = state.entityMap || {};
    for (const block of state.blocks) {
      lines.push(renderArticleBlock(block, entityMap));
    }
  } else if (articleResult.preview_text) {
    lines.push(articleResult.preview_text);
  }

  return lines.join('\n').replace(/\n{3,}/g, '\n\n').trim();
}

function renderArticleBlock(block, entityMap) {
  const type = block.type || 'unstyled';
  const raw = block.text || '';
  const text = applyInlineFormatting(raw, block.inlineStyleRanges || [], block.entityRanges || [], entityMap);

  switch (type) {
    case 'header-one':   return `# ${text}\n`;
    case 'header-two':   return `## ${text}\n`;
    case 'header-three': return `### ${text}\n`;
    case 'unordered-list-item': return `- ${text}`;
    case 'ordered-list-item':   return `1. ${text}`;
    case 'blockquote':   return `> ${text}`;
    case 'code-block':   return '```\n' + text + '\n```';
    case 'atomic': {
      // Image/media block — find an IMAGE entity on it
      const imgEntity = (block.entityRanges || [])
        .map((r) => entityMap[r.key])
        .find((e) => e && (e.type === 'IMAGE' || e.type === 'MEDIA'));
      const src = imgEntity?.data?.mediaInfo?.original_img_url
        || imgEntity?.data?.mediaInfo?.media_url_https
        || imgEntity?.data?.url
        || '';
      return src ? `![](${src})\n` : '';
    }
    default:
      return text ? `${text}\n` : '';
  }
}

function applyInlineFormatting(raw, inlineStyleRanges, entityRanges, entityMap) {
  if (!raw) return '';

  const boundaries = new Set([0, raw.length]);
  const addRangeBoundaries = (range) => {
    const start = Math.max(0, Math.min(raw.length, range.offset || 0));
    const end = Math.max(start, Math.min(raw.length, start + (range.length || 0)));
    boundaries.add(start);
    boundaries.add(end);
  };

  inlineStyleRanges.forEach(addRangeBoundaries);
  entityRanges.forEach(addRangeBoundaries);

  const sorted = Array.from(boundaries).sort((a, b) => a - b);
  const parts = [];

  for (let i = 0; i < sorted.length - 1; i++) {
    const start = sorted[i];
    const end = sorted[i + 1];
    if (start === end) continue;

    const slice = raw.slice(start, end);
    const styles = new Set(
      inlineStyleRanges
        .filter((r) => rangeContains(r, start, end))
        .map((r) => String(r.style || '').toUpperCase())
    );
    const entityRange = entityRanges.find((r) => rangeContains(r, start, end));
    const entity = entityRange ? entityMap[entityRange.key] : null;

    let text = applyMarkdownStyles(slice, styles);
    if (entity?.type === 'LINK') {
      const href = entity.data?.url || entity.data?.href || '';
      if (href) text = `[${text}](${href})`;
    }

    parts.push(text);
  }

  return parts.join('');
}

function rangeContains(range, start, end) {
  const rangeStart = range.offset || 0;
  const rangeEnd = rangeStart + (range.length || 0);
  return start >= rangeStart && end <= rangeEnd;
}

function applyMarkdownStyles(text, styles) {
  if (!text) return '';
  if (styles.has('CODE')) return `\`${text}\``;

  let result = text;
  if (styles.has('BOLD')) result = `**${result}**`;
  if (styles.has('ITALIC')) result = `*${result}*`;
  if (styles.has('STRIKETHROUGH')) result = `~~${result}~~`;
  if (styles.has('UNDERLINE')) result = `<u>${result}</u>`;
  return result;
}

// === Formatting ===
function formatVelocity(v) {
  if (v >= 1000000) return (v / 1000000).toFixed(1) + 'M';
  if (v >= 1000) return (v / 1000).toFixed(1) + 'k';
  return Math.round(v).toString();
}

// === Scoring ===
function computeScore(data) {
  const now = Date.now();
  const created = new Date(data.createdAt).getTime();
  const hours = Math.max((now - created) / 3600000, 0.1);
  const velocity = data.views / hours;

  const velocityScore = Math.min(velocity / 50000, 1) * 40;

  const engagements = data.likes + data.retweets + data.replies;
  const engagementRate = data.views > 0 ? engagements / data.views : 0;
  const engagementScore = Math.min(engagementRate / 0.1, 1) * 25;

  const rtRatio = data.likes > 0 ? data.retweets / data.likes : 0;
  const rtScore = Math.min(rtRatio / 0.5, 1) * 20;

  const bmRatio = data.likes > 0 ? data.bookmarks / data.likes : 0;
  const bmScore = Math.min(bmRatio / 0.3, 1) * 15;

  const totalScore = Math.round(velocityScore + engagementScore + rtScore + bmScore);

  return {
    velocity,
    score: Math.min(totalScore, 100),
    isHot: velocity >= velocityThresholds.viral,
  };
}

// === Tooltip Container (fixed, appended to body) ===
let tooltipEl = null;
function getTooltip() {
  if (!tooltipEl) {
    tooltipEl = document.createElement('div');
    tooltipEl.className = 'xvm-tooltip';
    tooltipEl.addEventListener('mouseleave', () => {
      tooltipEl.style.display = 'none';
    });
    document.body.appendChild(tooltipEl);
  }
  return tooltipEl;
}

// === Badge Rendering ===
function renderBadges() {
  const articles = document.querySelectorAll('article[data-testid="tweet"]');
  for (const article of articles) {
    const tweetId = getTweetIdFromArticle(article);
    if (!tweetId) continue;
    const data = tweetDataStore.get(tweetId);
    if (!data) continue;

    if (article.hasAttribute('data-xvm-scored')) continue;

    // Find header row before marking scored — if DOM isn't ready, skip and retry later
    const caretBtn = article.querySelector('[data-testid="caret"]');
    if (!caretBtn) continue;
    let headerRow = caretBtn;
    while (headerRow && headerRow !== article) {
      if (headerRow.getBoundingClientRect().width > 200) break;
      headerRow = headerRow.parentElement;
    }
    if (!headerRow || headerRow === article) continue;

    // Only mark scored after we confirmed headerRow is valid
    article.setAttribute('data-xvm-scored', '1');

    const { velocity, score } = computeScore(data);
    // 🌱 normal | 🚀 trending | 🔥 viral
    const prefix = velocity >= velocityThresholds.viral ? '\u{1F525}' : velocity >= velocityThresholds.trending ? '\u{1F680}' : '\u{1F331}';
    const colorClass = velocity >= velocityThresholds.viral ? 'xvm-badge--red' : velocity >= velocityThresholds.trending ? 'xvm-badge--orange' : 'xvm-badge--green';

    const badge = document.createElement('span');
    badge.className = `xvm-badge ${colorClass}`;
    badge.dataset.prefix = prefix;
    badge.dataset.velocity = formatVelocity(velocity);

    // Tooltip: show/hide a single shared fixed element
    const postedDate = new Date(data.createdAt);
    const postedStr = postedDate.getFullYear() + ':' +
      String(postedDate.getMonth() + 1).padStart(2, '0') + ':' +
      String(postedDate.getDate()).padStart(2, '0') + ' ' +
      String(postedDate.getHours()).padStart(2, '0') + ':' +
      String(postedDate.getMinutes()).padStart(2, '0') + ':' +
      String(postedDate.getSeconds()).padStart(2, '0');
    const tooltipContent =
      `${i18n('contentViews')}: ${data.views.toLocaleString()}\n` +
      `${i18n('contentLikes')}: ${data.likes.toLocaleString()}\n` +
      `${i18n('contentRetweets')}: ${data.retweets.toLocaleString()}\n` +
      `${i18n('contentReplies')}: ${data.replies.toLocaleString()}\n` +
      `${i18n('contentBookmarks')}: ${data.bookmarks.toLocaleString()}\n` +
      `${i18n('contentVelocity')}: ${formatVelocity(velocity)}/h\n` +
      `${i18n('contentViralScore')}: ${score}/100\n` +
      `${i18n('contentPosted')}: ${postedStr}`;

    badge.addEventListener('mouseenter', () => {
      const tip = getTooltip();
      tip.textContent = tooltipContent;
      const rect = badge.getBoundingClientRect();
      tip.style.display = 'block';
      tip.style.top = (rect.bottom + 6) + 'px';
      tip.style.left = '';
      tip.style.right = '';
      // Align right edge of tooltip with right edge of badge
      const tipWidth = tip.offsetWidth;
      let left = rect.right - tipWidth;
      if (left < 8) left = 8;
      tip.style.left = left + 'px';
    });

    badge.addEventListener('mouseleave', (e) => {
      const tip = getTooltip();
      // Don't hide if mouse is moving into the tooltip itself
      if (tip.contains(e.relatedTarget)) return;
      tip.style.display = 'none';
    });

    headerRow.insertBefore(badge, headerRow.lastElementChild);
  }

  if (leaderboardEnabled) renderLeaderboard();
}

// === Velocity Leaderboard ===
let leaderboardEl = null;
let leaderboardRaf = 0;
const leaderboardItemMeta = new Map();
let pendingLeaderboardJump = null;
const LB_DEFAULT_WIDTH = 280;
const LB_MIN_WIDTH = 240;
const LB_MAX_WIDTH = 640;
const LB_DEFAULT_HEIGHT = 300;
const LB_MIN_HEIGHT = 120;
const LB_MAX_HEIGHT = 800;
let leaderboardWidth = LB_DEFAULT_WIDTH;
let leaderboardHeight = LB_DEFAULT_HEIGHT;

function ensureLeaderboard() {
  if (leaderboardEl) return leaderboardEl;
  leaderboardEl = document.createElement('div');
  leaderboardEl.className = 'xvm-lb';
  leaderboardEl.innerHTML = `
    <div class="xvm-lb-head" title="${i18n('contentLeaderboardDragToMove')}">
      <span class="xvm-lb-grip">⋮⋮</span>
      <span class="xvm-lb-title">🔥 ${i18n('contentLeaderboardTitle')}</span>
      <button class="xvm-lb-back" type="button" title="${i18n('contentLeaderboardBackToPrevious')}" aria-label="${i18n('contentLeaderboardBackToPrevious')}" hidden>
        <svg viewBox="0 0 20 20" width="15" height="15" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round">
          <path d="M4 16 L12.5 16 Q16 16 16 12.5 L16 8.5 Q16 5 12.5 5 L5 5"></path>
          <path d="M8 2 L5 5 L8 8"></path>
        </svg>
      </button>
    </div>
    <ul class="xvm-lb-list"></ul>
    <div class="xvm-lb-resize" aria-hidden="true"></div>
    <div class="xvm-lb-resize-v" aria-hidden="true"></div>
  `;
  document.body.appendChild(leaderboardEl);
  applyLeaderboardWidth();
  applyLeaderboardHeight();
  applyLeaderboardPosition();
  installLeaderboardDrag();
  installLeaderboardResize();
  installLeaderboardResizeHeight();
  installLeaderboardBackButton();
  return leaderboardEl;
}

// === Back-to-previous-scroll ===
let savedScrollY = null;
function setBackButtonVisible(visible) {
  if (!leaderboardEl) return;
  const btn = leaderboardEl.querySelector('.xvm-lb-back');
  if (!btn) return;
  if (visible) btn.removeAttribute('hidden');
  else btn.setAttribute('hidden', '');
}
function installLeaderboardBackButton() {
  const btn = leaderboardEl.querySelector('.xvm-lb-back');
  if (!btn) return;
  // Prevent the drag handler from kicking in when pressing the button
  btn.addEventListener('mousedown', (e) => e.stopPropagation());
  btn.addEventListener('click', (e) => {
    e.stopPropagation();
    if (savedScrollY === null) return;
    const target = savedScrollY;
    clearLink();
    window.scrollTo({ top: target, behavior: 'smooth' });
    savedScrollY = null;
    setBackButtonVisible(false);
  });
}

// === Leaderboard drag + persisted position ===
const LB_POS_KEY = 'xvmLeaderboardPos';
let leaderboardPos = null; // {left, top} in px from top-left of viewport
function clampLeaderboardWidth(width) {
  const safeWidth = Number.isFinite(width) ? width : LB_DEFAULT_WIDTH;
  const maxByViewport = Math.max(LB_MIN_WIDTH, Math.min(LB_MAX_WIDTH, window.innerWidth - 16));
  const maxByPosition = leaderboardPos && Number.isFinite(leaderboardPos.left)
    ? Math.max(LB_MIN_WIDTH, Math.min(maxByViewport, window.innerWidth - leaderboardPos.left - 8))
    : maxByViewport;
  return Math.max(LB_MIN_WIDTH, Math.min(safeWidth, maxByPosition));
}
function applyLeaderboardWidth() {
  if (!leaderboardEl) return;
  leaderboardWidth = clampLeaderboardWidth(leaderboardWidth);
  leaderboardEl.style.width = leaderboardWidth + 'px';
}
function clampLeaderboardHeight(height) {
  const safeHeight = Number.isFinite(height) ? height : LB_DEFAULT_HEIGHT;
  const maxByViewport = Math.max(LB_MIN_HEIGHT, Math.min(LB_MAX_HEIGHT, window.innerHeight - 80));
  const maxByPosition = leaderboardPos && Number.isFinite(leaderboardPos.top)
    ? Math.max(LB_MIN_HEIGHT, Math.min(maxByViewport, window.innerHeight - leaderboardPos.top - 16))
    : maxByViewport;
  return Math.max(LB_MIN_HEIGHT, Math.min(safeHeight, maxByPosition));
}
function applyLeaderboardHeight() {
  if (!leaderboardEl) return;
  leaderboardHeight = clampLeaderboardHeight(leaderboardHeight);
  const list = leaderboardEl.querySelector('.xvm-lb-list');
  if (list) list.style.maxHeight = leaderboardHeight + 'px';
}
function applyLeaderboardPosition() {
  if (!leaderboardEl) return;
  if (leaderboardPos && Number.isFinite(leaderboardPos.left) && Number.isFinite(leaderboardPos.top)) {
    applyLeaderboardWidth();
    leaderboardEl.style.left = clampToViewport(leaderboardPos.left, 'x') + 'px';
    leaderboardEl.style.top = clampToViewport(leaderboardPos.top, 'y') + 'px';
    leaderboardEl.style.right = 'auto';
  } else {
    applyLeaderboardWidth();
  }
}
function clampToViewport(v, axis) {
  if (!leaderboardEl) return v;
  const rect = leaderboardEl.getBoundingClientRect();
  if (axis === 'x') return Math.max(8, Math.min(v, window.innerWidth - rect.width - 8));
  return Math.max(8, Math.min(v, window.innerHeight - rect.height - 8));
}

// Load persisted position via bridge
window.addEventListener('message', (event) => {
  if (event.source !== window) return;
  if (event.data?.type === 'XVM_LB_POS_LOAD' && event.data.pos) {
    leaderboardPos = event.data.pos;
    applyLeaderboardPosition();
    return;
  }
  if (event.data?.type === 'XVM_LB_SIZE_LOAD' && Number.isFinite(event.data.width)) {
    leaderboardWidth = event.data.width;
    applyLeaderboardWidth();
    applyLeaderboardPosition();
  }
  if (event.data?.type === 'XVM_LB_HEIGHT_LOAD' && Number.isFinite(event.data.height)) {
    leaderboardHeight = event.data.height;
    applyLeaderboardHeight();
  }
});
window.postMessage({ type: 'XVM_LB_POS_REQUEST' }, '*');
window.postMessage({ type: 'XVM_LB_HEIGHT_REQUEST' }, '*');
window.postMessage({ type: 'XVM_LB_SIZE_REQUEST' }, '*');

function installLeaderboardDrag() {
  if (!leaderboardEl) return;
  const head = leaderboardEl.querySelector('.xvm-lb-head');
  if (!head) return;
  let dragState = null;
  let dragRaf = 0;
  let pendingClientX = 0;
  let pendingClientY = 0;

  const flushDrag = () => {
    dragRaf = 0;
    if (!dragState) return;
    const left = clampToViewport(pendingClientX - dragState.offsetX, 'x');
    const top = clampToViewport(pendingClientY - dragState.offsetY, 'y');
    leaderboardEl.style.left = left + 'px';
    leaderboardEl.style.top = top + 'px';
    leaderboardEl.style.right = 'auto';
    leaderboardPos = { left, top };
    if (linkState) updateLinkGeometry();
  };

  head.addEventListener('mousedown', (e) => {
    if (e.button !== 0) return;
    const rect = leaderboardEl.getBoundingClientRect();
    dragState = {
      offsetX: e.clientX - rect.left,
      offsetY: e.clientY - rect.top,
    };
    leaderboardEl.classList.add('xvm-lb-dragging');
    e.preventDefault();
  });
  window.addEventListener('mousemove', (e) => {
    if (!dragState) return;
    pendingClientX = e.clientX;
    pendingClientY = e.clientY;
    if (dragRaf) return;
    dragRaf = requestAnimationFrame(flushDrag);
  }, { passive: true });
  window.addEventListener('mouseup', () => {
    if (!dragState) return;
    dragState = null;
    if (dragRaf) {
      cancelAnimationFrame(dragRaf);
      dragRaf = 0;
    }
    leaderboardEl.classList.remove('xvm-lb-dragging');
    if (leaderboardPos) {
      window.postMessage({ type: 'XVM_LB_POS_SAVE', pos: leaderboardPos }, '*');
    }
  });
}

function installLeaderboardResize() {
  if (!leaderboardEl) return;
  const handle = leaderboardEl.querySelector('.xvm-lb-resize');
  if (!handle) return;
  let resizeState = null;
  let resizeRaf = 0;
  let pendingClientX = 0;

  const flushResize = () => {
    resizeRaf = 0;
    if (!resizeState) return;
    leaderboardWidth = clampLeaderboardWidth(resizeState.startWidth + (pendingClientX - resizeState.startClientX));
    applyLeaderboardWidth();
    applyLeaderboardPosition();
    if (linkState) updateLinkGeometry();
  };

  handle.addEventListener('mousedown', (e) => {
    if (e.button !== 0) return;
    resizeState = {
      startWidth: leaderboardEl.getBoundingClientRect().width,
      startClientX: e.clientX,
    };
    leaderboardEl.classList.add('xvm-lb-resizing');
    e.stopPropagation();
    e.preventDefault();
  });
  window.addEventListener('mousemove', (e) => {
    if (!resizeState) return;
    pendingClientX = e.clientX;
    if (resizeRaf) return;
    resizeRaf = requestAnimationFrame(flushResize);
  }, { passive: true });
  window.addEventListener('mouseup', () => {
    if (!resizeState) return;
    resizeState = null;
    if (resizeRaf) {
      cancelAnimationFrame(resizeRaf);
      resizeRaf = 0;
    }
    leaderboardEl.classList.remove('xvm-lb-resizing');
    window.postMessage({ type: 'XVM_LB_SIZE_SAVE', width: leaderboardWidth }, '*');
  });
}

function installLeaderboardResizeHeight() {
  if (!leaderboardEl) return;
  const handle = leaderboardEl.querySelector('.xvm-lb-resize-v');
  if (!handle) return;
  let resizeState = null;
  let resizeRaf = 0;
  let pendingClientY = 0;

  const flushResize = () => {
    resizeRaf = 0;
    if (!resizeState) return;
    leaderboardHeight = clampLeaderboardHeight(resizeState.startHeight + (pendingClientY - resizeState.startClientY));
    applyLeaderboardHeight();
    if (linkState) updateLinkGeometry();
  };

  handle.addEventListener('mousedown', (e) => {
    if (e.button !== 0) return;
    const list = leaderboardEl.querySelector('.xvm-lb-list');
    resizeState = {
      startHeight: list ? list.getBoundingClientRect().height : leaderboardHeight,
      startClientY: e.clientY,
    };
    leaderboardEl.classList.add('xvm-lb-resizing');
    e.stopPropagation();
    e.preventDefault();
  });
  window.addEventListener('mousemove', (e) => {
    if (!resizeState) return;
    pendingClientY = e.clientY;
    if (resizeRaf) return;
    resizeRaf = requestAnimationFrame(flushResize);
  }, { passive: true });
  window.addEventListener('mouseup', () => {
    if (!resizeState) return;
    resizeState = null;
    if (resizeRaf) {
      cancelAnimationFrame(resizeRaf);
      resizeRaf = 0;
    }
    leaderboardEl.classList.remove('xvm-lb-resizing');
    window.postMessage({ type: 'XVM_LB_HEIGHT_SAVE', height: leaderboardHeight }, '*');
  });
}

window.addEventListener('resize', () => {
  if (!leaderboardEl) return;
  applyLeaderboardWidth();
  applyLeaderboardHeight();
  applyLeaderboardPosition();
  if (linkState) updateLinkGeometry();
});

function formatViews(n) {
  if (!Number.isFinite(n) || n <= 0) return '0';
  if (n >= 1_000_000) return (n / 1_000_000).toFixed(1) + 'M';
  if (n >= 1000) return (n / 1000).toFixed(1) + 'k';
  return String(n);
}

function lbEscapeHtml(s) {
  return String(s || '').replace(/[&<>"']/g, (c) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  }[c]));
}

const LB_COLUMN_RENDERERS = {
  rank: (_t, i) => `<span class="xvm-lb-rank">${i + 1}</span>`,
  icon: (t) => {
    const tier = t.velocity >= velocityThresholds.viral ? 'red'
      : t.velocity >= velocityThresholds.trending ? 'orange'
      : 'green';
    const icon = tier === 'red' ? '\u{1F525}' : tier === 'orange' ? '\u{1F680}' : '\u{1F331}';
    return `<span class="xvm-lb-icon">${icon}</span>`;
  },
  handle: (t) => {
    const fallbackHandle = `(${i18n('contentFallbackTweetLabel')})`;
    const handle = (t.handle || '').trim() || fallbackHandle;
    // Let CSS text-overflow do the truncation so the full name is shown
    // whenever there's space, and only clipped when the row is actually
    // too narrow. This plays nicer with mixed CJK/Latin names.
    return `<span class="xvm-lb-handle" title="${lbEscapeHtml(handle)}">${lbEscapeHtml(handle)}</span>`;
  },
  preview: (t) => {
    const text = (t.text || '').replace(/\s+/g, ' ').trim();
    return `<span class="xvm-lb-preview" title="${lbEscapeHtml(text.slice(0, 280))}">${lbEscapeHtml(text)}</span>`;
  },
  views: (t) => `<span class="xvm-lb-views" title="${i18n('contentLeaderboardTotalViews')}">\u{1F441} ${formatViews(t.views)}</span>`,
  velocity: (t) => `<span class="xvm-lb-vel">${formatVelocity(t.velocity)}/h</span>`,
};

function hideLeaderboard() {
  if (leaderboardEl) leaderboardEl.style.display = 'none';
  clearLink();
}

function getTweetPermalinkFromArticle(article, tweetId = '') {
  if (!article) return '';
  const links = article.querySelectorAll('a[href*="/status/"]');
  for (const link of links) {
    const href = link.getAttribute('href') || '';
    const match = href.match(/^\/([^/]+)\/status\/(\d+)/);
    if (!match) continue;
    if (tweetId && match[2] !== tweetId) continue;
    return `https://x.com/${match[1]}/status/${match[2]}`;
  }
  return '';
}

function rememberLeaderboardItem(entry) {
  if (!entry?.id) return;
  const prev = leaderboardItemMeta.get(entry.id) || {};
  leaderboardItemMeta.set(entry.id, {
    ...prev,
    ...entry,
    article: entry.article || prev.article || null,
    permalink: entry.permalink || prev.permalink || '',
    lastSeen: Date.now(),
  });
}

function collectRanked() {
  const out = [];
  const seen = new Set();
  const articles = document.querySelectorAll('article[data-testid="tweet"]');
  for (const article of articles) {
    const id = getTweetIdFromArticle(article);
    if (!id || seen.has(id)) continue;
    const data = tweetDataStore.get(id);
    if (!data) continue;
    seen.add(id);
    const { velocity } = computeScore(data);
    // Use the canonical User-Name container (works on x.com AND pro.x.com).
    // Prefer the display name ("张三") over the @handle ("zhangsan") — more
    // recognizable to humans skimming the leaderboard.
    const { displayName, handle: authorHandle } = getAuthorInfo(article);
    let handle = displayName || authorHandle || '';
    if (!handle) {
      handle = (data.text || '').slice(0, 60);
    }
    const entry = {
      id,
      article,
      permalink: getTweetPermalinkFromArticle(article, id),
      lastSeen: Date.now(),
      velocity,
      views: data.views || 0,
      handle,
      text: data.text,
    };
    rememberLeaderboardItem(entry);
    out.push(entry);
  }
  return out.sort((a, b) => b.velocity - a.velocity);
}

function waitForLeaderboardTarget(tweetId, itemEl = null, timeoutMs = 12000) {
  const startedAt = Date.now();
  pendingLeaderboardJump = { tweetId, itemEl, startedAt };
  const finish = (article) => {
    if (pendingLeaderboardJump?.tweetId !== tweetId) return;
    pendingLeaderboardJump = null;
    if (!article) return;
    article.scrollIntoView({ behavior: 'smooth', block: 'center' });
    if (itemEl?.isConnected) {
      setLink(tweetId, itemEl, article);
    } else {
      clearLink();
      article.classList.add('xvm-article-linked');
    }
  };
  const tick = () => {
    const article = findArticleByTweetId(tweetId);
    if (article) {
      finish(article);
      return true;
    }
    if (Date.now() - startedAt >= timeoutMs) {
      pendingLeaderboardJump = null;
      return true;
    }
    return false;
  };
  if (tick()) return;
  const observer = new MutationObserver(() => {
    if (tick()) observer.disconnect();
  });
  observer.observe(document.body || document.documentElement, { childList: true, subtree: true });
  setTimeout(() => {
    observer.disconnect();
    tick();
  }, timeoutMs + 50);
}

function jumpToLeaderboardTweet(id, itemEl) {
  const latest = collectRanked().find((e) => e.id === id);
  const meta = latest || leaderboardItemMeta.get(id);
  const article = latest?.article?.isConnected
    ? latest.article
    : meta?.article?.isConnected
      ? meta.article
      : findArticleByTweetId(id);

  if (article) {
    if (linkState && linkState.tweetId === id) {
      clearLink();
      return;
    }
    if (savedScrollY === null) {
      savedScrollY = window.scrollY;
      setBackButtonVisible(true);
    }
    article.scrollIntoView({ behavior: 'smooth', block: 'center' });
    setLink(id, itemEl, article);
    return;
  }

  clearLink();
  const permalink = meta?.permalink || '';
  if (!permalink) {
    showToast('无法定位该推文：页面已回收该条目且没有可用链接');
    return;
  }
  pendingLeaderboardJump = { tweetId: id, itemEl, startedAt: Date.now() };
  window.location.assign(permalink);
  waitForLeaderboardTarget(id, itemEl);
}

function renderLeaderboard() {
  cancelAnimationFrame(leaderboardRaf);
  leaderboardRaf = requestAnimationFrame(() => {
    const el = ensureLeaderboard();
    const top = collectRanked().slice(0, leaderboardCount);
    if (!top.length) {
      el.style.display = 'none';
      clearLink();
      return;
    }
    el.style.display = 'block';
    const list = el.querySelector('.xvm-lb-list');
    const visibleCols = leaderboardColumns.filter((c) => c.visible && LB_COLUMN_RENDERERS[c.id]);
    list.innerHTML = top.map((t, i) => {
      const tier = t.velocity >= velocityThresholds.viral ? 'red'
        : t.velocity >= velocityThresholds.trending ? 'orange'
        : 'green';
      const cells = visibleCols.map((c) => LB_COLUMN_RENDERERS[c.id](t, i)).join('');
      return `<li class="xvm-lb-item xvm-lb-${tier}" data-id="${t.id}">${cells}</li>`;
    }).join('');

    list.querySelectorAll('.xvm-lb-item').forEach((li) => {
      li.addEventListener('click', (ev) => {
        ev.stopPropagation();
        const id = li.dataset.id;
        jumpToLeaderboardTweet(id, li);
      });
    });

    // Restore link highlight if the linked item is in the freshly rendered list
    if (linkState) {
      const relinkItem = list.querySelector(`.xvm-lb-item[data-id="${CSS.escape(linkState.tweetId)}"]`);
      if (relinkItem) {
        linkState.itemEl = relinkItem;
        relinkItem.classList.add('xvm-lb-item-selected');
      } else {
        clearLink();
      }
    }
  });
}

// === Leaderboard ↔ article connector (infinite-canvas style) ===
// linkState: { tweetId, itemEl, article, svg, rafHandle }
let linkState = null;
const SVG_NS = 'http://www.w3.org/2000/svg';

function ensureLinkSvg() {
  const svg = document.createElementNS(SVG_NS, 'svg');
  svg.setAttribute('class', 'xvm-lb-link');
  svg.style.position = 'fixed';
  svg.style.left = '0';
  svg.style.top = '0';
  svg.style.width = '100vw';
  svg.style.height = '100vh';
  svg.style.pointerEvents = 'none';
  svg.style.zIndex = '2147483645';
  svg.innerHTML = `
    <path class="xvm-lb-link-path" fill="none" />
    <circle class="xvm-lb-link-dot xvm-lb-link-start" r="5" />
    <circle class="xvm-lb-link-dot xvm-lb-link-end" r="5" />
  `;
  document.body.appendChild(svg);
  return svg;
}

function findArticleByTweetId(tweetId) {
  const articles = document.querySelectorAll('article[data-testid="tweet"]');
  for (const article of articles) {
    const id = getTweetIdFromArticle(article);
    if (id === tweetId) return article;
  }
  return null;
}

function updateLinkGeometry() {
  if (!linkState) return;
  const { tweetId, itemEl, svg } = linkState;

  // Re-resolve article each frame — React can swap the node on virtualization
  let article = linkState.article;
  if (!article || !article.isConnected) {
    article = findArticleByTweetId(tweetId);
    linkState.article = article;
  }

  if (!itemEl.isConnected || !article) {
    if (!article) svg.style.display = 'none';
    return;
  }
  svg.style.display = '';

  const itemRect = itemEl.getBoundingClientRect();
  const articleRect = article.getBoundingClientRect();

  // Re-apply article highlight (React may have stripped it on re-render)
  if (!article.classList.contains('xvm-article-linked')) {
    article.classList.add('xvm-article-linked');
  }

  // Pick the item side that faces the article
  const itemCx = itemRect.left + itemRect.width / 2;
  const articleCx = articleRect.left + articleRect.width / 2;
  const startOnRight = articleCx >= itemCx;

  const startX = startOnRight ? itemRect.right : itemRect.left;
  const startY = itemRect.top + itemRect.height / 2;

  // Clamp article endpoint vertically to the visible article region
  const articleVisibleTop = Math.max(articleRect.top, 8);
  const articleVisibleBottom = Math.min(articleRect.bottom, window.innerHeight - 8);
  const endY = Math.max(articleVisibleTop, Math.min(startY, articleVisibleBottom));
  const endX = startOnRight ? articleRect.left : articleRect.right;

  // Cubic bezier with horizontal control handles — the "canvas connection" feel
  const dx = Math.abs(endX - startX);
  const handle = Math.max(60, dx * 0.4);
  const c1x = startX + (startOnRight ? handle : -handle);
  const c2x = endX - (startOnRight ? handle : -handle);

  const path = svg.querySelector('.xvm-lb-link-path');
  path.setAttribute('d', `M ${startX},${startY} C ${c1x},${startY} ${c2x},${endY} ${endX},${endY}`);

  const s = svg.querySelector('.xvm-lb-link-start');
  s.setAttribute('cx', startX);
  s.setAttribute('cy', startY);
  const e = svg.querySelector('.xvm-lb-link-end');
  e.setAttribute('cx', endX);
  e.setAttribute('cy', endY);
}

let linkUpdateRaf = 0;
function scheduleLinkUpdate() {
  if (!linkState || linkUpdateRaf) return;
  linkUpdateRaf = requestAnimationFrame(() => {
    linkUpdateRaf = 0;
    updateLinkGeometry();
  });
}

function setLink(tweetId, itemEl, article) {
  clearLink();
  const svg = ensureLinkSvg();
  itemEl.classList.add('xvm-lb-item-selected');
  article.classList.add('xvm-article-linked');
  linkState = { tweetId, itemEl, article, svg };
  updateLinkGeometry();
}

function clearLink() {
  if (!linkState) return;
  linkState.itemEl?.classList.remove('xvm-lb-item-selected');
  linkState.article?.classList.remove('xvm-article-linked');
  // Also clean any stale highlights on the current DOM article for this id
  const stale = findArticleByTweetId(linkState.tweetId);
  stale?.classList.remove('xvm-article-linked');
  linkState.svg?.remove();
  linkState = null;
  if (linkUpdateRaf) {
    cancelAnimationFrame(linkUpdateRaf);
    linkUpdateRaf = 0;
  }
}

// Event-driven link geometry updates — no idle rAF loop burning CPU.
// Capture phase so we catch scroll events on inner scroll containers too.
window.addEventListener('scroll', scheduleLinkUpdate, { capture: true, passive: true });
window.addEventListener('resize', scheduleLinkUpdate, { passive: true });

document.addEventListener('click', (e) => {
  if (!linkState) return;
  const insideItem = linkState.itemEl && linkState.itemEl.contains(e.target);
  const insideArticle = linkState.article && linkState.article.contains(e.target);
  const insidePanel = leaderboardEl && leaderboardEl.contains(e.target);
  if (!insideItem && !insideArticle && !insidePanel) clearLink();
});

document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape' && linkState) clearLink();
});

function getTweetIdFromArticle(article) {
  const links = article.querySelectorAll('a[href*="/status/"]');
  for (const link of links) {
    const match = link.getAttribute('href').match(/\/status\/(\d+)$/);
    if (match) {
      const id = match[1];
      if (tweetDataStore.has(id)) return id;
    }
  }
  const firstLink = article.querySelector('a[href*="/status/"]');
  if (!firstLink) return null;
  const match = firstLink.getAttribute('href').match(/\/status\/(\d+)/);
  return match ? match[1] : null;
}

// Periodic re-render for tweets whose data arrived after DOM render
setInterval(() => {
  const unscored = document.querySelectorAll('article[data-testid="tweet"]:not([data-xvm-scored])');
  if (unscored.length > 0) {
    renderBadges();
  } else if (leaderboardEnabled) {
    renderLeaderboard();
  }
}, 2000);

// Refresh leaderboard on scroll as virtualized articles come and go
let lbScrollTick = false;
window.addEventListener('scroll', () => {
  if (!leaderboardEnabled || lbScrollTick) return;
  lbScrollTick = true;
  setTimeout(() => { lbScrollTick = false; renderLeaderboard(); }, 250);
}, { passive: true });

// === MutationObserver ===
let composerInjectScheduled = false;
function scheduleComposerInject() {
  if (composerInjectScheduled) return;
  composerInjectScheduled = true;
  // rAF + microtask defer so we re-inject AFTER X finishes its layout pass.
  // Without this, X's burger-menu open/close (which rebuilds composer DOM
  // without re-emitting a textarea-added event we recognize) drops our button.
  requestAnimationFrame(() => {
    composerInjectScheduled = false;
    injectGrokReplyButtons();
  });
}

const COMPOSER_SEL = '[data-testid="tweetTextarea_0"], div[role="textbox"][contenteditable="true"], textarea[placeholder], textarea[aria-label]';

const observer = new MutationObserver((mutations) => {
  let hasNewArticles = false;
  let touchedComposer = false;
  for (const mutation of mutations) {
    for (const node of mutation.addedNodes) {
      if (node.nodeType !== 1) continue;
      if (node.tagName === 'ARTICLE' || node.querySelector?.('article[data-testid="tweet"]')) {
        hasNewArticles = true;
      }
      if (node.matches?.(COMPOSER_SEL) || node.querySelector?.(COMPOSER_SEL)) {
        touchedComposer = true;
      }
    }
    // Detect cases where X tore down a wrapper that contained our button (e.g.
    // burger menu open/close rebuilds the composer subtree). Re-inject so the
    // button reappears without requiring an Esc keypress.
    if (!touchedComposer) {
      for (const node of mutation.removedNodes) {
        if (node.nodeType !== 1) continue;
        if (node.classList?.contains?.('xvm-grok-generate-btn')
            || node.querySelector?.('.xvm-grok-generate-btn')) {
          touchedComposer = true;
          break;
        }
      }
    }
    if (hasNewArticles && touchedComposer) break;
  }
  if (hasNewArticles) renderBadges();
  if (touchedComposer) scheduleComposerInject();
});

function startObserver() {
  observer.observe(document.body, {
    childList: true,
    subtree: true,
  });
}

function bootGrokInjectorRetries() {
  // Composer mounts asynchronously after React hydrate. The initial inject at
  // content.js load fires before React is done, finding nothing. The mutation
  // observer covers most cases but X sometimes adds the composer in a way our
  // matcher misses. A handful of retry passes during the first few seconds
  // ensures the button shows up reliably without spinning forever.
  let tries = 0;
  const id = setInterval(() => {
    injectGrokReplyButtons();
    if (++tries >= 10) clearInterval(id);
  }, 400);
}

// Belt-and-suspenders: a low-frequency keepalive that re-injects whenever a
// composer is on the page but the AI button isn't. Catches edge cases the
// mutation observer misses (e.g. X swapping a composer's containing div via
// a property update that doesn't show as a DOM mutation we recognize, SPA
// navigations that reuse stale node references, etc.). Cost: one DOM lookup
// every 2s, no-op when button is already there.
setInterval(() => {
  const composer = document.querySelector('[data-testid="tweetTextarea_0"][contenteditable="true"], div[role="textbox"][contenteditable="true"]');
  if (composer && !document.querySelector('.xvm-grok-generate-btn')) {
    injectGrokReplyButtons();
  }
}, 2000);

if (document.body) {
  startObserver();
  injectGrokReplyButtons();
  bootGrokInjectorRetries();
} else {
  document.addEventListener('DOMContentLoaded', () => {
    startObserver();
    injectGrokReplyButtons();
    bootGrokInjectorRetries();
  });
}

// Reset on SPA navigation (URL change). Re-trigger Grok button injection
// because the composer (and its containing structure) is often rebuilt
// across SPA routes — particularly /compose/post → /home and back, which
// X reuses for inline-reply composers when navigating from one tweet to
// another. The observer's added-node detector doesn't always catch this
// because some routes reuse the same DOM nodes with different state.
let lastUrl = location.href;
new MutationObserver(() => {
  if (location.href !== lastUrl) {
    lastUrl = location.href;
    dismissStickyToasts();
    clearLink();
    if (pendingLeaderboardJump?.tweetId) {
      waitForLeaderboardTarget(pendingLeaderboardJump.tweetId, pendingLeaderboardJump.itemEl);
    }
    bootGrokInjectorRetries();
  }
}).observe(document.body || document.documentElement, { childList: true, subtree: true });

// === Copy-as-Markdown: inject entry into X's native share dropdown ===
// Remember the tweet the user was interacting with when opening a menu.
let lastShareContext = null; // { article, tweetId, permalink }

document.addEventListener('click', (e) => {
  const btn = e.target.closest?.('button[aria-haspopup="menu"], button[aria-expanded]');
  if (!btn) return;
  const article = btn.closest('article[data-testid="tweet"]');
  if (!article) return;

  const tweetId = getTweetIdFromArticle(article);
  let permalink = '';
  const links = article.querySelectorAll('a[href*="/status/"]');
  for (const link of links) {
    const href = link.getAttribute('href') || '';
    const m = href.match(/^\/([^/]+)\/status\/(\d+)/);
    if (m) { permalink = `https://x.com/${m[1]}/status/${m[2]}`; break; }
  }
  lastShareContext = { article, tweetId, permalink };
}, true);

function getAuthorInfo(article) {
  // User-Name block has display name + @handle
  const nameBlock = article.querySelector('[data-testid="User-Name"]');
  let displayName = '';
  let handle = '';
  if (nameBlock) {
    const spans = nameBlock.querySelectorAll('span');
    for (const s of spans) {
      const t = (s.textContent || '').trim();
      if (!handle && t.startsWith('@')) handle = t;
      else if (!displayName && t && !t.startsWith('@') && t !== '·') displayName = t;
      if (handle && displayName) break;
    }
  }
  return { displayName, handle };
}

function formatLocalDateTime(date) {
  const pad = (n) => String(n).padStart(2, '0');
  return [
    date.getFullYear(),
    pad(date.getMonth() + 1),
    pad(date.getDate()),
  ].join('-') + ' ' + [
    pad(date.getHours()),
    pad(date.getMinutes()),
  ].join(':');
}

function buildTweetMarkdown(ctx) {
  const { article, tweetId, permalink } = ctx;
  const data = tweetId ? tweetDataStore.get(tweetId) : null;

  let text = data?.text || '';
  if (!text) {
    const textEl = article.querySelector('[data-testid="tweetText"]');
    text = (textEl?.textContent || '').trim();
  }
  // Expand t.co shortlinks into their real URLs / image markdown
  const urlMap = data?.urlMap;
  if (urlMap) {
    for (const short of Object.keys(urlMap)) {
      text = text.split(short).join(urlMap[short]);
    }
  }
  // If this tweet is a long-form Article, prefer the full article body.
  if (data?.articleMd) {
    text = text ? `${data.articleMd}\n\n${text}` : data.articleMd;
  }

  const { displayName, handle } = getAuthorInfo(article);
  const url = permalink || (handle && tweetId ? `https://x.com/${handle.replace(/^@/, '')}/status/${tweetId}` : '');

  const createdAt = data?.createdAt ? new Date(data.createdAt) : null;
  const dateStr = createdAt && !isNaN(createdAt)
    ? formatLocalDateTime(createdAt)
    : '';

  const authorLabel = displayName && handle
    ? `${displayName} (${handle})`
    : (displayName || handle || i18n('contentFallbackTweetLabel'));
  const authorLine = url ? `[${authorLabel}](${url})` : authorLabel;
  const metaParts = [authorLine];
  if (dateStr) metaParts.push(dateStr);

  return `${text.trim()}\n\n— ${metaParts.join(' · ')}\n`;
}

async function copyTextToClipboard(text) {
  try {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(text);
      return true;
    }
  } catch (_) {}
  // Fallback
  try {
    const ta = document.createElement('textarea');
    ta.value = text;
    ta.style.position = 'fixed';
    ta.style.opacity = '0';
    document.body.appendChild(ta);
    ta.select();
    const ok = document.execCommand('copy');
    ta.remove();
    return ok;
  } catch (_) {
    return false;
  }
}

const stickyToasts = new Set();

function dismissToast(toast) {
  if (!toast) return;
  stickyToasts.delete(toast);
  toast.classList.remove('xvm-toast--show');
  setTimeout(() => toast.remove(), 250);
}

function dismissStickyToasts() {
  for (const toast of Array.from(stickyToasts)) {
    dismissToast(toast);
  }
}

function showToast(msg, options = {}) {
  const {
    type = 'default',
    sticky = false,
    position = 'bottom',
  } = options;
  const toast = document.createElement('div');
  toast.className = [
    'xvm-toast',
    type === 'error' ? 'xvm-toast--error' : type === 'success' ? 'xvm-toast--success' : '',
    position === 'top' ? 'xvm-toast--top' : '',
    sticky ? 'xvm-toast--sticky' : '',
  ].filter(Boolean).join(' ');
  toast.textContent = msg;
  if (sticky) {
    stickyToasts.add(toast);
    toast.addEventListener('click', () => dismissToast(toast), { once: true });
  }
  document.body.appendChild(toast);
  requestAnimationFrame(() => toast.classList.add('xvm-toast--show'));
  if (!sticky) {
    setTimeout(() => dismissToast(toast), 1400);
  }
}

function showGrokErrorToast(_msg) {
  const toast = document.createElement('div');
  toast.className = 'xvm-toast xvm-toast--error xvm-toast--top';
  toast.style.pointerEvents = 'auto';
  toast.style.cursor = 'pointer';
  toast.innerHTML = '<div style="font-weight:700">⚠ Grok 签名失效</div><div style="font-size:12px;opacity:0.85;margin-top:4px">点击自动修复 / 前往 Grok 发一条消息</div>';
  toast.addEventListener('click', () => {
    const grokLink = document.querySelector('a[href="/i/grok"]');
    if (grokLink) {
      grokLink.click();
    } else {
      location.href = '/i/grok';
    }
    dismissToast(toast);
    autoSendGrokPrime();
  }, { once: true });
  document.body.appendChild(toast);
  requestAnimationFrame(() => toast.classList.add('xvm-toast--show'));
  setTimeout(() => dismissToast(toast), 8000);
}

function autoSendGrokPrime() {
  let attempts = 0;
  const maxAttempts = 30;
  const interval = setInterval(() => {
    attempts++;
    const textarea = document.querySelector('textarea[autocapitalize="sentences"]');
    if (textarea) {
      clearInterval(interval);
      const nativeSetter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')?.set;
      if (nativeSetter) {
        nativeSetter.call(textarea, 'hi');
      } else {
        textarea.value = 'hi';
      }
      textarea.dispatchEvent(new Event('input', { bubbles: true }));
      setTimeout(() => {
        textarea.focus();
        const enterOpts = { key: 'Enter', code: 'Enter', keyCode: 13, which: 13, bubbles: true, cancelable: true };
        textarea.dispatchEvent(new KeyboardEvent('keydown', enterOpts));
        textarea.dispatchEvent(new KeyboardEvent('keypress', enterOpts));
        textarea.dispatchEvent(new KeyboardEvent('keyup', enterOpts));
        waitForGrokCapture();
      }, 500);
    } else if (attempts >= maxAttempts) {
      clearInterval(interval);
    }
  }, 500);
}

function waitForGrokCapture() {
  const handler = (event) => {
    if (event.source !== window) return;
    if (event.data?.type !== 'XVM_GROK_CAPTURE_SET') return;
    window.removeEventListener('message', handler);
    const t = document.createElement('div');
    t.className = 'xvm-toast xvm-toast--success xvm-toast--top';
    t.innerHTML = '<div style="font-weight:700">✅ 签名抓取成功</div><div style="font-size:12px;opacity:0.85;margin-top:4px">可以返回使用 AI 生成了</div>';
    t.style.pointerEvents = 'auto';
    t.style.cursor = 'pointer';
    t.addEventListener('click', () => dismissToast(t), { once: true });
    document.body.appendChild(t);
    requestAnimationFrame(() => t.classList.add('xvm-toast--show'));
    setTimeout(() => dismissToast(t), 5000);
  };
  window.addEventListener('message', handler);
  setTimeout(() => window.removeEventListener('message', handler), 15000);
}

function isArticleLengthText(text) {
  return typeof text === 'string' && text.length >= ARTICLE_LENGTH_THRESHOLD;
}

// Returns the prompt template list relevant to the source content. Articles
// (long-form posts) get their own template list with reasoning suited to
// long content; short tweets get the regular list.
function getGrokTemplatesForKind(kind) {
  return kind === 'article' ? grokArticlePromptTemplates : grokPromptTemplates;
}

function getSelectedGrokPromptTemplate(kind = 'tweet') {
  if (kind === 'article') {
    return grokArticlePromptTemplates.find((t) => t.id === grokSelectedArticleTemplateId)
        || grokArticlePromptTemplates[0]
        || DEFAULT_GROK_ARTICLE_PROMPT_TEMPLATES[0];
  }
  return grokPromptTemplates.find((t) => t.id === grokSelectedTemplateId)
      || grokPromptTemplates[0]
      || DEFAULT_GROK_PROMPT_TEMPLATES[0];
}

function getTweetTextFromArticle(article) {
  const statusId = getStatusIdFromLocation();
  const statusCached = statusId ? tweetDataStore.get(statusId) : null;
  if (statusCached?.text) return statusCached.text.trim();
  if (statusCached?.articleMd) return statusCached.articleMd.trim();

  if (!article) return '';
  const tweetId = getTweetIdFromArticle(article) || statusId;
  const cached = tweetId ? tweetDataStore.get(tweetId) : null;
  let text = cached?.text || cached?.articleMd || '';
  if (!text) {
    text = Array.from(article.querySelectorAll('[data-testid="tweetText"], div[lang]'))
      .map((el) => (el.textContent || '').trim())
      .filter(Boolean)
      .join('\n');
  }
  return text.trim();
}

function getStatusIdFromLocation() {
  const match = location.pathname.match(/\/status\/(\d+)/);
  return match?.[1] || '';
}

function findArticleForCurrentStatus() {
  const statusId = getStatusIdFromLocation();
  const articles = Array.from(document.querySelectorAll('article[data-testid="tweet"]'));
  if (!articles.length) return null;
  if (statusId) {
    for (const article of articles) {
      const id = getTweetIdFromArticle(article);
      if (id === statusId) return article;
      if (article.querySelector(`a[href*="/status/${statusId}"]`)) return article;
    }
  }
  return articles[0] || null;
}

function findReplyComposerRoot(editable) {
  if (!editable) return null;
  const dialog = editable.closest('[role="dialog"]');
  if (dialog?.querySelector?.('[data-testid="tweetButton"], [data-testid="tweetButtonInline"]')) return dialog;

  let node = editable;
  for (let depth = 0; node && depth < 24; depth++, node = node.parentElement) {
    if (node.querySelector?.('[data-testid="tweetButton"], [data-testid="tweetButtonInline"]')) return node;
    if (node.matches?.('article[data-testid="tweet"]')) break;
  }
  return editable.closest('form') || editable.parentElement || null;
}

function findReplyArticle(composerRoot) {
  const dialog = composerRoot?.closest?.('[role="dialog"]') || composerRoot;
  const article = dialog?.querySelector?.('article[data-testid="tweet"]');
  if (article) return article;
  if (grokLastReplyArticle?.isConnected) return grokLastReplyArticle;
  const statusArticle = findArticleForCurrentStatus();
  if (statusArticle) return statusArticle;
  return null;
}

function findReplyEditable(root = document) {
  return root.querySelector?.('[data-testid="tweetTextarea_0"][contenteditable="true"], div[role="textbox"][contenteditable="true"]');
}

const GROK_SUBMIT_SELECTOR = '[data-testid="tweetButton"], [data-testid="tweetButtonInline"]';
const GROK_DRAFT_CONTAINER_SELECTOR = [
  '[contenteditable="true"]',
  '[data-testid="tweetTextarea_0"]',
  '[data-testid="tweetTextarea_0RichTextInputContainer"]',
  '.DraftEditor-root',
  '.DraftEditor-editorContainer',
  '.public-DraftEditor-content',
].join(', ');

function isInvalidGrokButtonHost(host, editable) {
  if (!host || !editable) return true;
  if (host === editable || host.contains(editable)) return true;
  return !!host.closest?.(GROK_DRAFT_CONTAINER_SELECTOR);
}

function findGrokButtonHost(editable, composerRoot) {
  const scope = composerRoot?.closest?.('[role="dialog"]')
    || editable.closest('article[data-testid="tweet"]')
    || editable.closest('form')
    || composerRoot
    || editable.parentElement;
  if (!scope) return null;

  const submitBtn = scope.querySelector?.(GROK_SUBMIT_SELECTOR);
  const candidates = [];
  if (submitBtn) {
    candidates.push(submitBtn.parentElement);
    let node = submitBtn.parentElement;
    for (let depth = 0; node && node !== scope && depth < 8; depth++, node = node.parentElement) {
      const hasSubmit = node.querySelector?.(GROK_SUBMIT_SELECTOR);
      const hasToolbar = node.querySelector?.('[data-testid="toolBar"], [role="group"]');
      if (hasSubmit && hasToolbar) candidates.push(node);
    }
  }
  const toolbar = scope.querySelector?.('[data-testid="toolBar"]');
  candidates.push(
    toolbar?.parentElement,
    toolbar?.closest?.('[role="group"]')?.parentElement,
    editable.closest('form')?.querySelector?.('[role="group"]')?.parentElement,
  );

  for (const host of candidates) {
    if (!isInvalidGrokButtonHost(host, editable)) {
      return { host, submitBtn };
    }
  }
  return null;
}

function cleanupMisplacedGrokButtons(editable, composerRoot = null) {
  const editorShell = editable?.closest?.('[data-testid="tweetTextarea_0RichTextInputContainer"], .DraftEditor-root, .DraftEditor-editorContainer');
  editorShell?.querySelectorAll?.('.xvm-grok-generate-btn').forEach((btn) => btn.remove());
  composerRoot?.querySelectorAll?.('.xvm-grok-generate-btn').forEach((btn) => {
    if (isInvalidGrokButtonHost(btn.parentElement, editable)) btn.remove();
  });
}

function insertTextIntoReply(editable, text) {
  if (!editable) return false;
  editable.focus();
  if (editable.tagName === 'TEXTAREA' || editable.tagName === 'INPUT') {
    const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')?.set
      || Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set;
    if (setter) setter.call(editable, text);
    else editable.value = text;
    editable.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: 'insertText', data: text }));
    editable.dispatchEvent(new Event('change', { bubbles: true }));
    return true;
  }
  // Draft.js editor (X reply box).
  //
  // Dispatch a synthetic ClipboardEvent('paste') with a DataTransfer holding
  // the text. Draft.js's onPaste reads `clipboardData.getData('text/plain')`
  // and reconciles its internal EditorState — model and DOM stay in sync,
  // and the reply submit button activates correctly.
  //
  // No system clipboard interaction. No execCommand. No selection juggling
  // either: Draft's paste handler clears whatever is selected (or replaces
  // current content) by itself, so we don't need to selectAll first.
  try {
    const dt = new DataTransfer();
    dt.setData('text/plain', text);
    dt.setData('text/html', text); // some Draft variants prefer html — harmless when not used
    editable.dispatchEvent(new ClipboardEvent('paste', {
      bubbles: true,
      cancelable: true,
      clipboardData: dt,
    }));
    return true;
  } catch (e) {
    console.warn('[XVM-GROK] paste-event insert failed:', e);
    return false;
  }
}

function closeGrokOptions() {
  document.querySelectorAll('.xvm-grok-options').forEach((el) => el.remove());
}

function closeGrokTemplateMenu() {
  document.querySelectorAll('.xvm-grok-template-menu').forEach((el) => el.remove());
}

function showGrokTemplateMenu(anchor, editable, kind = 'tweet') {
  closeGrokTemplateMenu();
  const templates = normalizeGrokPromptTemplates(getGrokTemplatesForKind(kind));
  const selectedId = kind === 'article' ? grokSelectedArticleTemplateId : grokSelectedTemplateId;
  const menu = document.createElement('div');
  menu.className = 'xvm-grok-template-menu';
  menu.innerHTML = `
    <div class="xvm-grok-template-menu-head">${kind === 'article' ? '文章评论模板' : '推文评论模板'}</div>
    <div class="xvm-grok-template-menu-list"></div>
  `;
  const list = menu.querySelector('.xvm-grok-template-menu-list');
  templates.forEach((tpl) => {
    const item = document.createElement('button');
    item.type = 'button';
    item.className = 'xvm-grok-template-item';
    if (tpl.id === selectedId) item.classList.add('xvm-grok-template-item--selected');
    item.innerHTML = `<span>${tpl.name}</span><small>${tpl.prompt.replace(/\s+/g, ' ').slice(0, 72)}</small>`;
    item.addEventListener('click', () => {
      closeGrokTemplateMenu();
      // Persist selection per-kind so the next plain click reuses it.
      if (kind === 'article') {
        grokSelectedArticleTemplateId = tpl.id;
        try { chrome.storage?.sync?.set?.({ grokSelectedArticlePromptId: tpl.id }); } catch (_) {}
      } else {
        grokSelectedTemplateId = tpl.id;
        try { chrome.storage?.sync?.set?.({ grokSelectedPromptId: tpl.id }); } catch (_) {}
      }
      handleGrokGenerate(anchor, editable, tpl);
    });
    list.appendChild(item);
  });
  document.body.appendChild(menu);
  const rect = anchor.getBoundingClientRect();
  const width = Math.min(320, window.innerWidth - 24);
  menu.style.width = `${width}px`;
  menu.style.left = `${Math.max(12, Math.min(window.innerWidth - width - 12, rect.right - width))}px`;
  menu.style.top = `${Math.min(window.innerHeight - menu.offsetHeight - 12, rect.bottom + 8)}px`;
  setTimeout(() => {
    document.addEventListener('click', closeGrokTemplateMenu, { once: true, capture: true });
  }, 0);
}

// Renders or updates the candidate panel as a popover anchored to the AI
// button — keeps gaze in one place during the click→pick→fill flow. Re-callable
// during streaming: each call replaces the list contents in place so users can
// pick a candidate as soon as it appears.
function showGrokOptions(comments, editable, opts = {}) {
  let panel = document.querySelector('.xvm-grok-options');
  const isNew = !panel;
  if (isNew) {
    panel = document.createElement('div');
    panel.className = 'xvm-grok-options';
    panel.innerHTML = `
      <div class="xvm-grok-options-head">
        <strong>Grok 评论候选</strong>
        <span class="xvm-grok-options-status" aria-live="polite"></span>
        <button type="button" class="xvm-grok-close" aria-label="Close">×</button>
      </div>
      <div class="xvm-grok-options-list"></div>
    `;
    panel.querySelector('.xvm-grok-close')?.addEventListener('click', closeGrokOptions);
    document.body.appendChild(panel);
  }
  const status = panel.querySelector('.xvm-grok-options-status');
  if (status) {
    status.textContent = opts.streaming
      ? `生成中 ${comments.length}…`
      : (comments.length ? `共 ${comments.length} 条` : '');
  }
  const list = panel.querySelector('.xvm-grok-options-list');
  list.innerHTML = '';
  comments.forEach((comment, idx) => {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'xvm-grok-choice';
    btn.textContent = comment;
    btn.title = '填充到回复框';
    btn.addEventListener('click', () => {
      insertTextIntoReply(editable, comment);
      closeGrokOptions();
      showToast('已填充评论');
    });
    btn.dataset.idx = String(idx + 1);
    list.appendChild(btn);
  });

  // Smart placement.
  //   - In a reply modal, the AI button sits inside the dialog and there is
  //     usually empty viewport to either side of the dialog. Anchor the panel
  //     to the dialog's right edge so it sits beside the modal as a sibling
  //     surface (preferred) or to its left if the right is cramped.
  //   - Outside a modal, prefer right-of-button (trends column is typically
  //     empty), then above (composer is at viewport bottom on status pages),
  //     then below.
  const anchor = opts.anchor;
  if (anchor) {
    // X's modal scrim ([role="dialog"]) usually spans the full viewport;
    // the visible modal is a constrained-width child somewhere up the tree.
    // To anchor beside the *visible* modal we walk up from the button and
    // take the outermost ancestor whose width fits within the viewport with
    // breathing room on at least one side.
    let dialog = null;
    if (anchor.closest('[role="dialog"]')) {
      const vw = window.innerWidth;
      let node = anchor.parentElement;
      while (node && node !== document.body) {
        const r = node.getBoundingClientRect();
        const sideRoom = vw - r.width;
        if (r.width >= 400 && sideRoom >= 320) {
          dialog = node; // keep updating; outermost-fitting wins
        }
        if (node.matches?.('[role="dialog"]')) break;
        node = node.parentElement;
      }
    }
    const refRect = (dialog || anchor).getBoundingClientRect();
    const btnRect = anchor.getBoundingClientRect();
    const margin = 8;
    const minW = 320;
    const maxW = 420;
    const minH = 240;

    const spaceRight = window.innerWidth - refRect.right - margin;
    const spaceLeft = refRect.left - margin;
    const spaceAbove = btnRect.top - margin;
    const spaceBelow = window.innerHeight - btnRect.bottom - margin;
    const panelHGuess = Math.max(panel.offsetHeight || 0, minH);

    let placement;
    if (dialog) {
      // Modal: pick whichever side of the dialog has more room.
      placement = spaceRight >= spaceLeft && spaceRight >= minW + 12
        ? 'right'
        : (spaceLeft >= minW + 12 ? 'left' : 'above');
    } else if (spaceRight >= minW + 12) {
      placement = 'right';
    } else if (spaceAbove >= panelHGuess || spaceAbove >= spaceBelow) {
      placement = 'above';
    } else {
      placement = 'below';
    }

    panel.classList.remove(
      'xvm-grok-options--above',
      'xvm-grok-options--below',
      'xvm-grok-options--right',
      'xvm-grok-options--left',
    );
    panel.classList.add(`xvm-grok-options--${placement}`);
    panel.classList.toggle('xvm-grok-options--in-modal', !!dialog);

    if (placement === 'right' || placement === 'left') {
      const space = placement === 'right' ? spaceRight : spaceLeft;
      const width = Math.min(maxW, Math.max(minW, space - 4));
      panel.style.width = `${width}px`;
      panel.style.left = placement === 'right'
        ? `${refRect.right + margin}px`
        : `${Math.max(12, refRect.left - margin - width)}px`;
      // Vertically: when anchored to a dialog, hug its top so the two surfaces
      // align visually. Otherwise center near the button.
      const panelH = panel.offsetHeight || panelHGuess;
      const idealTop = dialog
        ? refRect.top
        : btnRect.top + btnRect.height / 2 - panelH / 2;
      const top = Math.max(12, Math.min(window.innerHeight - panelH - 12, idealTop));
      panel.style.top = `${top}px`;
    } else {
      const width = Math.min(maxW, window.innerWidth - 24);
      panel.style.width = `${width}px`;
      const left = Math.max(12, Math.min(window.innerWidth - width - 12, btnRect.right - width));
      panel.style.left = `${left}px`;
      const panelH = panel.offsetHeight || panelHGuess;
      if (placement === 'above') {
        panel.style.top = `${Math.max(12, btnRect.top - panelH - margin)}px`;
      } else {
        panel.style.top = `${btnRect.bottom + margin}px`;
      }
    }
    panel.dataset.anchorX = String(btnRect.left + btnRect.width / 2);
  }

  if (isNew) {
    // Don't bubble panel clicks/mousedowns to the page or X's modal backdrop —
    // some X dialog overlays close themselves on backdrop click and would
    // dismiss our panel as collateral.
    //
    // IMPORTANT: stop in the BUBBLE phase, not capture. A capture-phase
    // stopPropagation here would prevent the event from ever reaching the
    // inner candidate buttons, breaking their click handlers.
    panel.addEventListener('mousedown', (e) => e.stopPropagation());
    panel.addEventListener('click', (e) => e.stopPropagation());

    // Explicit dismissal: Escape key. (Plus the ✕ button, plus picking a
    // candidate auto-closes via showToast.) Outside-click intentionally does
    // not dismiss — too easy to lose work-in-progress, especially in modals.
    const onKey = (e) => {
      if (e.key !== 'Escape') return;
      if (!panel.isConnected) { document.removeEventListener('keydown', onKey, true); return; }
      e.stopPropagation();
      closeGrokOptions();
      document.removeEventListener('keydown', onKey, true);
    };
    document.addEventListener('keydown', onKey, true);

    // If the panel was anchored beside a reply modal, close the panel when the
    // modal goes away (X-click, ESC on modal, navigation, …). Otherwise the
    // candidates orphan-float on top of the next page, looking broken.
    const anchorEl = anchor;
    if (anchorEl && anchorEl.closest('[role="dialog"]')) {
      const checkModalAlive = () => {
        if (!panel.isConnected) {
          modalWatch.disconnect();
          return;
        }
        if (!anchorEl.isConnected) {
          modalWatch.disconnect();
          closeGrokOptions();
        }
      };
      const modalWatch = new MutationObserver(checkModalAlive);
      modalWatch.observe(document.body, { childList: true, subtree: true });
    }
  }
}

function setGrokButtonLabel(btn, label = 'AI 生成', loading = false) {
  btn.classList.toggle('xvm-grok-generate-btn--loading', loading);
  btn.innerHTML = `<span class="xvm-grok-spark" aria-hidden="true">✦</span><span>${label}</span>`;
}

async function handleGrokGenerate(btn, editable, promptTemplate = null) {
  // Synchronous re-entry guard. `btn.disabled = true` later races with rapid
  // double-clicks; the dataset flag is set before any await so the second
  // click sees it immediately.
  if (btn.dataset.xvmBusy === '1') return;
  btn.dataset.xvmBusy = '1';

  const root = findReplyComposerRoot(editable);
  const article = findReplyArticle(root);
  const replyText = getTweetTextFromArticle(article);
  if (!replyText) {
    showGrokErrorToast('未找到推文内容');
    delete btn.dataset.xvmBusy;
    return;
  }
  // If the user clicked reply on a nested reply (article ≠ thread OG),
  // compose the prompt context as 「原推文 + 回复」 so Grok sees the full
  // conversation rather than just the tweet being immediately responded to.
  const ogArticle = grokLastReplyThreadOg && grokLastReplyThreadOg !== article && grokLastReplyThreadOg.isConnected
    ? grokLastReplyThreadOg
    : null;
  const ogText = ogArticle ? getTweetTextFromArticle(ogArticle) : '';
  const tweetText = (ogText && ogText !== replyText)
    ? `【原推文】\n${ogText}\n\n【对该推文的回复】\n${replyText}`
    : replyText;
  const kind = isArticleLengthText(tweetText) ? 'article' : 'tweet';

  btn.disabled = true;
  setGrokButtonLabel(btn, '生成中', true);
  try {
    if (!window.__xvmGrok) {
      throw new Error('插件未正确加载（lib/grok-reply.js 缺失），请重载扩展');
    }
    const tpl = promptTemplate || getSelectedGrokPromptTemplate(kind);
    showGrokOptions([], editable, { streaming: true, anchor: btn });
    const comments = await window.__xvmGrok.generate({
      tweetText,
      promptTemplate: tpl?.prompt || tpl,
      temporaryChat: grokTemporaryChat,
      onProgress: (running) => {
        showGrokOptions(running, editable, { streaming: true, anchor: btn });
      },
    });
    showGrokOptions(comments, editable, { streaming: false, anchor: btn });
  } catch (err) {
    console.debug('[XVM-GROK] generation failed', err);
    closeGrokOptions();
    showGrokErrorToast(err?.message || 'Grok 生成失败');
  } finally {
    btn.disabled = false;
    setGrokButtonLabel(btn);
    delete btn.dataset.xvmBusy;
  }
}

function injectGrokReplyButtons(root = document) {
  // X's reply textarea: the [data-testid="tweetTextarea_0"] element IS the
  // contenteditable directly (not a parent of it). Plain `textarea[…]`
  // matchers cover the rare non-Draft fallback inputs (e.g. settings forms
  // that share our injection path).
  const editors = root.querySelectorAll?.('[data-testid="tweetTextarea_0"][contenteditable="true"], div[role="textbox"][contenteditable="true"], textarea[placeholder], textarea[aria-label]') || [];
  for (const editable of editors) {
    const composerRoot = findReplyComposerRoot(editable);
    cleanupMisplacedGrokButtons(editable, composerRoot);
    if (!composerRoot || composerRoot.querySelector('.xvm-grok-generate-btn')) continue;
    // Single gate: there must be a source tweet to reference. findReplyArticle
    // covers all the surfaces the user might be replying from — modal, inline,
    // /compose/post fullpage, status page — by walking the dialog, the click-
    // captured grokLastReplyArticle, and the current status id in turn. The
    // earlier dialog/article/status URL pre-check was redundant and broken on
    // /compose/post (X navigates there from timeline-reply clicks; URL has no
    // status id and the textarea is in the primary column, not a dialog).
    if (!findReplyArticle(composerRoot)) continue;

    const target = findGrokButtonHost(editable, composerRoot);
    if (!target) continue;
    const { host, submitBtn } = target;

    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'xvm-grok-generate-btn';
    setGrokButtonLabel(btn);
    btn.title = '使用提示词模板生成评论';
    btn.addEventListener('click', (ev) => {
      ev.preventDefault();
      ev.stopPropagation();
      // Detect content kind at click-time (not inject-time) — the source tweet
      // text may load lazily, and the user might reuse the same composer for
      // different threads via SPA navigation.
      const refArticle = findReplyArticle(findReplyComposerRoot(editable));
      const refText = getTweetTextFromArticle(refArticle) || '';
      const kind = isArticleLengthText(refText) ? 'article' : 'tweet';
      const list = getGrokTemplatesForKind(kind);
      if (list.length > 1) {
        showGrokTemplateMenu(btn, editable, kind);
      } else {
        handleGrokGenerate(btn, editable);
      }
    });
    if (submitBtn?.parentElement === host) {
      host.classList.add('xvm-grok-actions-host');
      host.insertBefore(btn, submitBtn);
    } else {
      host.classList.add('xvm-grok-actions-host');
      host.appendChild(btn);
    }
  }
}

// Tracks the conversation the user is replying into. Two pieces:
//   - grokLastReplyArticle    → the specific tweet the user clicked reply on
//   - grokLastReplyThreadOg   → the conversation root (OG tweet) at click time
//                                — captured BEFORE navigation, while the
//                                  status URL still tells us which article
//                                  is the conversation root. Lets us include
//                                  OG context in the prompt when commenting
//                                  on a nested reply.
let grokLastReplyThreadOg = null;
document.addEventListener('click', (e) => {
  const replyBtn = e.target.closest?.('[data-testid="reply"]');
  if (!replyBtn) return;
  const article = replyBtn.closest('article[data-testid="tweet"]');
  if (article) grokLastReplyArticle = article;
  // Find the conversation root at click-time. On a status page X renders the
  // OG tweet as the article matching the URL's status id; on the timeline
  // there is no page-wide root so OG defaults to the same article.
  const statusId = getStatusIdFromLocation();
  if (statusId) {
    const all = document.querySelectorAll('article[data-testid="tweet"]');
    let og = null;
    for (const a of all) {
      const id = getTweetIdFromArticle(a);
      if (id === statusId || a.querySelector(`a[href*="/status/${statusId}"]`)) { og = a; break; }
    }
    grokLastReplyThreadOg = og || article || null;
  } else {
    grokLastReplyThreadOg = article || null;
  }
}, true);

function closeOpenMenus() {
  // X's dropdown listens for outside pointerdown/mousedown on document to
  // auto-dismiss. Simulate that + Escape for belt-and-suspenders.
  const opts = { bubbles: true, cancelable: true, clientX: 0, clientY: 0, button: 0 };
  try { document.dispatchEvent(new PointerEvent('pointerdown', opts)); } catch (_) {}
  document.dispatchEvent(new MouseEvent('mousedown', opts));
  document.dispatchEvent(new MouseEvent('mouseup', opts));
  document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', keyCode: 27, bubbles: true, cancelable: true }));
  // Last resort: if the menu is still around next tick, remove its layer.
  setTimeout(() => {
    document.querySelectorAll('[data-testid="Dropdown"]').forEach((el) => {
      const layer = el.closest('[role="menu"]')?.parentElement?.parentElement;
      (layer || el).remove();
    });
  }, 60);
}

function isShareMenu(menuEl) {
  // Heuristic: the share dropdown contains a "copy link" item
  if (menuEl.querySelector('[data-testid*="copy" i], [data-testid*="Link" i]')) return true;
  const items = menuEl.querySelectorAll('[role="menuitem"]');
  for (const item of items) {
    const label = (item.getAttribute('aria-label') || item.textContent || '').toLowerCase();
    if (/copy link|copy post link|链接|リンク/.test(label)) return true;
  }
  return false;
}

function injectCopyMarkdownItem(menuEl) {
  if (!copyAsMarkdownEnabled) return;
  if (menuEl.querySelector('.xvm-copy-md-item')) return;
  const items = menuEl.querySelectorAll('[role="menuitem"]');
  if (!items.length) return;

  // Clone an existing menuitem so we inherit X's hover/active styling.
  const template = items[items.length - 1];
  const clone = template.cloneNode(true);
  clone.classList.add('xvm-copy-md-item');
  clone.removeAttribute('data-testid');
  clone.querySelectorAll('[data-testid]').forEach((el) => el.removeAttribute('data-testid'));

  // Replace only the first text-bearing leaf span; append a small
  // attribution line under it so users know this entry comes from the
  // extension, not X itself.
  const textSpans = clone.querySelectorAll('span');
  let labelSpan = null;
  for (const s of textSpans) {
    if (s.children.length === 0 && (s.textContent || '').trim()) {
      labelSpan = s;
      break;
    }
  }
  if (labelSpan) {
    labelSpan.textContent = '';
    const title = document.createElement('span');
    title.textContent = i18n('contentCopyMdLabel');
    const attribution = document.createElement('span');
    attribution.className = 'xvm-copy-md-source';
    attribution.textContent = i18n('contentCopyMdAttribution');
    labelSpan.appendChild(title);
    labelSpan.appendChild(document.createElement('br'));
    labelSpan.appendChild(attribution);
  } else {
    clone.textContent = i18n('contentCopyMdLabel');
  }

  // Swap the icon with a Markdown glyph
  const svg = clone.querySelector('svg');
  if (svg) {
    const mdIcon = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    mdIcon.setAttribute('viewBox', '0 0 24 24');
    mdIcon.setAttribute('width', svg.getAttribute('width') || '18');
    mdIcon.setAttribute('height', svg.getAttribute('height') || '18');
    mdIcon.setAttribute('aria-hidden', 'true');
    mdIcon.style.fill = 'currentColor';
    mdIcon.innerHTML = '<path d="M3 5h18a1 1 0 0 1 1 1v12a1 1 0 0 1-1 1H3a1 1 0 0 1-1-1V6a1 1 0 0 1 1-1zm2 3v8h2v-5l2 3 2-3v5h2V8H9.5L8 10.5 6.5 8H5zm11 0v4h-2l3 4 3-4h-2V8h-2z"/>';
    svg.replaceWith(mdIcon);
  }

  // cloneNode(true) already drops React/native listeners — just preventDefault
  // for any <a> navigation and let native CSS hover/active still work.
  clone.addEventListener('click', async (ev) => {
    ev.preventDefault();
    const ctx = lastShareContext;
    if (!ctx || !ctx.article || !ctx.article.isConnected) {
      showToast(i18n('contentCopyMdNoTweetFound'));
      closeOpenMenus();
      return;
    }
    const md = buildTweetMarkdown(ctx);
    const ok = await copyTextToClipboard(md);
    showToast(ok ? i18n('contentCopyMdDone') : i18n('contentCopyMdCopyFailed'));
    closeOpenMenus();
  });

  // Insert as the very last menuitem, matching the original group's parent.
  const lastItem = items[items.length - 1];
  lastItem.parentNode.appendChild(clone);
}

function injectStarChartItem(menuEl) {
  if (!starChartEnabled) return;
  if (menuEl.querySelector('.xvm-starchart-item')) return;
  const allItems = menuEl.querySelectorAll('[role="menuitem"]');
  if (!allItems.length) return;
  // Only clone a pristine X-native menuitem — never one we previously injected,
  // otherwise we inherit its title+br+attribution children and end up with
  // duplicate text rows.
  const nativeItems = Array.from(allItems).filter(
    (el) => !el.classList.contains('xvm-copy-md-item') && !el.classList.contains('xvm-starchart-item'),
  );
  if (!nativeItems.length) return;
  const items = allItems;

  const template = nativeItems[nativeItems.length - 1];
  const clone = template.cloneNode(true);
  clone.classList.add('xvm-starchart-item');
  clone.removeAttribute('data-testid');
  clone.querySelectorAll('[data-testid]').forEach((el) => el.removeAttribute('data-testid'));

  const textSpans = clone.querySelectorAll('span');
  let labelSpan = null;
  for (const s of textSpans) {
    if (s.children.length === 0 && (s.textContent || '').trim()) {
      labelSpan = s; break;
    }
  }
  if (labelSpan) {
    labelSpan.textContent = '';
    const title = document.createElement('span');
    title.textContent = i18n('contentStarChartMenuLabel');
    const attribution = document.createElement('span');
    attribution.className = 'xvm-copy-md-source';
    attribution.textContent = i18n('contentStarChartAttribution');
    labelSpan.appendChild(title);
    labelSpan.appendChild(document.createElement('br'));
    labelSpan.appendChild(attribution);
  } else {
    clone.textContent = i18n('contentStarChartMenuLabel');
  }

  const svg = clone.querySelector('svg');
  if (svg) {
    const starIcon = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    starIcon.setAttribute('viewBox', '0 0 24 24');
    starIcon.setAttribute('width', svg.getAttribute('width') || '18');
    starIcon.setAttribute('height', svg.getAttribute('height') || '18');
    starIcon.setAttribute('aria-hidden', 'true');
    starIcon.style.fill = 'currentColor';
    starIcon.innerHTML = '<path d="M12 2l2.39 6.36L21 9l-5 4.74L17.18 21 12 17.27 6.82 21 8 13.74 3 9l6.61-.64L12 2z"/>';
    svg.replaceWith(starIcon);
  }

  clone.addEventListener('click', (ev) => {
    ev.preventDefault();
    const ctx = lastShareContext;
    if (!ctx || !ctx.article || !ctx.article.isConnected) {
      showToast(i18n('contentStarChartNoTweetFound'));
      closeOpenMenus();
      return;
    }
    const tweetId = getTweetIdFromArticle(ctx.article);
    if (!tweetId) {
      showToast(i18n('contentStarChartNoTweetFound'));
      closeOpenMenus();
      return;
    }
    const data = tweetDataStore.get(tweetId) || {};
    closeOpenMenus();
    if (!window.__XVMStarChart?.open) {
      showToast(i18n('contentStarChartModuleNotLoaded'));
      return;
    }
    window.__XVMStarChart.open({
      tweetId,
      authorScreenName: data.authorScreenName || data.screenName || '',
      text: data.text || '',
      articleTitle: data.articleTitle || '',
    });
  });

  const lastItem = items[items.length - 1];
  lastItem.parentNode.appendChild(clone);
}

const menuObserver = new MutationObserver((mutations) => {
  for (const m of mutations) {
    for (const node of m.addedNodes) {
      if (node.nodeType !== 1) continue;
      const menus = [];
      if (node.matches?.('[role="menu"]')) menus.push(node);
      node.querySelectorAll?.('[role="menu"]').forEach((el) => menus.push(el));
      for (const menu of menus) {
        if (!isShareMenu(menu)) continue;
        injectCopyMarkdownItem(menu);
        injectStarChartItem(menu);
      }
    }
  }
});

function startMenuObserver() {
  menuObserver.observe(document.body, { childList: true, subtree: true });
}
if (document.body) startMenuObserver();
else document.addEventListener('DOMContentLoaded', startMenuObserver);
