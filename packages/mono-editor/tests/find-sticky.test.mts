/**
 * Find widget × viewport × sticky-scroll regression tests (pure ViewController logic, no DOM).
 *
 *  1) Opening / closing Find (top inset) must not move any line on screen or change the sticky stack
 *  2) The gap above line 1 appears only when the user scrolls to the very top
 *  3) Find next / previous centres a match that is under the Find widget, the sticky stack or the
 *     bottom active-line bar, and leaves already-visible matches alone
 *  4) Clicking a sticky header must not leave that header pinned (also at fractional device pixel ratios)
 *
 * Run:
 *   npx tsx tests/find-sticky.test.mts
 */
import assert from 'node:assert/strict';
import { TextModel } from '../src/common/model/TextModel';
import { SelectionState } from '../src/common/core/SelectionState';
import { ViewController } from '../src/browser/view/ViewController';
import { DEFAULT_THEME } from '../src/index';

const LH = 24;
const PAD = 4;
const VIEW_H = 600;

function sampleCode(lines = 400): string {
  const out = ['// sample'];
  let n = 0;
  while (out.length < lines) {
    n++;
    out.push(`class Service${n} {`);
    for (let m = 1; m <= 4; m++) {
      out.push(`  method${m}(input) {`);
      out.push(`    if (input > ${n * m}) {`);
      out.push('      for (let i = 0; i < input; i++) {');
      out.push(`        console.log("S${n}.m${m}", i);`);
      out.push('      }');
      out.push('    }');
      out.push('    return input;');
      out.push('  }');
    }
    out.push('}');
    out.push('');
  }
  return out.join('\n');
}

function makeView(dpr = 1) {
  (globalThis as any).window = { devicePixelRatio: dpr };
  (globalThis as any).requestAnimationFrame = () => 1;
  (globalThis as any).cancelAnimationFrame = () => {};
  const model = new TextModel(sampleCode());
  const sel = new SelectionState();
  const metrics = {
    fontFamily: 'monospace',
    fontSize: 15,
    lineHeight: LH,
    gutterWidth: 48,
    charWidth: 8,
    paddingLeft: 8,
    paddingTop: PAD,
  };
  const renderer: any = {
    resize() {},
    paint() {},
    measureColumnX: (_l: string, col: number, m: any) => Math.max(0, col - 1) * m.charWidth,
    columnAtX: (line: string, x: number, m: any) => Math.max(1, Math.min(line.length + 1, Math.round(x / m.charWidth) + 1)),
  };
  const view = new ViewController(model, sel, renderer, () => metrics as any, () => DEFAULT_THEME, () => true, 3, null, { enabled: true }, true);
  view.setSize(800, VIEW_H);
  return { view, model, sel };
}

const lineScreenY = (view: ViewController, ln: number) => {
  view.paint();
  return view.screenPosOf(ln, 1).y;
};
const stickyLines = (view: ViewController) => view.lastSticky.map((s) => s.lineNumber);

// ── 1. open / close keeps everything in place ────────────────────────────────
{
  const { view } = makeView();
  for (const scroll of [0, 700, 1500, 3000]) {
    view.setTopInset(0);
    view.scrollTop = scroll;
    view.clampScrollPublic();
    view.paint();
    const probe = Math.floor(view.scrollTop / LH) + 6;
    const y0 = lineScreenY(view, probe);
    const sticky0 = stickyLines(view);

    view.setTopInset(50);
    assert.equal(lineScreenY(view, probe), y0, `open @${scroll}: line must not move`);
    assert.deepEqual(stickyLines(view), sticky0, `open @${scroll}: sticky stack must not change`);

    view.setTopInset(90); // Replace row toggled on
    assert.equal(lineScreenY(view, probe), y0, `resize @${scroll}: line must not move`);

    view.setTopInset(0);
    assert.equal(lineScreenY(view, probe), y0, `close @${scroll}: line must not move`);
    assert.deepEqual(stickyLines(view), sticky0, `close @${scroll}: sticky stack must not change`);
  }
}

// ── 2. the gap above line 1 shows only after scrolling up ────────────────────
{
  const { view } = makeView();
  view.scrollTop = 0;
  view.paint();
  const y1 = lineScreenY(view, 1);
  view.setTopInset(50);
  assert.equal(view.scrollTop, 50, 'opened at the top: scroll shifts by the inset');
  assert.equal(lineScreenY(view, 1), y1, 'line 1 stays where it was');
  view.scrollBy(0, -9999);
  assert.equal(view.scrollTop, 0);
  assert.equal(lineScreenY(view, 1), y1 + 50, 'scrolling up reveals the 50px gap');
  view.setTopInset(0); // closing while inside the gap just clamps at the top
  assert.equal(view.scrollTop, 0);
  assert.equal(lineScreenY(view, 1), y1);
}

// ── 3. Find next / previous reveal ───────────────────────────────────────────
{
  const { view, sel } = makeView();
  view.setTopInset(50);

  const visibleOk = (ln: number) => {
    view.paint();
    const y = view.screenPosOf(ln, 1).y;
    const top = Math.max(view.getTopInset(), view.lastStickyHeight);
    return y >= top - 0.5 && y + LH <= VIEW_H - LH + 0.5 && !view.lastBottomSticky;
  };

  // match on the very last visible row → must be pulled into the comfortable window
  view.scrollTop = 1000;
  view.clampScrollPublic();
  view.paint();
  const lastRowLine = Math.floor((1000 + VIEW_H - LH - PAD - view.getTopInset()) / LH) + 1;
  sel.setCaret(lastRowLine + 1, 1);
  view.revealCaretInCenterIfOutside();
  assert.ok(visibleOk(lastRowLine + 1), 'match on the last row is revealed above the bottom bar zone');

  // match under the Find widget / sticky stack
  const before = view.scrollTop;
  sel.setCaret(Math.floor(before / LH) - 8, 1);
  view.revealCaretInCenterIfOutside();
  assert.ok(view.scrollTop < before, 'scrolled up for a match above the viewport');
  assert.ok(visibleOk(sel.active.lineNumber), 'match above the viewport ends up below widget + sticky stack');

  // already visible → no scroll
  view.paint();
  const keep = view.scrollTop;
  const midLine = Math.floor((keep + VIEW_H / 2) / LH);
  sel.setCaret(midLine, 1);
  view.revealCaretInCenterIfOutside();
  assert.equal(view.scrollTop, keep, 'visible match does not move the viewport');

  // sweep: every line of the file, either direction, always ends fully visible
  for (let ln = 2; ln < 395; ln += 3) {
    sel.setCaret(ln, 1);
    view.revealCaretInCenterIfOutside();
    // lines within the first rows / last rows can legitimately not centre; they still must not be hidden
    view.paint();
    const y = view.screenPosOf(ln, 1).y;
    const top = Math.max(view.getTopInset(), view.lastStickyHeight);
    assert.ok(y >= top - 0.5 && y + LH <= VIEW_H + 0.5, `line ${ln} hidden after reveal (y=${y}, top=${top})`);
  }
}

// ── 4. clicking a sticky header does not leave it pinned (DPR sweep) ─────────
for (const dpr of [1, 1.5, 2, 2.625, 2.75, 3]) {
  for (const inset of [0, 58]) {
    const { view } = makeView(dpr);
    view.setTopInset(inset);
    let tested = 0;
    for (let ln = 3; ln < 380; ln++) {
      view.scrollTop = PAD + (ln - 1) * LH + inset;
      view.clampScrollPublic();
      view.paint();
      const stack = stickyLines(view);
      const kinds = view.lastSticky.map((s) => s.kind);
      for (let i = 0; i < stack.length; i++) {
        if (kinds[i] === 'active') continue;
        const keep = view.scrollTop;
        view.revealStickyLine(stack[i]!, i, 100);
        view.paint();
        tested++;
        assert.ok(
          !stickyLines(view).includes(stack[i]!),
          `dpr=${dpr} inset=${inset}: header ${stack[i]} (slot ${i}) stayed pinned after click: ${JSON.stringify(stickyLines(view))}`,
        );
        view.scrollTop = keep;
        view.paint();
      }
    }
    assert.ok(tested > 500, 'sweep must exercise many clicks');
  }
}

console.log('All find-sticky tests passed.');
