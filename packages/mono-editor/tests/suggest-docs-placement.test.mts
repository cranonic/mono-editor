import assert from 'node:assert/strict';
import { placeSuggestDocs } from '../src/common/util/suggestDocsPlacement';
import { POPUP_MAX_WIDTH_RATIO } from '../src/common/util/popupPlacement';

function overlaps(
  a: { left: number; top: number; right: number; bottom: number },
  b: { left: number; top: number; right: number; bottom: number },
): boolean {
  return a.left < b.right && a.right > b.left && a.top < b.bottom && a.bottom > b.top;
}

// 1. Room to the right of completion list -> places 'right'
{
  const listRect = { left: 40, top: 140, width: 220, height: 150 };
  const caretLine = { top: 116, bottom: 138 };
  const hostSize = { width: 800, height: 480 };
  const res = placeSuggestDocs({
    listRect,
    caretLine,
    naturalSize: { width: 260, height: 120 },
    hostSize,
  });
  assert.ok(res);
  assert.equal(res.placement, 'right', 'prefers right of completion list when room exists');
  assert.ok(res.left >= listRect.left + listRect.width, 'docs sit strictly right of list');
  assert.ok(res.width <= Math.floor(hostSize.width * POPUP_MAX_WIDTH_RATIO), 'respects 70% width cap');
}

// 2. No room right, room above cursor line -> places 'above' cursor line (not covering caret or list)
{
  const listRect = { left: 10, top: 180, width: 240, height: 150 };
  const caretLine = { top: 154, bottom: 176 };
  const hostSize = { width: 360, height: 480 };
  const res = placeSuggestDocs({
    listRect,
    caretLine,
    naturalSize: { width: 240, height: 100 },
    hostSize,
  });
  assert.ok(res);
  assert.equal(res.placement, 'above', 'falls back to above cursor line when no room on right');
  assert.ok(res.top + res.maxHeight <= caretLine.top, 'stays strictly above caret line');
  assert.ok(res.width <= Math.floor(hostSize.width * POPUP_MAX_WIDTH_RATIO), 'never exceeds 70% of host width');
}

// 3. No room right AND no room above cursor line -> falls back to 'below' completion list
{
  const listRect = { left: 12, top: 44, width: 240, height: 150 };
  const caretLine = { top: 18, bottom: 40 };
  const hostSize = { width: 360, height: 480 };
  const res = placeSuggestDocs({
    listRect,
    caretLine,
    naturalSize: { width: 240, height: 100 },
    hostSize,
  });
  assert.ok(res);
  assert.equal(res.placement, 'below', 'falls back to below completion list when neither right nor above fits');
  assert.ok(res.top >= listRect.top + listRect.height, 'stays strictly below completion list');
  assert.ok(res.width <= Math.floor(hostSize.width * POPUP_MAX_WIDTH_RATIO), 'never exceeds 70% of host width');
}

// 4. Shift-left-before-shrink when placed above/below near right edge
{
  const listRect = { left: 300, top: 180, width: 180, height: 140 };
  const caretLine = { top: 154, bottom: 176 };
  const hostSize = { width: 500, height: 480 };
  // Right room = 500 - 4 - (300+180+4) = 12px -> cannot fit right -> goes 'above'
  // Natural width 260 <= 70% of 500 (350): must keep 260px and shift left instead of shrinking!
  const res = placeSuggestDocs({
    listRect,
    caretLine,
    naturalSize: { width: 260, height: 90 },
    hostSize,
  });
  assert.ok(res);
  assert.equal(res.placement, 'above');
  assert.equal(res.width, 260, 'keeps natural width by shifting left instead of shrinking');
  assert.ok(res.left < listRect.left, 'shifted left from listRect.left');
  assert.ok(res.left + res.width <= hostSize.width - 4, 'fits inside right edge');
}

// 5. Never covers list or caret line across narrow & wide matrix (including list placed above caret)
{
  const cases = [
    { hostW: 320, hostH: 480, caret: { top: 20, bottom: 42 }, list: { left: 8, top: 44, width: 220, height: 140 } },
    { hostW: 320, hostH: 480, caret: { top: 200, bottom: 222 }, list: { left: 8, top: 224, width: 220, height: 140 } },
    { hostW: 320, hostH: 480, caret: { top: 360, bottom: 382 }, list: { left: 8, top: 210, width: 220, height: 146 } },
    { hostW: 900, hostH: 500, caret: { top: 120, bottom: 142 }, list: { left: 660, top: 144, width: 220, height: 150 } },
  ];
  for (const c of cases) {
    const res = placeSuggestDocs({
      listRect: c.list,
      caretLine: c.caret,
      naturalSize: { width: 280, height: 110 },
      hostSize: { width: c.hostW, height: c.hostH },
    });
    assert.ok(res, `placement succeeds for ${JSON.stringify(c)}`);
    const docBox = { left: res.left, top: res.top, right: res.left + res.width, bottom: res.top + res.maxHeight };
    const listBox = { left: c.list.left, top: c.list.top, right: c.list.left + c.list.width, bottom: c.list.top + c.list.height };
    const caretBox = { left: 0, top: c.caret.top, right: c.hostW, bottom: c.caret.bottom };
    assert.equal(overlaps(docBox, listBox), false, 'docs never overlap completion list');
    assert.equal(overlaps(docBox, caretBox), false, 'docs never overlap caret line');
    assert.ok(res.width <= Math.floor(c.hostW * POPUP_MAX_WIDTH_RATIO), 'docs width <= 70% of host');
  }
}

console.log('suggest-docs-placement tests passed');
