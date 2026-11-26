/**
 * Caret / selection edge side for inline virtual blocks (inlay hint, ghost text, swatch).
 *   npx tsx tests/virtual-side.test.mts
 */
import assert from 'node:assert/strict';
import { virtualAdvanceBeforeColumn, virtualSideAtX, type InlineVirtualElement } from '../src/common/virtualText';

const CW = 10;
const measure = (_line: string, col: number) => (col - 1) * CW;
const inlay: InlineVirtualElement = { column: 5, order: 1, widthPx: 60, kind: 'inlay' };
const ghost: InlineVirtualElement = { column: 5, order: 2, widthPx: 100, kind: 'ghost' };

// Legacy boolean behaviour is unchanged.
assert.equal(virtualAdvanceBeforeColumn([inlay], 5), 60);
assert.equal(virtualAdvanceBeforeColumn([inlay], 5, false), 60); // inlay: caret already after the chip
assert.equal(virtualAdvanceBeforeColumn([ghost], 5, false), 0); // ghost: caret before it
assert.equal(virtualAdvanceBeforeColumn([ghost], 5, true), 100);
assert.equal(virtualAdvanceBeforeColumn([inlay], 6, false), 60);

// 'before' / 'after' address the whole block at that column.
assert.equal(virtualAdvanceBeforeColumn([inlay, ghost], 5, 'before'), 0);
assert.equal(virtualAdvanceBeforeColumn([inlay, ghost], 5, 'after'), 160);
assert.equal(virtualAdvanceBeforeColumn([inlay], 5, 'before'), 0);
assert.equal(virtualAdvanceBeforeColumn([inlay], 5, 'after'), 60);
// Earlier blocks always count; later columns are not affected by the side.
assert.equal(virtualAdvanceBeforeColumn([inlay], 7, 'before'), 60);

// Side from pointer x: block spans x = 40 .. 100 (real col 5 at 40, width 60).
const side = (x: number, els = [inlay]) => virtualSideAtX('abcdefgh', x, els, 5, measure);
assert.equal(side(41), 'before');
assert.equal(side(69), 'before');
assert.equal(side(70), 'after'); // midpoint -> after
assert.equal(side(99), 'after');
assert.equal(side(130), 'after'); // past the block, still this column (ghost at line end)
assert.equal(side(0), 'before');
// Ghost + inlay form ONE block (160 wide): midpoint at 40 + 80.
assert.equal(side(119, [inlay, ghost]), 'before');
assert.equal(side(120, [inlay, ghost]), 'after');
// No block at the column -> undefined.
assert.equal(virtualSideAtX('abcdefgh', 50, [inlay], 3, measure), undefined);
assert.equal(virtualSideAtX('abcdefgh', 50, [], 5, measure), undefined);

console.log('All virtual-side tests passed.');
