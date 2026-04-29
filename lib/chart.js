console.debug('[XVM-HIST] chart.js module loaded');

const NS = 'http://www.w3.org/2000/svg';
function el(tag, attrs = {}, children = []) {
  const e = document.createElementNS(NS, tag);
  for (const [k, v] of Object.entries(attrs)) e.setAttribute(k, v);
  for (const c of children) e.appendChild(c);
  return e;
}

const PAD = { l: 60, r: 20, t: 32, bCurve: 36, lane: 22 };
const SOLID_GAP_MS = 10 * 60_000;

export function renderChart(host, samples) {
  console.debug('[XVM-HIST] renderChart with', samples?.length, 'samples');
  host.innerHTML = '';
  if (!samples || samples.length === 0) {
    host.textContent = 'No samples yet.';
    return;
  }

  const w = host.clientWidth || 800;
  const curveH = 220;
  const lanesH = PAD.lane * 3 + 10;
  const h = PAD.t + curveH + PAD.bCurve + lanesH + 24;
  const x0 = PAD.l, x1 = w - PAD.r;
  const tMin = samples[0].ts;
  const tMax = samples[samples.length - 1].ts;
  const xRange = Math.max(1, tMax - tMin);
  const xScale = (t) => x0 + (x1 - x0) * (t - tMin) / xRange;
  const yMaxRaw = Math.max(...samples.map((s) => s.impressions), 1);
  const yMax = yMaxRaw * 1.05; // 5% headroom so circles near the peak don't clip
  const yScale = (v) => PAD.t + curveH - (v / yMax) * curveH;

  const svg = el('svg', { width: w, height: h, viewBox: `0 0 ${w} ${h}`, class: 'xvm-chart' });

  // Y label + axis
  svg.appendChild(el('text', { x: x0, y: PAD.t - 6, 'font-size': 11, fill: '#536471', 'font-weight': '500' }, [document.createTextNode('Impressions')]));
  svg.appendChild(el('line', { x1: x0, y1: PAD.t, x2: x0, y2: PAD.t + curveH, stroke: '#eff3f4' }));
  svg.appendChild(el('line', { x1: x0, y1: PAD.t + curveH, x2: x1, y2: PAD.t + curveH, stroke: '#eff3f4' }));
  // Y axis tick labels (yMax, midpoint, 0)
  for (const frac of [0, 0.5, 1]) {
    const v = yMaxRaw * (1 - frac);
    const y = PAD.t + curveH * frac;
    svg.appendChild(el('text', { x: x0 - 6, y: y + 4, 'font-size': 10, fill: '#536471', 'text-anchor': 'end' }, [document.createTextNode(formatNumber(v))]));
  }

  const points = samples.map((s) => [xScale(s.ts), yScale(s.impressions)]);
  let pathD = `M ${points[0][0]} ${points[0][1]}`;
  for (let i = 1; i < samples.length; i++) {
    const gap = samples[i].ts - samples[i - 1].ts;
    if (gap > SOLID_GAP_MS) {
      svg.appendChild(el('line', {
        x1: points[i - 1][0], y1: points[i - 1][1], x2: points[i][0], y2: points[i][1],
        stroke: '#cfd9de', 'stroke-width': 1.5, 'stroke-dasharray': '3,3',
      }));
      pathD += ` M ${points[i][0]} ${points[i][1]}`;
    } else {
      pathD += ` L ${points[i][0]} ${points[i][1]}`;
    }
  }
  // Area: only fill solid (non-gap) segments — for simplicity, fill behind the entire curve including gaps; gap visualization is via the dotted overlay
  const lastP = points[points.length - 1];
  const areaD = `${pathD} L ${lastP[0]} ${PAD.t + curveH} L ${points[0][0]} ${PAD.t + curveH} Z`;
  svg.appendChild(el('path', { d: areaD, fill: '#1d9bf0', 'fill-opacity': '0.12' }));
  svg.appendChild(el('path', { d: pathD, fill: 'none', stroke: '#1d9bf0', 'stroke-width': 2 }));

  // Separator + lane group title
  const sepY = PAD.t + curveH + PAD.bCurve / 2;
  svg.appendChild(el('line', { x1: x0, y1: sepY, x2: x1, y2: sepY, stroke: '#cfd9de', 'stroke-dasharray': '2,3' }));
  svg.appendChild(el('text', { x: x0, y: sepY - 6, 'font-size': 10, fill: '#536471' }, [document.createTextNode('Engagement events (radius ∝ count)')]));

  // Lanes
  const laneTop = PAD.t + curveH + PAD.bCurve;
  const lanes = [
    { key: 'd_likes',    color: '#f91880', symbol: '♥', label: 'likes' },
    { key: 'd_retweets', color: '#00ba7c', symbol: '↻', label: 'retweets' },
    { key: 'd_replies',  color: '#7856ff', symbol: '💬', label: 'replies' },
  ];
  lanes.forEach((lane, idx) => {
    const y = laneTop + idx * PAD.lane;
    svg.appendChild(el('text', { x: 8, y: y + 4, 'font-size': 12, fill: lane.color }, [document.createTextNode(lane.symbol)]));
    svg.appendChild(el('line', { x1: x0, y1: y, x2: x1, y2: y, stroke: '#eff3f4' }));
    for (const s of samples) {
      const d = s[lane.key] || 0;
      if (d <= 0) continue;
      const r = Math.min(14, 3 + Math.log10(d + 1) * 2.5);
      const cx = xScale(s.ts);
      const dot = el('circle', {
        cx, cy: y, r, fill: lane.color,
        'data-ts': s.ts, 'data-key': lane.key, 'data-delta': d, 'data-label': lane.label,
      });
      dot.style.cursor = 'pointer';
      svg.appendChild(dot);
    }
  });

  // Time axis
  svg.appendChild(el('text', { x: x0, y: h - 4, 'font-size': 10, fill: '#536471' }, [document.createTextNode(fmtTime(tMin))]));
  svg.appendChild(el('text', { x: x1, y: h - 4, 'font-size': 10, fill: '#536471', 'text-anchor': 'end' }, [document.createTextNode(fmtTime(tMax))]));

  // Hover line
  const hoverLine = el('line', {
    x1: 0, y1: PAD.t, x2: 0, y2: laneTop + lanes.length * PAD.lane,
    stroke: '#0f1419', 'stroke-width': 1, 'stroke-dasharray': '2,3', opacity: 0,
  });
  svg.appendChild(hoverLine);

  // Tooltip
  const tooltip = document.createElement('div');
  tooltip.className = 'xvm-chart-tip';
  tooltip.style.cssText = 'position:absolute;background:#0f1419;color:#fff;padding:6px 10px;border-radius:4px;font-size:12px;pointer-events:none;display:none;white-space:nowrap;z-index:10;';
  host.style.position = 'relative';
  host.appendChild(svg);
  host.appendChild(tooltip);

  function showTip(x, y, text) {
    tooltip.style.display = 'block';
    tooltip.style.left = (x + 8) + 'px';
    tooltip.style.top = (y - 32) + 'px';
    tooltip.textContent = text;
  }
  function hideTip() { tooltip.style.display = 'none'; hoverLine.setAttribute('opacity', '0'); }

  svg.addEventListener('mouseleave', hideTip);
  svg.addEventListener('mousemove', (ev) => {
    const target = ev.target;
    if (target?.tagName === 'circle') return; // circle handler takes over
    const rect = svg.getBoundingClientRect();
    const x = (ev.clientX - rect.left) * (w / rect.width);
    if (x < x0 || x > x1) { hideTip(); return; }
    const t = tMin + ((x - x0) / (x1 - x0)) * xRange;
    let nearest = samples[0], dMin = Infinity;
    for (const s of samples) { const d = Math.abs(s.ts - t); if (d < dMin) { dMin = d; nearest = s; } }
    const cx = xScale(nearest.ts);
    hoverLine.setAttribute('x1', cx);
    hoverLine.setAttribute('x2', cx);
    hoverLine.setAttribute('opacity', '1');
    showTip(cx, yScale(nearest.impressions),
      `${fmtTime(nearest.ts)} · 👁${formatNumber(nearest.impressions)} ❤${nearest.likes} ↻${nearest.retweets} 💬${nearest.replies}`);
  });

  svg.querySelectorAll('circle').forEach((c) => {
    c.addEventListener('mouseenter', () => {
      const cx = parseFloat(c.getAttribute('cx'));
      const cy = parseFloat(c.getAttribute('cy'));
      const ts = Number(c.getAttribute('data-ts'));
      const delta = c.getAttribute('data-delta');
      const label = c.getAttribute('data-label');
      hoverLine.setAttribute('x1', cx);
      hoverLine.setAttribute('x2', cx);
      hoverLine.setAttribute('opacity', '1');
      showTip(cx, cy, `${fmtTime(ts)} · +${delta} ${label}`);
    });
    c.addEventListener('mouseleave', hideTip);
  });
}

function fmtTime(ts) {
  return new Date(ts).toLocaleString();
}

function formatNumber(n) {
  if (n >= 1_000_000) return (n / 1_000_000).toFixed(1) + 'M';
  if (n >= 1_000) return (n / 1_000).toFixed(1) + 'K';
  return Math.round(n).toString();
}
