// Replay buffer cold-start race coverage. content scripts boot at
// document_start but X's preflight fetches can resolve before our IIFEs
// finish registering onResponse. The buffer in x-net-hook.js replays
// recent matched responses to late subscribers so they don't miss them.

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import vm from 'node:vm';

const here = dirname(fileURLToPath(import.meta.url));
const repo = resolve(here, '..');
const hookSource = readFileSync(resolve(repo, 'lib/x-net-hook.js'), 'utf8');

function makeFakeResponse(url) {
  const r = {
    status: 200,
    statusText: 'OK',
    headers: new Headers({ 'content-type': 'application/json' }),
    json: async () => ({ url, payload: 'ok' }),
    text: async () => JSON.stringify({ url, payload: 'ok' }),
  };
  r.clone = () => makeFakeResponse(url);
  return r;
}

function loadHook() {
  const fetchCalls = [];
  const fakeWindow = {
    fetch: async (url) => {
      fetchCalls.push(url);
      return makeFakeResponse(url);
    },
    addEventListener() {},
  };
  class FakeXHR {
    constructor() {
      this.listeners = {};
      this.responseType = '';
      this.responseText = JSON.stringify({ payload: 'ok' });
      this.status = 200;
      this.readyState = 0;
    }
    open() {}
    setRequestHeader() {}
    send() {
      this.readyState = 4;
      for (const fn of this.listeners.readystatechange || []) fn.call(this);
      for (const fn of this.listeners.load || []) fn.call(this);
    }
    addEventListener(type, fn) {
      (this.listeners[type] ||= []).push(fn);
    }
    getResponseHeader() { return null; }
  }
  FakeXHR.prototype.open = function () {};
  FakeXHR.prototype.setRequestHeader = function () {};
  const ctx = {
    window: fakeWindow,
    XMLHttpRequest: FakeXHR,
    Request: class {},
    URL,
    Headers,
    Response,
    console,
    setTimeout,
  };
  vm.runInNewContext(hookSource, ctx);
  return { net: ctx.window.__xvmNet, win: ctx.window, XHR: ctx.XMLHttpRequest, fetchCalls };
}

describe('x-net-hook response replay buffer', () => {
  it('replays a recent matching response to a late onResponse subscriber', async () => {
    const { net, win } = loadHook();
    const URL = 'https://x.com/i/api/graphql/abc/HomeTimeline?variables=...';
    // Burst BEFORE the subscriber registers (cold-start simulation).
    await win.fetch(URL);

    const seen = [];
    net.onResponse(/HomeTimeline/, ({ url }) => seen.push(url));

    expect(seen).toEqual([URL]);
  });

  it('replayed fetch response is still clone()-able from the subscriber', async () => {
    const { net, win } = loadHook();
    const URL = 'https://x.com/i/api/graphql/abc/ListLatestTweetsTimeline?x=1';
    await win.fetch(URL);

    let done;
    const handled = new Promise((r) => { done = r; });
    net.onResponse(/ListLatestTweetsTimeline/, async ({ response }) => {
      const json = await response.clone().json();
      done(json);
    });
    const json = await handled;
    expect(json).toEqual({ url: URL, payload: 'ok' });
  });

  it('does not replay non-matching responses to a late subscriber', async () => {
    const { net, win } = loadHook();
    await win.fetch('https://x.com/i/api/graphql/abc/HomeTimeline');
    await win.fetch('https://example.com/random.json');

    const seen = [];
    net.onResponse(/HomeTimeline/, ({ url }) => seen.push(url));
    expect(seen).toHaveLength(1);
    expect(seen[0]).toContain('HomeTimeline');
  });

  it('still delivers live responses to subscribers registered BEFORE the fetch', async () => {
    const { net, win } = loadHook();
    const seen = [];
    net.onResponse(/HomeTimeline/, ({ url }) => seen.push(url));
    await win.fetch('https://x.com/i/api/graphql/abc/HomeTimeline');
    expect(seen).toHaveLength(1);
  });

  it('source field encodes fetch vs xhr', async () => {
    const { net, win } = loadHook();
    await win.fetch('https://x.com/i/api/graphql/abc/HomeTimeline');
    const sources = [];
    net.onResponse(/HomeTimeline/, ({ source }) => sources.push(source));
    expect(sources).toEqual(['fetch']);
  });

  it('lets a fetch response patcher replace JSON before the caller receives it', async () => {
    const { net, win } = loadHook();
    net.onResponsePatch(/HomeTimeline/, ({ json }) => ({ ...json, patched: true }));

    const res = await win.fetch('https://x.com/i/api/graphql/abc/HomeTimeline');
    expect(await res.json()).toEqual({
      url: 'https://x.com/i/api/graphql/abc/HomeTimeline',
      payload: 'ok',
      patched: true,
    });
  });

  it('lets an XHR response patcher replace JSON before the caller receives it', () => {
    const { net, XHR } = loadHook();
    net.onResponsePatch(/HomeTimeline/, ({ json }) => ({ ...json, patched: true }));

    const xhr = new XHR();
    xhr.open('POST', 'https://x.com/i/api/graphql/abc/HomeTimeline');
    xhr.send();

    expect(JSON.parse(xhr.responseText)).toEqual({ payload: 'ok', patched: true });
    expect(JSON.parse(xhr.response)).toEqual({ payload: 'ok', patched: true });
  });
});
