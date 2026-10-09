import { describe, it, expect, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

const backgroundSrc = readFileSync(new URL('../background.js', import.meta.url), 'utf8');
const contentSrc = readFileSync(new URL('../content.js', import.meta.url), 'utf8');

function background({ tabs = [{ id: 7 }], reply, disconnect = false } = {}) {
  let handler;
  const sendMessage = vi.fn(async () => {
    if (disconnect) throw new Error('No receiving end');
    return reply;
  });
  vm.runInNewContext(backgroundSrc, {
    chrome: {
      runtime: { onMessage: { addListener: (fn) => { handler = fn; } } },
      storage: { sync: { get: async () => ({ aiProvider: 'x-grok' }) }, local: { get: async () => ({}) } },
      tabs: { query: async () => tabs, sendMessage },
    },
    console, URL, AbortController, TextDecoder, setTimeout, clearTimeout,
  });
  return {
    sendMessage,
    check: () => new Promise((resolve) => handler({ type: 'XVM_AI_TEST_CONNECTION' }, {}, resolve)),
  };
}

describe('Grok popup readiness routing', () => {
  it('forwards the actual X page check instead of reporting unconditional success', async () => {
    const result = { ok: true, message: '签名就绪，未验证生成接口' };
    const api = background({ reply: result });
    await expect(api.check()).resolves.toEqual(result);
    expect(api.sendMessage).toHaveBeenCalledWith(7, { type: 'XVM_GROK_CHECK' });
  });

  it('preserves the page initialization failure', async () => {
    const result = { ok: false, error: 'Grok 签名初始化失败：X module missing' };
    await expect(background({ reply: result }).check()).resolves.toEqual(result);
  });

  it('reports a non-X or stale tab instead of a healthy connection', async () => {
    const result = await background({ disconnect: true }).check();
    expect(result.ok).toBe(false);
    expect(result.error).toContain('切换到 X 页面并刷新');
  });

  it('does not succeed without an active tab or a check response', async () => {
    expect((await background({ tabs: [] }).check()).ok).toBe(false);
    expect((await background().check()).ok).toBe(false);
  });
});

describe('AI error toast', () => {
  it('renders the real failure as text without sending a Grok message or interpreting HTML', () => {
    const nodes = [];
    const makeNode = () => ({ style: {}, children: [], classList: { add() {} }, append(...children) { this.children.push(...children); } });
    const document = {
      createElement: makeNode,
      body: { appendChild: (node) => nodes.push(node) },
    };
    const start = contentSrc.indexOf('function showGrokErrorToast(');
    const end = contentSrc.indexOf('function getSelectedGrokPromptTemplate()', start);
    const ctx = { document, requestAnimationFrame: (fn) => fn(), setTimeout() {}, dismissToast() {} };
    vm.runInNewContext(contentSrc.slice(start, end), ctx);
    ctx.showGrokErrorToast('<img src=x onerror=alert(1)> HTTP 429');
    expect(nodes[0].children[0].textContent).toBe('⚠ AI 生成失败');
    expect(nodes[0].children[1].textContent).toBe('<img src=x onerror=alert(1)> HTTP 429');
    expect(nodes[0].innerHTML).toBeUndefined();
  });
});
