import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const contentJs = readFileSync(resolve(process.cwd(), 'content.js'), 'utf8');
const bridgeJs = readFileSync(resolve(process.cwd(), 'bridge.js'), 'utf8');

function extractAiResultListener(source) {
  const marker = "event.data?.type === 'XVM_AI_GENERATE_PROGRESS'";
  const idx = source.indexOf(marker);
  expect(idx).toBeGreaterThan(-1);
  // Walk back to the enclosing addEventListener('message'
  const start = source.lastIndexOf("window.addEventListener('message'", idx);
  const end = source.indexOf('});', idx) + 3;
  return source.slice(start, end);
}

describe('AI window message hardening', () => {
  it('requires same-window source, same origin, and a pending requestId for AI progress/result', () => {
    const listener = extractAiResultListener(contentJs);
    expect(listener).toContain('event.source !== window');
    expect(listener).toContain('event.origin !== window.location.origin');
    expect(listener).toContain('aiPendingRequests.get(event.data.requestId)');
    expect(listener).toContain('aiPendingRequests.get(requestId)');
    // Document why Orbis #23 one-liner alone is insufficient:
    // same-page scripts share location.origin, so origin check without
    // pending-map gating cannot stop same-page spoofed RESULT/PROGRESS.
    expect(listener).toMatch(/same-page spoof|aiPendingRequests/);
  });

  it('gates AI settings load on origin as well as source', () => {
    const idx = contentJs.indexOf("event.data?.type !== 'XVM_GROK_SETTINGS_LOAD'");
    expect(idx).toBeGreaterThan(-1);
    const start = contentJs.lastIndexOf("window.addEventListener('message'", idx);
    const block = contentJs.slice(start, idx);
    expect(block).toContain('event.source !== window');
    expect(block).toContain('event.origin !== window.location.origin');
  });

  it('bridge AI ingress also requires origin (Orbis one-liner was incomplete)', () => {
    const idx = bridgeJs.indexOf("type === 'XVM_AI_GENERATE'");
    expect(idx).toBeGreaterThan(-1);
    const start = bridgeJs.lastIndexOf("window.addEventListener('message'", idx);
    const head = bridgeJs.slice(start, start + 350);
    expect(head).toContain('event.source !== window');
    expect(head).toContain('event.origin !== window.location.origin');
  });
});
