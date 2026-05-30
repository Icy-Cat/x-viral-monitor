import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const repo = resolve(here, '..');
const contentJs = readFileSync(resolve(repo, 'content.js'), 'utf8');

describe('leaderboard edge-hide release behavior', () => {
  it('guards pointer capture calls so release-time hiding is not aborted by NotFoundError', () => {
    expect(contentJs).toContain('function safeSetPointerCapture');
    expect(contentJs).toContain('function safeReleasePointerCapture');
    expect(contentJs).not.toContain('.setPointerCapture?.(');
    expect(contentJs).not.toContain('.releasePointerCapture?.(');
  });

  it('preserves the release-point snap edge across the final drag flush', () => {
    const stopDrag = contentJs.match(/const stopDrag = \(e\) => \{[\s\S]*?document\.addEventListener\('pointerup'/)?.[0] || '';
    expect(stopDrag).toContain('const releaseSnapEdge');
    expect(stopDrag).toContain('releaseSnapEdge || pendingSnapEdge || getLeaderboardSnapEdge');
    expect(stopDrag).toContain('e?.preventDefault?.()');
  });

  it('suppresses the synthetic click after drag-hide so hidden panels do not immediately reopen', () => {
    expect(contentJs).toContain('let suppressLeaderboardEdgeExpandClick = false');
    expect(contentJs).toContain('suppressLeaderboardEdgeExpandClick = true');
    expect(contentJs).toContain('if (suppressLeaderboardEdgeExpandClick)');
    expect(contentJs).toContain('}, true);');
  });
});
