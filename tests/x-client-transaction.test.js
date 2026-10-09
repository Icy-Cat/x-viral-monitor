import { describe, it, expect, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

const src = readFileSync(new URL('../lib/x-client-transaction.js', import.meta.url), 'utf8');
const homeHtml = '59924:"ondemand.s",59924:"26791a5c30a3bd19"';

function loadXct({ failPrime = false, missingVerification = false, modules = ['564498'] } = {}) {
  class Node {
    constructor(tag) { this.tag = tag; this.children = []; this.id = ''; this.attrs = {}; }
    appendChild(node) { this.children.push(node); node.parent = this; return node; }
    setAttribute(key, value) { this.attrs[key] = value; }
    getAttribute(key) { return this.attrs[key] ?? null; }
    removeAttribute(key) { delete this.attrs[key]; }
    remove() { if (this.parent) this.parent.children = this.parent.children.filter((n) => n !== this); }
    querySelectorAll(selector) {
      const all = this.children.flatMap((node) => [node, ...node.querySelectorAll('*')]);
      return selector === '*' ? all : all.filter((n) => selector === 'path' ? n.tag === 'path' : n.id.startsWith('loading-x-anim-'));
    }
  }
  const body = new Node('body');
  const original = body.appendChild(new Node('svg'));
  original.id = 'loading-x-anim-0';
  const verification = { getAttribute: () => missingVerification ? null : 'test-verification' };
  const document = {
    body,
    createElement: (tag) => new Node(tag),
    createElementNS: (_ns, tag) => new Node(tag),
    querySelector: () => verification,
    querySelectorAll: (selector) => body.querySelectorAll(selector),
  };
  const frames = Array.from({ length: 4 }, () => {
    const svg = new Node('svg');
    for (let i = 0; i < 2; i++) svg.appendChild(new Node('path')).setAttribute('d', 'M 0,0 C 1,2 3,4');
    svg.setAttribute('onload', 'must not be copied');
    svg.setAttribute('class', 'r-16n140');
    return svg;
  });
  const generate = vi.fn((path, method) => {
    if (generate.mock.calls.length === 1) {
      expect(document.querySelectorAll('[id^="loading-x-anim-"]')).toHaveLength(4);
      expect(original.id).toBe('xvm-saved-frame-0');
      const frames = document.querySelectorAll('[id^="loading-x-anim-"]');
      expect(frames.every((n) => n.getAttribute('class') === 'r-16n140')).toBe(true);
      expect(frames.every((n) => n.getAttribute('onload') === null)).toBe(true);
      if (failPrime) throw new Error('native animation failed');
    }
    return Promise.resolve(`native:${method}:${path}`);
  });
  const chunks = [];
  chunks.push = function (entry) {
    Array.prototype.push.call(this, entry);
    entry[2]?.(runtime);
    return this.length;
  };
  const runtime = vi.fn(() => ({ default: () => generate }));
  runtime.e = vi.fn(async (id) => chunks.push([[id], Object.fromEntries(modules.map((id) => [id, () => {}]))]));
  const fetch = vi.fn(async () => ({ ok: true, text: async () => homeHtml }));
  const win = { webpackChunk_twitter_responsive_web: chunks, __xvmNet: { originalFetch: fetch } };
  vm.runInNewContext(src, {
    window: win, document, AbortController, setTimeout, clearTimeout,
    crypto: { randomUUID: () => 'test-id' },
    DOMParser: class { parseFromString() { return {
      querySelector: () => ({ getAttribute: () => 'fresh-home-verification' }),
      querySelectorAll: () => frames,
    }; } },
  });
  return { api: win.__xvmXct, runtime, generate, fetch, original, body, chunks };
}

describe('native X transaction generator', () => {
  it('loads the current chunk with its 16-character hash through X, then signs the actual method/path', async () => {
    const { api, runtime, generate, original, body, chunks } = loadXct();
    await expect(api.generateTxId('POST', '/2/grok/add_response.json')).resolves.toBe('native:POST:/2/grok/add_response.json');
    expect(runtime.e).toHaveBeenCalledWith(59924);
    expect(runtime).toHaveBeenCalledWith('564498');
    expect(generate).toHaveBeenLastCalledWith('/2/grok/add_response.json', 'POST');
    expect(original.id).toBe('loading-x-anim-0');
    expect(body.children).toEqual([original]);
    expect(chunks).toHaveLength(1); // synthetic runtime entry removed
  });

  it('shares one initialization across concurrent requests, and reset rebuilds', async () => {
    const { api, fetch, generate } = loadXct();
    await Promise.all([api.generateTxId('GET', '/one'), api.generateTxId('POST', '/two')]);
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(generate).toHaveBeenCalledWith('/one', 'GET');
    expect(generate).toHaveBeenCalledWith('/two', 'POST');
    api.reset();
    await api.ensureReady();
    expect(fetch).toHaveBeenCalledTimes(2);
  });

  it('restores the page and allows retry when native initialization throws', async () => {
    const { api, original, body, fetch } = loadXct({ failPrime: true });
    await expect(api.ensureReady()).rejects.toThrow('native animation failed');
    expect(original.id).toBe('loading-x-anim-0');
    expect(body.children).toEqual([original]);
    await expect(api.ensureReady()).resolves.toBeTypeOf('function');
    expect(fetch).toHaveBeenCalledTimes(2);
  });

  it('rejects a page without its verification context rather than emitting an invalid signature', async () => {
    const { api, body } = loadXct({ missingVerification: true });
    await expect(api.ensureReady()).rejects.toThrow('X page context changed');
    expect(body.children).toHaveLength(1);
  });

  it('rejects an ambiguous module layout without executing arbitrary factories', async () => {
    const { api, runtime } = loadXct({ modules: ['111', '222'] });
    await expect(api.ensureReady()).rejects.toThrow('unsupported X transaction module layout');
    expect(runtime).not.toHaveBeenCalled();
  });
});
