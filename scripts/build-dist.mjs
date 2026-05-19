#!/usr/bin/env node
// Sync the loadable extension source tree to ./dist for quick bb-browser
// reloads. Run after any source change; bb-browser users keep the same
// "Load unpacked → dist/" mapping and just click "Reload" in chrome.
//
// Usage: node scripts/build-dist.mjs

import { rmSync, mkdirSync, cpSync, existsSync, statSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const dist = resolve(root, 'dist');

// Same canonical 18-file shipping set used by the v1.6.13 release zip,
// plus the M1 premium tree under src/.
const ITEMS = [
  '_locales',
  'icons',
  'lib',
  'src',
  'bridge.js',
  'content.js',
  'manifest.json',
  'popup.html',
  'popup.js',
  'popup-dashboard.js', // mock A tab router (also handles theme + nav events)
  'starchart.js',
  'styles.css',
];

function main() {
  if (existsSync(dist)) rmSync(dist, { recursive: true, force: true });
  mkdirSync(dist, { recursive: true });

  let copied = 0;
  for (const item of ITEMS) {
    const src = resolve(root, item);
    const dst = resolve(dist, item);
    if (!existsSync(src)) {
      console.warn(`[build-dist] skip missing: ${item}`);
      continue;
    }
    const st = statSync(src);
    if (st.isDirectory()) {
      cpSync(src, dst, { recursive: true });
    } else {
      cpSync(src, dst);
    }
    copied += 1;
  }
  console.log(`[build-dist] synced ${copied} entries to dist/`);
  console.log(`[build-dist] chrome → load unpacked → ${dist}`);
}

main();
