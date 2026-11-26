/**
 * Popup placement: shift left before shrinking (hover + signature help).
 *   npx tsx tests/popup-placement.test.mts
 */
import assert from 'node:assert/strict';
import { capPopupMaxWidth, placePopupHorizontal } from '../src/common/util/popupPlacement';

const H = 628;
const M = 6;

// 1) Plenty of room: placed at the anchor, natural width.
{
  const r = placePopupHorizontal({ anchorX: 100, naturalWidth: 300, hostWidth: H });
  assert.deepEqual(r, { left: 100, width: 300, shrunk: false });
}
// 2) Near the right edge: shifts left, width stays natural (the reported bug: it shrank to ~97px).
for (const ax of [330, 400, 560, 620, 5000]) {
  const r = placePopupHorizontal({ anchorX: ax, naturalWidth: 460, hostWidth: H });
  assert.equal(r.width, 460, `width must stay natural at anchor ${ax}`);
  assert.equal(r.shrunk, false);
  assert.ok(r.left >= M && r.left + r.width <= H - M, `fits at anchor ${ax}`);
}
assert.equal(placePopupHorizontal({ anchorX: 620, naturalWidth: 460, hostWidth: H }).left, H - M - 460);
// 3) Left edge clamp.
assert.equal(placePopupHorizontal({ anchorX: -40, naturalWidth: 200, hostWidth: H }).left, M);
// 4) Only when it cannot fit anywhere does it shrink, to the available room.
{
  const r = placePopupHorizontal({ anchorX: 300, naturalWidth: 900, hostWidth: H });
  assert.equal(r.shrunk, true);
  assert.equal(r.width, H - 2 * M);
  assert.equal(r.left, M);
}
// 5) Width is independent of the anchor whenever it fits.
const widths = new Set([0, 200, 400, 600].map((a) => placePopupHorizontal({ anchorX: a, naturalWidth: 340, hostWidth: H }).width));
assert.equal(widths.size, 1);
// 6) Tiny / zero host does not throw or return NaN.
{
  const r = placePopupHorizontal({ anchorX: 10, naturalWidth: 300, hostWidth: 0 });
  assert.ok(Number.isFinite(r.left) && r.width >= 1);
}
// 7) Percentage cap first (70% of host), then the configured px width: the smaller wins.
assert.equal(capPopupMaxWidth(460, 360), 252); // phone: 70% of 360
assert.equal(capPopupMaxWidth(460, 1000), 460); // desktop: px width wins
assert.equal(capPopupMaxWidth(340, 400), 280);
assert.equal(capPopupMaxWidth(460, 0), 420); // unknown host -> 600 * 0.7
{
  const cap = capPopupMaxWidth(460, 360);
  const r = placePopupHorizontal({ anchorX: 350, naturalWidth: cap, hostWidth: 360 });
  assert.equal(r.shrunk, false);
  assert.ok(r.width <= 252);
}
console.log('All popup-placement tests passed.');
