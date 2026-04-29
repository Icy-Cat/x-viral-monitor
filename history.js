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

// === Custom dialogs (replace native alert/confirm/prompt) ===
function showDialog({ title, message, kind = 'info', input = null, confirmText = 'OK', cancelText = 'Cancel' }) {
  return new Promise((resolve) => {
    const overlay = document.createElement('div');
    overlay.className = 'xvm-h-dialog';
    overlay.innerHTML = `
      <div class="xvm-h-dialog-backdrop"></div>
      <div class="xvm-h-dialog-panel xvm-h-dialog-${kind}">
        ${title ? `<div class="xvm-h-dialog-title">${escapeHtml(title)}</div>` : ''}
        <div class="xvm-h-dialog-message">${escapeHtml(message || '')}</div>
        ${input !== null ? `<input class="xvm-h-dialog-input" type="text" placeholder="${escapeHtml(input.placeholder || '')}" value="${escapeHtml(input.value || '')}">` : ''}
        <div class="xvm-h-dialog-actions">
          ${cancelText ? `<button class="xvm-h-dialog-btn xvm-h-dialog-cancel">${escapeHtml(cancelText)}</button>` : ''}
          <button class="xvm-h-dialog-btn xvm-h-dialog-confirm xvm-h-dialog-confirm-${kind}">${escapeHtml(confirmText)}</button>
        </div>
      </div>`;
    document.body.appendChild(overlay);

    const inputEl = overlay.querySelector('.xvm-h-dialog-input');
    if (inputEl) {
      requestAnimationFrame(() => { inputEl.focus(); inputEl.select(); });
    } else {
      requestAnimationFrame(() => overlay.querySelector('.xvm-h-dialog-confirm').focus());
    }

    function close(result) {
      overlay.remove();
      document.removeEventListener('keydown', onKey);
      resolve(result);
    }
    function onKey(ev) {
      if (ev.key === 'Escape') close(null);
      if (ev.key === 'Enter' && (inputEl ? document.activeElement === inputEl : true)) {
        close(inputEl ? inputEl.value : true);
      }
    }
    document.addEventListener('keydown', onKey);
    overlay.querySelector('.xvm-h-dialog-cancel')?.addEventListener('click', () => close(null));
    overlay.querySelector('.xvm-h-dialog-confirm').addEventListener('click', () => close(inputEl ? inputEl.value : true));
    overlay.querySelector('.xvm-h-dialog-backdrop').addEventListener('click', () => close(null));
  });
}

async function uiAlert(message, { title = 'Notice', kind = 'info' } = {}) {
  await showDialog({ title, message, kind, confirmText: 'OK', cancelText: '' });
}

async function uiConfirm(message, { title = 'Confirm', kind = 'warning', confirmText = 'Confirm', cancelText = 'Cancel' } = {}) {
  const result = await showDialog({ title, message, kind, confirmText, cancelText });
  return result === true;
}

async function uiPrompt(message, { title = 'Input', placeholder = '', defaultValue = '', confirmText = 'OK', cancelText = 'Cancel' } = {}) {
  const result = await showDialog({
    title, message, kind: 'info',
    input: { placeholder, value: defaultValue },
    confirmText, cancelText,
  });
  if (result === null) return null;
  return result;
}

// === Custom select component ===
function makeSelect(host, { value, options, onChange }) {
  const wrapper = document.createElement('div');
  wrapper.className = 'xvm-h-cselect';
  wrapper.innerHTML = `
    <button class="xvm-h-cselect-trigger" aria-haspopup="listbox">
      <span class="xvm-h-cselect-value"></span>
      <svg class="xvm-h-cselect-arrow" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="6 9 12 15 18 9"/></svg>
    </button>
    <div class="xvm-h-cselect-menu" role="listbox" hidden></div>
  `;
  host.replaceWith(wrapper);

  const trigger = wrapper.querySelector('.xvm-h-cselect-trigger');
  const valueEl = wrapper.querySelector('.xvm-h-cselect-value');
  const menu = wrapper.querySelector('.xvm-h-cselect-menu');
  let current = value;

  function render() {
    const opt = options.find((o) => o.value === current);
    valueEl.textContent = opt ? opt.label : '';
    menu.innerHTML = options.map((o) => `
      <div class="xvm-h-cselect-option ${o.value === current ? 'selected' : ''}" data-value="${escapeHtml(o.value)}" role="option">
        ${o.value === current ? '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"/></svg>' : '<span class="xvm-h-cselect-spacer"></span>'}
        <span>${escapeHtml(o.label)}</span>
      </div>`).join('');
    menu.querySelectorAll('.xvm-h-cselect-option').forEach((el) => {
      el.addEventListener('click', () => {
        current = el.dataset.value;
        wrapper.classList.remove('open');
        menu.hidden = true;
        render();
        onChange?.(current);
      });
    });
  }
  function toggle() {
    const open = !menu.hidden;
    if (open) {
      menu.hidden = true;
      wrapper.classList.remove('open');
    } else {
      menu.hidden = false;
      wrapper.classList.add('open');
    }
  }

  trigger.addEventListener('click', (ev) => { ev.stopPropagation(); toggle(); });
  document.addEventListener('click', (ev) => {
    if (!wrapper.contains(ev.target)) {
      menu.hidden = true;
      wrapper.classList.remove('open');
    }
  });

  render();
  return {
    setValue: (v) => { current = v; render(); },
    getValue: () => current,
    element: wrapper,
  };
}

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
    const untrackBtn = subscribed
      ? `<button class="xvm-h-untrack" data-handle="${escapeHtml(handle)}" title="Untrack @${escapeHtml(handle)}">✕</button>`
      : '';
    el.innerHTML = `
      <div class="xvm-h-blogger-info">
        ${avatarHtml}
        <div class="xvm-h-blogger-text">
          <div class="xvm-h-blogger-name">${tag}${name ? ' ' + escapeHtml(name) : ''}</div>
          <div class="xvm-h-blogger-handle">@${escapeHtml(handle)}</div>
        </div>
      </div>
      <span class="count">${n}</span>
      ${untrackBtn}`;
    el.addEventListener('click', () => { state.filter.handle = handle; renderAll(); });
    const xBtn = el.querySelector('.xvm-h-untrack');
    if (xBtn) {
      xBtn.addEventListener('click', async (ev) => {
        ev.stopPropagation();
        ev.preventDefault();
        if (!await uiConfirm(`Untrack @${handle}? Existing history will be kept; new tweets won't be captured.`, { title: `Untrack @${handle}`, kind: 'warning' })) return;
        const cur = await chrome.storage.sync.get({ subscribed: [] });
        const next = (cur.subscribed || []).filter((h) => h !== handle);
        await chrome.storage.sync.set({ subscribed: next });
        console.debug('[XVM-HIST] untracked', handle);
      });
    }
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
    <div class="xvm-h-detail-actions">
      <button id="xvm-h-back" class="xvm-h-back-btn">← Back</button>
      <button id="xvm-h-delete-tweet" class="xvm-h-danger-btn">Delete this tweet's history</button>
    </div>
    <div id="xvm-h-detail-meta"></div>
    <div id="xvm-h-chart"></div>`;
  document.getElementById('xvm-h-back').addEventListener('click', () => {
    state.filter.search = state.filter.search; // no-op, but keep state coherent
    renderList();
  });
  document.getElementById('xvm-h-delete-tweet').addEventListener('click', async () => {
    if (!await uiConfirm("Delete this tweet's history? Subscription kept; future tweets still captured.", { title: 'Delete tweet history', kind: 'danger', confirmText: 'Delete' })) return;
    await rpc({ type: 'XVM_HIST_DELETE_TWEET', tweetId });
    await refresh();
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

makeSelect(document.getElementById('xvm-h-sort'), {
  value: 'velocity',
  options: [
    { value: 'velocity', label: 'Velocity' },
    { value: 'impressions', label: 'Impressions' },
    { value: 'likes', label: 'Likes' },
    { value: 'retweets', label: 'Retweets' },
    { value: 'created_at', label: 'Posted' },
  ],
  onChange: (v) => { state.filter.sort = v; renderList(); },
});

makeSelect(document.getElementById('xvm-h-range'), {
  value: 'all',
  options: [
    { value: 'all', label: 'All time' },
    { value: 'day', label: 'Last 24h' },
    { value: 'week', label: 'Last 7 days' },
  ],
  onChange: (v) => { state.filter.range = v; renderList(); },
});

makeSelect(document.getElementById('xvm-h-status'), {
  value: 'all',
  options: [
    { value: 'all', label: 'All' },
    { value: 'active', label: 'Active' },
    { value: 'frozen', label: 'Frozen' },
  ],
  onChange: (v) => { state.filter.status = v; renderList(); },
});
document.querySelector('.xvm-h-blogger-all').addEventListener('click', () => { state.filter.handle = ''; renderAll(); });
document.getElementById('xvm-h-add-blogger').addEventListener('click', async () => {
  const input = await uiPrompt('Enter the @handle or x.com URL of the blogger you want to track:', { title: 'Add blogger', placeholder: '@handle or https://x.com/handle' });
  if (!input) return;
  const { normalizeHandle } = await import('./lib/subscriptions.js');
  const h = normalizeHandle(input);
  if (!h) { await uiAlert('That doesn\'t look like a valid handle or X URL.', { title: 'Invalid input', kind: 'danger' }); return; }
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

async function openSettings() {
  const modal = document.getElementById('xvm-h-modal');
  modal.hidden = false;
  // Stats
  try {
    const stats = await rpc({ type: 'XVM_HIST_STATS' });
    const el = document.getElementById('xvm-h-stats');
    const usage = stats.storage?.usage;
    const usageStr = usage != null ? `${(usage / (1024 * 1024)).toFixed(2)} MB` : 'unknown';
    el.innerHTML = `
      <div><strong>${stats.tweets}</strong> tracked tweets</div>
      <div><strong>${stats.samples}</strong> samples recorded</div>
      <div>Storage usage: <strong>${usageStr}</strong></div>
    `;
  } catch (e) {
    document.getElementById('xvm-h-stats').textContent = 'Failed to load stats: ' + e.message;
  }
  // Subscriptions list with per-handle clear button
  const sl = document.getElementById('xvm-h-subs-list');
  sl.innerHTML = '';
  // Aggregate handles from both subscribed list and tweets table
  const allHandles = new Set([...state.subscribed, ...state.tweets.map((t) => t.author)]);
  if (allHandles.size === 0) {
    sl.innerHTML = '<div class="xvm-h-help">No subscriptions or captured tweets.</div>';
  } else {
    for (const h of [...allHandles].sort()) {
      const tweetCount = state.tweets.filter((t) => t.author === h).length;
      const isSubbed = state.subscribed.includes(h);
      const row = document.createElement('div');
      row.className = 'xvm-h-subs-row';
      row.innerHTML = `
        <div class="xvm-h-subs-row-info">
          <span>${isSubbed ? '★' : '☆'} @${escapeHtml(h)}</span>
          <span class="xvm-h-help">${tweetCount} tweet(s)</span>
        </div>
        <div class="xvm-h-subs-row-actions">
          ${isSubbed ? `<button data-action="untrack" data-handle="${escapeHtml(h)}">Untrack</button>` : ''}
          ${tweetCount > 0 ? `<button data-action="clear" data-handle="${escapeHtml(h)}" class="xvm-h-danger-btn">Clear history</button>` : ''}
        </div>`;
      sl.appendChild(row);
    }
    sl.querySelectorAll('button[data-action]').forEach((btn) => {
      btn.addEventListener('click', async () => {
        const action = btn.dataset.action;
        const handle = btn.dataset.handle;
        if (action === 'untrack') {
          if (!await uiConfirm(`Untrack @${handle}?`, { title: `Untrack @${handle}`, kind: 'warning' })) return;
          const cur = await chrome.storage.sync.get({ subscribed: [] });
          await chrome.storage.sync.set({ subscribed: (cur.subscribed || []).filter((x) => x !== handle) });
          openSettings();
        } else if (action === 'clear') {
          if (!await uiConfirm(`Delete all captured tweets for @${handle}? This cannot be undone.`, { title: 'Clear history', kind: 'danger', confirmText: 'Clear history' })) return;
          await rpc({ type: 'XVM_HIST_DELETE_BY_AUTHOR', author: handle });
          await refresh();
          openSettings();
        }
      });
    });
  }
}

document.getElementById('xvm-h-settings').addEventListener('click', openSettings);
document.getElementById('xvm-h-modal-close').addEventListener('click', () => { document.getElementById('xvm-h-modal').hidden = true; });
document.querySelector('#xvm-h-modal .xvm-h-modal-backdrop').addEventListener('click', () => { document.getElementById('xvm-h-modal').hidden = true; });
document.getElementById('xvm-h-clear-all').addEventListener('click', async () => {
  if (!await uiConfirm('Clear ALL history? This deletes every tracked tweet and sample. Subscriptions are kept. Cannot be undone.', { title: 'Clear all history', kind: 'danger', confirmText: 'Clear everything' })) return;
  await rpc({ type: 'XVM_HIST_CLEAR_ALL' });
  await uiAlert('All history cleared.', { title: 'Done' });
  document.getElementById('xvm-h-modal').hidden = true;
  await refresh();
});
