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

  it('temporarily expanded edge-hidden panels re-hide on outside pointerdown', () => {
    expect(contentJs).toContain('let leaderboardTempExpandedEdge = null');
    expect(contentJs).toContain('function armLeaderboardTempExpand(edge)');
    expect(contentJs).toContain("document.addEventListener('pointerdown', onLeaderboardTempExpandOutsidePointerDown, true)");
    expect(contentJs).toContain('function onLeaderboardTempExpandOutsidePointerDown(e)');
    expect(contentJs).toContain('leaderboardEl?.contains?.(target) || leaderboardSettingsEl?.contains?.(target)');
    expect(contentJs).toContain('setLeaderboardEdgeHidden(true, edge)');
  });

  it('arms temporary expand when a hidden leaderboard is clicked open', () => {
    const installer = contentJs.match(/function installLeaderboardEdgeToggle\(\) \{[\s\S]*?function installLeaderboardPanelActions/)?.[0] || '';
    expect(installer).toContain('const hiddenEdge = leaderboardHiddenEdge');
    expect(installer).toContain('armLeaderboardTempExpand(hiddenEdge)');
  });

  it('persists and restores the hidden edge across page refreshes', () => {
    expect(contentJs).toContain('function savedLeaderboardPosition()');
    expect(contentJs).toContain('hiddenEdge: leaderboardHiddenEdge || null');
    expect(contentJs).toContain('expandedPos: expanded || null');
    expect(contentJs).toContain('function syncLeaderboardHiddenDom()');
    expect(contentJs).toContain('function restoreLeaderboardPosition(pos)');
    expect(contentJs).toContain('isLeaderboardEdge(pos.hiddenEdge)');
    expect(contentJs).toContain("leaderboardEl.classList.add('xvm-lb-edge-hidden')");
    expect(contentJs).toContain('leaderboardEl.dataset.edge = leaderboardHiddenEdge');
    expect(contentJs).toContain('syncLeaderboardHiddenDom();');
    expect(contentJs).toContain('restoreLeaderboardPosition(event.data.pos)');
    expect(contentJs).toContain('setLeaderboardEdgeHidden(true, edge)');
    expect(contentJs).toContain('saveLeaderboardPosition();');
  });
});
