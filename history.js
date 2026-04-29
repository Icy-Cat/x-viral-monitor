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
  subscribed: [],
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
  // Ensure every subscribed handle appears, even with 0 tweets
  for (const h of state.subscribed) if (!counts.has(h)) counts.set(h, 0);

  document.querySelector('[data-count="all"]').textContent = state.tweets.length;
  document.querySelector('.xvm-h-blogger-all').classList.toggle('active', state.filter.handle === '');

  const root = document.getElementById('xvm-h-blogger-list');
  root.innerHTML = '';
  if (counts.size === 0) {
    root.innerHTML = '<div class="xvm-h-empty-side">No subscriptions yet. Hover any tweet\'s velocity badge on x.com → click ☆ Track.</div>';
    return;
  }
  const handles = [...counts.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
  for (const [handle, n] of handles) {
    const subscribed = state.subscribed.includes(handle);
    const el = document.createElement('div');
    el.className = 'xvm-h-blogger';
    if (handle === state.filter.handle) el.classList.add('active');
    if (!subscribed) el.classList.add('xvm-h-blogger-archived');
    el.dataset.handle = handle;
    const tag = subscribed ? '★' : '';
    // Find a representative tweet for this handle to get name/avatar
    const rep = state.tweets.find((t) => t.author === handle);
    const name = rep?.author_name || '';
    const avatar = rep?.author_avatar || '';
    const avatarHtml = avatar
      ? `<img class="xvm-h-avatar" src="${escapeHtml(avatar)}" alt="">`
      : `<span class="xvm-h-avatar xvm-h-avatar-placeholder">${escapeHtml(handle.slice(0, 1).toUpperCase())}</span>`;
    el.innerHTML = `
      <div class="xvm-h-blogger-info">
        ${avatarHtml}
        <div class="xvm-h-blogger-text">
          <div class="xvm-h-blogger-name">${tag}${name ? ' ' + escapeHtml(name) : ''}</div>
          <div class="xvm-h-blogger-handle">@${escapeHtml(handle)}</div>
        </div>
      </div>
      <span class="count">${n}</span>`;
    el.addEventListener('click', () => { state.filter.handle = handle; renderAll(); });
    root.appendChild(el);
  }
}

function spark(samples) {
  if (!samples?.length) return '';
  const w = 80, h = 24;
  const imps = samples.map((s) => s.impressions);
  const max = Math.max(...imps);
  const min = Math.min(...imps);
  if (samples.length === 1 || max === min) {
    const dots = samples.map((s, i) => {
      const x = samples.length === 1 ? w / 2 : i * w / (samples.length - 1);
      return `<circle cx="${x}" cy="${h / 2}" r="2" fill="#1d9bf0"/>`;
    }).join('');
    return `<svg class="spark" viewBox="0 0 ${w} ${h}" width="${w}" height="${h}">${dots}</svg>`;
  }
  const pts = samples.map((s, i) => {
    const x = i * w / (samples.length - 1);
    const yNorm = (s.impressions - min) / (max - min);
    const y = (h - 2) - yNorm * (h - 4);
    return [x.toFixed(1), y.toFixed(1)];
  });
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
    let msg;
    if (state.subscribed.length === 0) {
      msg = `<strong>No subscriptions yet.</strong><br>Go to x.com or pro.x.com, hover any tweet's velocity badge, then click "☆ Track @handle" in the popup.`;
    } else if (state.tweets.length === 0) {
      msg = `<strong>Subscribed to ${state.subscribed.length} blogger(s) but no tweets captured yet.</strong><br>Open the blogger's profile or wait for the timeline to refresh — the extension records tweets as they pass through GraphQL responses. Tweets you've already seen this session should replay automatically when you (re-)subscribe.`;
    } else {
      msg = `<strong>${state.tweets.length} tweet(s) in history, but none match the current filters.</strong><br>Try changing the sort, range, or status filter, or click "★ All" in the sidebar.`;
    }
    list.innerHTML = `<div class="xvm-h-empty">${msg}</div>`;
    return;
  }
  for (const t of rows) {
    const last = state.lastByTweet.get(t.tweet_id);
    const card = document.createElement('div');
    card.className = 'xvm-h-card';
    const cardAvatar = t.author_avatar
      ? `<img class="xvm-h-card-avatar" src="${escapeHtml(t.author_avatar)}" alt="">`
      : `<span class="xvm-h-card-avatar xvm-h-avatar-placeholder">${escapeHtml((t.author || '?').slice(0, 1).toUpperCase())}</span>`;
    card.innerHTML = `
      <div class="meta">
        ${cardAvatar}
        <div class="xvm-h-card-author">
          <div class="xvm-h-card-name">${t.author_name ? escapeHtml(t.author_name) : ''}</div>
          <div class="xvm-h-card-handle">@${escapeHtml(t.author)} · ${new Date(t.created_at).toLocaleString()}</div>
        </div>
      </div>
      <div class="text">${(t.text || '').trim() ? escapeHtml(t.text.slice(0, 240)) : '<span class="xvm-h-empty-text">[empty text — possibly media-only tweet]</span>'}</div>
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
  const list = document.getElementById('xvm-h-list');
  const detail = document.getElementById('xvm-h-detail');
  list.hidden = true;
  detail.hidden = false;
  detail.innerHTML = `
    <button id="xvm-h-back" class="xvm-h-back-btn">← Back</button>
    <div id="xvm-h-detail-meta"></div>
    <div id="xvm-h-chart"></div>`;
  document.getElementById('xvm-h-back').addEventListener('click', () => {
    state.filter.search = state.filter.search; // no-op, but keep state coherent
    renderList();
  });
  const [{ tweet }, { samples }] = await Promise.all([
    rpc({ type: 'XVM_HIST_GET_TWEET', tweetId }),
    rpc({ type: 'XVM_HIST_GET_SAMPLES', tweetId }),
  ]);
  const last = samples?.[samples.length - 1];
  const detailAvatar = tweet?.author_avatar
    ? `<img class="xvm-h-detail-avatar" src="${escapeHtml(tweet.author_avatar)}" alt="">`
    : '';
  document.getElementById('xvm-h-detail-meta').innerHTML = `
    <div class="xvm-h-detail-header">
      ${detailAvatar}
      <div>
        <h2>${tweet?.author_name ? escapeHtml(tweet.author_name) : ''}</h2>
        <div class="xvm-h-detail-handle">@${tweet?.author || '?'} · ${tweet?.created_at ? new Date(tweet.created_at).toLocaleString() : ''}</div>
      </div>
    </div>
    <p class="xvm-h-detail-text">${(tweet?.text || '').trim() ? escapeHtml(tweet.text.slice(0, 800)) : '<span class="xvm-h-empty-text">[empty text — possibly media-only tweet]</span>'}</p>
    <p class="xvm-h-detail-stats">
      <span>👁 ${last?.impressions ?? 0}</span>
      <span>❤ ${last?.likes ?? 0}</span>
      <span>↻ ${last?.retweets ?? 0}</span>
      <span>💬 ${last?.replies ?? 0}</span>
      <span class="xvm-status xvm-status-${tweet?.status || 'active'}">${tweet?.status || 'active'}</span>
    </p>`;
  const { renderChart } = await import('./lib/chart.js');
  renderChart(document.getElementById('xvm-h-chart'), samples || []);
}

function renderAll() { renderBloggers(); renderList(); }

async function refresh() {
  console.debug('[XVM-HIST] refreshing dashboard');
  const subsResult = await chrome.storage.sync.get({ subscribed: [] });
  state.subscribed = Array.isArray(subsResult.subscribed) ? subsResult.subscribed : [];
  const r = await rpc({ type: 'XVM_HIST_LIST_TWEETS' });
  state.tweets = r?.tweets || [];
  console.debug('[XVM-HIST] loaded', state.tweets.length, 'tweets,', state.subscribed.length, 'subscriptions');
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

function csvEscape(v) {
  const s = String(v ?? '');
  if (/[",\n]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
  return s;
}

async function exportCsv() {
  console.debug('[XVM-HIST] exporting CSV for', state.tweets.length, 'tweets');
  const rows = [['tweet_id', 'author', 'text', 'created_at', 'ts', 'impressions', 'likes', 'retweets', 'replies', 'bookmarks', 'd_likes', 'd_retweets', 'd_replies', 'd_bookmarks']];
  for (const t of state.tweets) {
    try {
      const { samples } = await rpc({ type: 'XVM_HIST_GET_SAMPLES', tweetId: t.tweet_id });
      for (const s of samples || []) {
        rows.push([
          t.tweet_id,
          t.author,
          (t.text || '').replace(/\s+/g, ' '),
          new Date(t.created_at).toISOString(),
          new Date(s.ts).toISOString(),
          s.impressions, s.likes, s.retweets, s.replies, s.bookmarks,
          s.d_likes ?? 0, s.d_retweets ?? 0, s.d_replies ?? 0, s.d_bookmarks ?? 0,
        ]);
      }
    } catch (e) {
      console.error('[XVM-HIST] export: failed to fetch samples for', t.tweet_id, e);
    }
  }
  // Prepend BOM for Excel compatibility on Windows
  const csv = '﻿' + rows.map((r) => r.map(csvEscape).join(',')).join('\n');
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `xvm-history-${new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-')}.csv`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
  console.debug('[XVM-HIST] CSV download triggered:', a.download);
}

document.getElementById('xvm-h-export').addEventListener('click', exportCsv);
document.getElementById('xvm-h-refresh').addEventListener('click', () => {
  console.debug('[XVM-HIST] manual refresh');
  refresh();
});

refresh();
chrome.storage.onChanged.addListener((_c, area) => { if (area === 'sync') refresh(); });
