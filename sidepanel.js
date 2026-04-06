// === State ===
let collectedTweets = new Map(); // id → tweet data
let isRunning = false;
let shouldStop = false;
let rateLimitRemaining = null;
let rateLimitReset = null;

// === DOM refs ===
const form = document.getElementById('search-form');
const btnStart = document.getElementById('btn-start');
const btnStop = document.getElementById('btn-stop');
const btnExport = document.getElementById('btn-export');
const progressSection = document.getElementById('progress-section');
const progressBar = document.getElementById('progress-bar');
const progressText = document.getElementById('progress-text');
const statsEl = document.getElementById('stats');
const statTotal = document.getElementById('stat-total');
const statWindow = document.getElementById('stat-window');
const tbody = document.getElementById('results-body');
const dateFrom = document.getElementById('date-from');
const dateTo = document.getElementById('date-to');

// Default dates: last 90 days
const today = new Date();
dateTo.value = fmt(today);
const ago = new Date(today);
ago.setDate(ago.getDate() - 90);
dateFrom.value = fmt(ago);

function fmt(d) {
  return d.getFullYear() + '-' +
    String(d.getMonth() + 1).padStart(2, '0') + '-' +
    String(d.getDate()).padStart(2, '0');
}

// === Generate time windows ===
function generateWindows(from, to, days) {
  const windows = [];
  let cursor = new Date(from);
  const end = new Date(to);
  while (cursor < end) {
    const winEnd = new Date(cursor);
    winEnd.setDate(winEnd.getDate() + days);
    if (winEnd > end) winEnd.setTime(end.getTime());
    windows.push({ since: fmt(cursor), until: fmt(winEnd) });
    cursor = winEnd;
  }
  return windows;
}

// === Start collection ===
form.addEventListener('submit', async (e) => {
  e.preventDefault();
  if (isRunning) return;

  const username = document.getElementById('username').value.trim().replace('@', '');
  const from = dateFrom.value;
  const to = dateTo.value;
  const granularity = parseInt(document.getElementById('granularity').value, 10);
  const baseDelay = parseInt(document.getElementById('delay').value, 10) * 1000;

  if (!username || !from || !to) return;

  isRunning = true;
  shouldStop = false;
  collectedTweets.clear();
  tbody.innerHTML = '';
  btnStart.disabled = true;
  btnStop.disabled = false;
  btnExport.disabled = true;
  progressSection.classList.remove('hidden');
  statsEl.classList.remove('hidden');

  const windows = generateWindows(from, to, granularity);

  for (let i = 0; i < windows.length; i++) {
    if (shouldStop) break;
    const win = windows[i];
    const query = `from:${username} since:${win.since} until:${win.until}`;
    const pct = ((i + 1) / windows.length * 100).toFixed(0);
    progressBar.style.width = pct + '%';
    progressText.textContent = `Window ${i + 1}/${windows.length}: ${win.since} → ${win.until}`;
    statWindow.textContent = `Window ${i + 1}/${windows.length}`;

    // Tell content script to navigate and collect
    await collectWindow(query);

    // Rate-limit aware delay between windows
    if (i < windows.length - 1 && !shouldStop) {
      const delay = getAdaptiveDelay(baseDelay);
      if (delay > baseDelay) {
        progressText.textContent = `Rate limit low (${rateLimitRemaining} left), waiting ${Math.round(delay / 1000)}s...`;
      }
      await sleep(delay);
    }
  }

  progressBar.style.width = '100%';
  progressText.textContent = shouldStop ? 'Stopped' : 'Done!';
  isRunning = false;
  btnStart.disabled = false;
  btnStop.disabled = true;
  btnExport.disabled = collectedTweets.size === 0;
});

btnStop.addEventListener('click', () => {
  shouldStop = true;
  btnStop.disabled = true;
});

// === Rate Limit Awareness ===
function getAdaptiveDelay(baseDelay) {
  if (rateLimitRemaining === null) return baseDelay;
  if (rateLimitRemaining <= 5) {
    // Almost exhausted: wait until reset
    const now = Math.floor(Date.now() / 1000);
    const waitSec = Math.max((rateLimitReset || now) - now, 30);
    return waitSec * 1000;
  }
  if (rateLimitRemaining <= 20) return Math.max(baseDelay, 10000); // 10s
  if (rateLimitRemaining <= 50) return Math.max(baseDelay, 6000);  // 6s
  return baseDelay;
}

// === Collect one search window ===
function collectWindow(query) {
  return new Promise((resolve) => {
    const searchUrl = `https://x.com/search?q=${encodeURIComponent(query)}&src=typed_query&f=top`;

    // Listen for data from content script
    let scrollDone = false;
    let lastCount = 0;
    let stableRounds = 0;

    function onMessage(msg) {
      if (msg.type === 'XVM_COLLECT_DATA') {
        const tweets = msg.tweets || [];
        for (const t of tweets) {
          if (!collectedTweets.has(t.id)) {
            collectedTweets.set(t.id, t);
            addRow(t);
          }
        }
        statTotal.textContent = collectedTweets.size + ' tweets';
      }
      if (msg.type === 'XVM_SCROLL_DONE') {
        scrollDone = true;
      }
      if (msg.type === 'XVM_RATE_LIMIT') {
        rateLimitRemaining = msg.remaining;
        rateLimitReset = msg.reset;
        const rlEl = document.getElementById('stat-ratelimit');
        rlEl.textContent = `API: ${rateLimitRemaining} left`;
        rlEl.style.color = rateLimitRemaining <= 10 ? '#f44336' : rateLimitRemaining <= 30 ? '#ff9800' : '#8b98a5';
      }
    }
    chrome.runtime.onMessage.addListener(onMessage);

    // Navigate to search
    chrome.runtime.sendMessage({
      target: 'content',
      type: 'XVM_START_COLLECT',
      url: searchUrl,
    });

    // Poll until scroll done or stable
    const check = setInterval(() => {
      if (shouldStop || scrollDone) {
        clearInterval(check);
        chrome.runtime.onMessage.removeListener(onMessage);
        resolve();
        return;
      }
      const currentCount = collectedTweets.size;
      if (currentCount === lastCount) {
        stableRounds++;
      } else {
        stableRounds = 0;
        lastCount = currentCount;
      }
      // If no new data for 10 seconds, move on
      if (stableRounds >= 5) {
        clearInterval(check);
        chrome.runtime.onMessage.removeListener(onMessage);
        resolve();
      }
    }, 2000);
  });
}

// === Add row to table ===
function addRow(t) {
  const tr = document.createElement('tr');
  const date = new Date(t.createdAt);
  const dateStr = fmt(date) + ' ' +
    String(date.getHours()).padStart(2, '0') + ':' +
    String(date.getMinutes()).padStart(2, '0');
  const engRate = t.views > 0
    ? ((t.likes + t.retweets + t.replies) / t.views * 100).toFixed(2) + '%'
    : '-';

  tr.innerHTML =
    `<td>${dateStr}</td>` +
    `<td class="num">${t.views.toLocaleString()}</td>` +
    `<td class="num">${t.likes.toLocaleString()}</td>` +
    `<td class="num">${t.retweets.toLocaleString()}</td>` +
    `<td class="num">${t.replies.toLocaleString()}</td>` +
    `<td class="num">${engRate}</td>` +
    `<td class="text-col" title="${esc(t.text || '')}">${esc(t.text || '')}</td>`;
  tbody.appendChild(tr);
}

function esc(s) {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

// === Sort table ===
const sortState = { col: null, asc: true };
document.querySelectorAll('th[data-sort]').forEach(th => {
  th.addEventListener('click', () => {
    const col = th.dataset.sort;
    if (sortState.col === col) {
      sortState.asc = !sortState.asc;
    } else {
      sortState.col = col;
      sortState.asc = false; // default descending for numbers
    }
    renderTable();
  });
});

function renderTable() {
  const tweets = [...collectedTweets.values()];
  const col = sortState.col;
  if (col) {
    tweets.sort((a, b) => {
      let va, vb;
      if (col === 'date') { va = new Date(a.createdAt).getTime(); vb = new Date(b.createdAt).getTime(); }
      else if (col === 'engRate') {
        va = a.views > 0 ? (a.likes + a.retweets + a.replies) / a.views : 0;
        vb = b.views > 0 ? (b.likes + b.retweets + b.replies) / b.views : 0;
      }
      else { va = a[col] || 0; vb = b[col] || 0; }
      return sortState.asc ? va - vb : vb - va;
    });
  }
  tbody.innerHTML = '';
  for (const t of tweets) addRow(t);
}

// === Export CSV ===
btnExport.addEventListener('click', () => {
  const tweets = [...collectedTweets.values()];
  if (tweets.length === 0) return;

  const headers = ['ID', 'Date', 'Views', 'Likes', 'Retweets', 'Replies', 'Bookmarks', 'Engagement%', 'URL', 'Text'];
  const rows = tweets.map(t => {
    const date = new Date(t.createdAt);
    const engRate = t.views > 0 ? ((t.likes + t.retweets + t.replies) / t.views * 100).toFixed(2) : '0';
    return [
      t.id,
      date.toISOString(),
      t.views, t.likes, t.retweets, t.replies, t.bookmarks,
      engRate,
      `https://x.com/i/status/${t.id}`,
      '"' + (t.text || '').replace(/"/g, '""') + '"',
    ].join(',');
  });

  const csv = '\ufeff' + headers.join(',') + '\n' + rows.join('\n');
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `x-tweets-${document.getElementById('username').value}-${dateFrom.value}-${dateTo.value}.csv`;
  a.click();
  URL.revokeObjectURL(url);
});

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }
