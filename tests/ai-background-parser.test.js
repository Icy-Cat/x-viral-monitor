import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import vm from 'node:vm';

const here = dirname(fileURLToPath(import.meta.url));
const repo = resolve(here, '..');
const backgroundJs = readFileSync(resolve(repo, 'background.js'), 'utf8');

function loadBackgroundDebug(fetchImpl = async () => ({ ok: true, json: async () => ({}) })) {
  const context = {
    chrome: {
      runtime: { onMessage: { addListener() {} } },
      storage: {
        sync: { get: async () => ({}) },
        local: { get: async () => ({}) },
      },
    },
    fetch: fetchImpl,
    URL,
    AbortController,
    TextDecoder,
    setTimeout,
    clearTimeout,
    console,
  };
  vm.createContext(context);
  vm.runInContext(backgroundJs, context);
  return context;
}

describe('AI background comment parser', () => {
  it('splits a single code block that contains multiple line-based candidates', () => {
    const { extractComments } = loadBackgroundDebug();
    const raw = '```\n这个兔子看着就很好聊\n她是不是也愣了一下\n你俩座位连一起，缘分啊\n兔子是她的吉祥物吗\n一会儿问问是不是自己缝的\n这兔子表情有点嚣张\n感觉她也是个有趣的人\n起飞前先酝酿一下话题\n兔子耳朵这么长，能聊很久\n说不定她会主动跟你讲兔子的故事\n```';

    expect(extractComments(raw, 10)).toEqual([
      '这个兔子看着就很好聊',
      '她是不是也愣了一下',
      '你俩座位连一起，缘分啊',
      '兔子是她的吉祥物吗',
      '一会儿问问是不是自己缝的',
      '这兔子表情有点嚣张',
      '感觉她也是个有趣的人',
      '起飞前先酝酿一下话题',
      '兔子耳朵这么长，能聊很久',
      '说不定她会主动跟你讲兔子的故事',
    ]);
  });

  it('streams OpenAI-compatible chunks and emits parsed progress', async () => {
    const encoder = new TextEncoder();
    const chunks = [
      'data: {"choices":[{"delta":{"content":"```\\n这个兔子看着就很好聊\\n她是不是也愣了一下\\n"}}]}\n\n',
      'data: {"choices":[{"delta":{"content":"你俩座位连一起，缘分啊\\n兔子是她的吉祥物吗\\n一会儿问问是不是自己缝的\\n"}}]}\n\n',
      'data: {"choices":[{"delta":{"content":"这兔子表情有点嚣张\\n感觉她也是个有趣的人\\n起飞前先酝酿一下话题\\n兔子耳朵这么长，能聊很久\\n说不定她会主动跟你讲兔子的故事\\n```"}}]}\n\n',
      'data: [DONE]\n\n',
    ];
    const stream = new ReadableStream({
      start(controller) {
        for (const chunk of chunks) controller.enqueue(encoder.encode(chunk));
        controller.close();
      },
    });
    const context = loadBackgroundDebug(async () => ({ ok: true, body: stream }));
    const progress = [];

    const comments = await context.generateWithOpenAICompatible({
      provider: 'openai-compatible',
      platform: 'deepseek',
      baseUrl: 'https://api.deepseek.com',
      model: 'deepseek-chat',
      replyCount: 10,
      apiKey: 'test-key',
    }, {
      tweetText: 'tweet',
      promptTemplate: '[推文内容]',
    }, (items) => progress.push(items));

    expect(comments).toHaveLength(10);
    expect(progress.length).toBeGreaterThan(0);
    expect(progress.at(-1)).toHaveLength(10);
  });
});
