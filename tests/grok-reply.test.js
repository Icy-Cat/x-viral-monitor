import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

// lib/grok-reply.js is an IIFE that attaches its API to `window.__xvmGrok`
// (content-script style, no native module support). Load + run it in a vm
// sandbox with mocked browser globals to test the pure helpers.
const src = readFileSync(new URL('../lib/grok-reply.js', import.meta.url), 'utf8');

function loadGrok() {
  const win = {
    __xvmNet: null,
    __xvmXct: null,
    addEventListener() {},
    postMessage() {},
  };
  const ctx = {
    window: win,
    document: { cookie: '' },
    navigator: { language: 'zh-CN' },
    crypto: { randomUUID: () => 'test-uuid' },
    btoa: (s) => Buffer.from(s, 'binary').toString('base64'),
    atob: (s) => Buffer.from(s, 'base64').toString('binary'),
    console,
  };
  vm.createContext(ctx);
  vm.runInContext(src, ctx);
  return ctx.window.__xvmGrok;
}

const api = loadGrok();

describe('renderPrompt', () => {
  it('substitutes [推文内容] with tweet text', () => {
    expect(api.renderPrompt('hello world', 'before [推文内容] after')).toBe('before hello world after');
  });

  it('replaces every occurrence of the placeholder', () => {
    expect(api.renderPrompt('X', '[推文内容] / [推文内容]')).toBe('X / X');
  });

  it('appends template after tweet when placeholder missing', () => {
    expect(api.renderPrompt('hello', '现在请生成评论')).toBe('hello\n\n现在请生成评论');
  });

  it('falls back to default prompt when template empty', () => {
    const out = api.renderPrompt('hello', '');
    expect(out).toContain('hello');
    expect(out).toContain('为我生成');
  });

  it('trims whitespace from inputs', () => {
    expect(api.renderPrompt('  X  ', '  [推文内容]  ')).toBe('X');
  });
});

describe('extractComments', () => {
  function ndjsonOf(message) {
    return JSON.stringify({ result: { sender: 'ASSISTANT', messageTag: 'final', message } });
  }

  it('extracts code blocks from a single final message', () => {
    const stream = ndjsonOf('intro\n```\nfirst\n```\n```\nsecond\n```\n');
    expect(api.extractComments(stream)).toEqual(['first', 'second']);
  });

  it('joins multiple final messages before splitting blocks', () => {
    const stream = [
      ndjsonOf('```\none'),  // streaming chunk 1
      ndjsonOf('```\n'),     // streaming chunk 2 closes the first block
      ndjsonOf('```\ntwo\n```'),
    ].join('\n');
    expect(api.extractComments(stream)).toEqual(['one', 'two']);
  });

  it('deduplicates identical comments', () => {
    const stream = ndjsonOf('```\nsame\n```\n```\nsame\n```');
    expect(api.extractComments(stream)).toEqual(['same']);
  });

  it('caps result at 10 comments', () => {
    const blocks = Array.from({ length: 15 }, (_, i) => `\`\`\`\nc${i}\n\`\`\``).join('\n');
    expect(api.extractComments(ndjsonOf(blocks))).toHaveLength(10);
  });

  it('falls back to numbered list when no code blocks', () => {
    const stream = ndjsonOf('1. first\n2. second\n3. third');
    expect(api.extractComments(stream)).toEqual(['first', 'second', 'third']);
  });

  it('falls back to bullet list when no code blocks', () => {
    const stream = ndjsonOf('- alpha\n- beta\n- gamma');
    expect(api.extractComments(stream)).toEqual(['alpha', 'beta', 'gamma']);
  });

  it('drops fallback items longer than long-form length cap', () => {
    const longLine = 'x'.repeat(1100);
    const stream = ndjsonOf(`1. short\n2. ${longLine}\n3. also short`);
    expect(api.extractComments(stream)).toEqual(['short', 'also short']);
  });

  it('skips non-final ASSISTANT messages', () => {
    const stream = [
      JSON.stringify({ result: { sender: 'ASSISTANT', messageTag: 'header', message: 'thinking...' } }),
      ndjsonOf('```\nreal\n```'),
    ].join('\n');
    expect(api.extractComments(stream)).toEqual(['real']);
  });

  it('returns empty array for unparseable input', () => {
    expect(api.extractComments('garbage\nmore garbage')).toEqual([]);
  });

  it('handles empty/null input gracefully', () => {
    expect(api.extractComments('')).toEqual([]);
    expect(api.extractComments(null)).toEqual([]);
  });

  it('falls back to paragraph split when no code blocks or list markers (≥3 lines)', () => {
    const stream = ndjsonOf('真不错\n学到了\n这就是高手\nhope helps');
    // 4 lines, last "hope helps" is short tail (≤12) so dropped.
    expect(api.extractComments(stream)).toEqual(['真不错', '学到了', '这就是高手']);
  });

  it('paragraph fallback skips short final lines (sign-offs)', () => {
    const stream = ndjsonOf('first long enough\nsecond long enough\nthird long enough\nthx');
    expect(api.extractComments(stream)).toEqual(['first long enough', 'second long enough', 'third long enough']);
  });

  it('does not emit fallback when fewer than 3 candidates', () => {
    const stream = ndjsonOf('only one\nshort');
    expect(api.extractComments(stream)).toEqual([]);
  });
});

describe('extractFinalText', () => {
  it('concatenates only final-tagged ASSISTANT chunks', () => {
    const stream = [
      JSON.stringify({ result: { sender: 'ASSISTANT', messageTag: 'header', message: 'header ' } }),
      JSON.stringify({ result: { sender: 'ASSISTANT', messageTag: 'final', message: 'one ' } }),
      JSON.stringify({ result: { sender: 'ASSISTANT', messageTag: 'final', message: 'two' } }),
    ].join('\n');
    expect(api.extractFinalText(stream)).toBe('one two');
  });

  it('ignores non-JSON lines', () => {
    const stream = `not json\n${JSON.stringify({ result: { sender: 'ASSISTANT', messageTag: 'final', message: 'ok' } })}\nalso not json`;
    expect(api.extractFinalText(stream)).toBe('ok');
  });
});
