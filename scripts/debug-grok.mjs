import { chromium } from 'playwright';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const outDir = path.join(root, '.tmp', 'grok-debug');
const profileDir = path.join(root, '.tmp', 'pw-x-profile');
const extensionDir = root;

await mkdir(outDir, { recursive: true });

const context = await chromium.launchPersistentContext(profileDir, {
  channel: process.env.PW_CHROME_CHANNEL || 'chrome',
  headless: false,
  viewport: { width: 1360, height: 900 },
  args: [
    `--disable-extensions-except=${extensionDir}`,
    `--load-extension=${extensionDir}`,
  ],
});

const page = context.pages()[0] || await context.newPage();
const captures = [];

function sanitizeHeaders(headers) {
  const allow = ['authorization', 'x-csrf-token', 'x-twitter-active-user', 'x-twitter-auth-type', 'x-twitter-client-language', 'x-client-transaction-id', 'x-xai-request-id', 'content-type'];
  const out = {};
  for (const key of allow) {
    if (headers[key]) out[key] = key === 'authorization' ? headers[key].slice(0, 32) + '...' : headers[key];
  }
  return out;
}

function looksLikeGrok(url) {
  return /\/i\/api\/(?:graphql\/[^/]+\/[^/?]*grok[^/?]*|grok\b)/i.test(url)
    || /grok\.x\.com\/\d+\/grok\//i.test(url)
    || /\/i\/api\/graphql\//.test(url);
}

page.on('request', async (request) => {
  const url = request.url();
  if (!looksLikeGrok(url)) return;
  const body = request.postData() || '';
  if (!/(?:\/i\/api\/(?:graphql\/[^/]+\/[^/?]*grok[^/?]*|grok\b)|grok\.x\.com\/\d+\/grok\/)/i.test(url) && !/"(?:message|prompt|query|input|text|content)"\s*:/.test(body)) return;
  const record = {
    at: new Date().toISOString(),
    method: request.method(),
    url,
    headers: sanitizeHeaders(request.headers()),
    bodyPreview: body.slice(0, 2000),
  };
  captures.push(record);
  console.log('\n[GROK REQUEST]', JSON.stringify(record, null, 2));
  await writeFile(path.join(outDir, 'requests.json'), JSON.stringify(captures, null, 2), 'utf8');
});

page.on('response', async (response) => {
  const url = response.url();
  if (!looksLikeGrok(url)) return;
  console.log('[GROK RESPONSE]', response.status(), url);
});

await page.goto('https://x.com/i/grok', { waitUntil: 'domcontentloaded' });
console.log('\nOpened x.com/i/grok with extension loaded.');
console.log('If X asks you to log in, complete login in the browser.');
console.log('Send any short Grok message once; matching requests will be printed and saved under .tmp/grok-debug/requests.json.');
console.log('Press Ctrl+C in this terminal when finished.');
