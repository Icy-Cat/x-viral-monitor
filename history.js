console.debug('[XVM-HIST] history dashboard loading');

async function rpc(message) {
  return new Promise((res, rej) => {
    chrome.runtime.sendMessage(message, (r) => {
      if (chrome.runtime.lastError) {
        console.error('[XVM-HIST] rpc error', message.type, chrome.runtime.lastError);
        return rej(chrome.runtime.lastError);
      }
      res(r);
    });
  });
}

const state = {
  tweets: [],
  lastByTweet: new Map(),
  filter: { handle: '', sort: 'velocity', range: 'all', status: 'all', search: '' },
};

function velocity(tweet, last) {
  if (!last) return 0;
  const ageH = Math.max(0.1, (last.ts - tweet.created_at) / 3_600_000);
  return last.impressions / ageH;
}

function applyFilter() {
  const { handle, sort, range, status, search } = state.filter;
  const now = Date.now();
  const cutoff = range === 'day' ? now - 86_400_000 : range === 'week' ? now - 7 * 86_400_000 : 0;
  const rows = state.tweets.filter((t) => {
    if (handle && t.author !== handle) return false;
    if (status !== 'all' && t.status !== status) return false;
    if (cutoff && t.created_at < cutoff) return false;
    if (search && !(t.text || '').toLowerCase().includes(search.toLowerCase())) return false;
    return true;
  });
  rows.sort((a, b) => {
    const la = state.lastByTweet.get(a.tweet_id);
    const lb = state.lastByTweet.get(b.tweet_id);
    switch (sort) {
      case 'impressions': return (lb?.impressions || 0) - (la?.impressions || 0);
      case 'likes':       return (lb?.likes || 0)       - (la?.likes || 0);
      case 'retweets':    return (lb?.retweets || 0)    - (la?.retweets || 0);
      case 'created_at':  return b.created_at - a.created_at;
      case 'velocity':
      default:            return velocity(b, lb) - velocity(a, la);
    }
  });
  return rows;
}

function renderBloggers() {
  const counts = new Map();
  for (const t of state.tweets) counts.set(t.author, (counts.get(t.author) || 0) + 1);
  document.querySelector('[data-count="all"]').textContent = state.tweets.length;
  document.querySelector('.xvm-h-blogger-all').classList.toggle('active', state.filter.handle === '');
  const root = document.getElementById('xvm-h-blogger-list');
  root.innerHTML = '';
  for (const [handle, n] of [...counts.entries()].sort()) {
    const el = document.createElement('div');
    el.className = 'xvm-h-blogger';
    if (handle === state.filter.handle) el.classList.add('active');
    el.dataset.handle = handle;
    el.innerHTML = `@${handle}<span class="count">${n}</span>`;
    el.addEventListener('click', () => { state.filter.handle = handle; renderAll(); });
    root.appendChild(el);
  }
}

function spark(samples) {
  if (!samples?.length) return '';
  const w = 80, h = 24;
  const max = Math.max(...samples.map((s) => s.impressions), 1);
  const pts = samples.map((s, i) => [i * w / Math.max(1, samples.length - 1), h - (s.impressions / max) * h]);
  return `<svg class="spark" viewBox="0 0 ${w} ${h}" width="${w}" height="${h}"><polyline fill="none" stroke="#1d9bf0" stroke-width="1.5" points="${pts.map((p) => p.join(',')).join(' ')}"/></svg>`;
}

async function renderList() {
  const list = document.getElementById('xvm-h-list');
  const detail = document.getElementById('xvm-h-detail');
  detail.hidden = true;
  list.hidden = false;
  list.innerHTML = '';
  const rows = applyFilter();
  if (rows.length === 0) {
    list.innerHTML = '<div class="xvm-h-empty">No tracked tweets yet. Subscribe to a blogger from any tweet (☆ button) and wait for X to refresh.</div>';
    return;
  }
  for (const t of rows) {
    const last = state.lastByTweet.get(t.tweet_id);
    const card = document.createElement('div');
    card.className = 'xvm-h-card';
    card.innerHTML = `
      <div class="meta">@${t.author} · ${new Date(t.created_at).toLocaleString()}</div>
      <div class="text">${escapeHtml((t.text || '').slice(0, 240))}</div>
      <div class="stats">
        <span>👁 ${last?.impressions ?? 0}</span>
        <span>❤ ${last?.likes ?? 0}</span>
        <span>↻ ${last?.retweets ?? 0}</span>
        <span>💬 ${last?.replies ?? 0}</span>
        <span class="spark-slot"></span>
      </div>`;
    card.addEventListener('click', () => openDetail(t.tweet_id));
    list.appendChild(card);
    rpc({ type: 'XVM_HIST_GET_SAMPLES', tweetId: t.tweet_id }).then((r) => {
      card.querySelector('.spark-slot').innerHTML = spark(r.samples || []);
    }).catch(() => {});
  }
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

async function openDetail(tweetId) {
  console.debug('[XVM-HIST] open detail', tweetId);
  alert('detail view — implemented in Task 11. tweet: ' + tweetId);
}

function renderAll() { renderBloggers(); renderList(); }

async function refresh() {
  console.debug('[XVM-HIST] refreshing dashboard');
  const r = await rpc({ type: 'XVM_HIST_LIST_TWEETS' });
  state.tweets = r?.tweets || [];
  console.debug('[XVM-HIST] loaded', state.tweets.length, 'tweets');
  state.lastByTweet.clear();
  await Promise.all(state.tweets.map(async (t) => {
    try {
      const sr = await rpc({ type: 'XVM_HIST_GET_SAMPLES', tweetId: t.tweet_id });
      const samples = sr?.samples || [];
      if (samples.length) state.lastByTweet.set(t.tweet_id, samples[samples.length - 1]);
    } catch (_) {}
  }));
  renderAll();
}

document.getElementById('xvm-h-search').addEventListener('input', (e) => { state.filter.search = e.target.value; renderList(); });
document.getElementById('xvm-h-sort').addEventListener('change', (e) => { state.filter.sort = e.target.value; renderList(); });
document.getElementById('xvm-h-range').addEventListener('change', (e) => { state.filter.range = e.target.value; renderList(); });
document.getElementById('xvm-h-status').addEventListener('change', (e) => { state.filter.status = e.target.value; renderList(); });
document.querySelector('.xvm-h-blogger-all').addEventListener('click', () => { state.filter.handle = ''; renderAll(); });
document.getElementById('xvm-h-add-blogger').addEventListener('click', async () => {
  const input = prompt('Enter @handle or x.com URL:');
  if (!input) return;
  const { normalizeHandle } = await import('./lib/subscriptions.js');
  const h = normalizeHandle(input);
  if (!h) return alert('Invalid handle');
  const cur = await chrome.storage.sync.get({ subscribed: [] });
  const next = cur.subscribed.includes(h) ? cur.subscribed : [...cur.subscribed, h];
  await chrome.storage.sync.set({ subscribed: next });
  console.debug('[XVM-HIST] added subscription', h);
});

refresh();
chrome.storage.onChanged.addListener((_c, area) => { if (area === 'sync') refresh(); });
