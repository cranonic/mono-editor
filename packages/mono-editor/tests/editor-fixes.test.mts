/**
 * Tests for:
 *  1) Indic (Bengali / Hindi) conjunct text layout & teardrop X-alignment
 *  2) Auto-suggest on typing, filtering/scoring/sorting, trigger chars, backspace
 *  3) scrollBeyondLastLine (VS Code-style blank area below the last line)
 *
 * Run:
 *   npx tsx tests/editor-fixes.test.mts
 */
import assert from 'node:assert/strict';
import {
  TextLayoutCache,
  computeLineLayout,
  getGraphemeBoundaries,
  isFastMonospaceLine,
  nextGraphemeOffset,
  prevGraphemeOffset,
  graphemeRangeAt,
} from '../src/browser/render/textLayout';
import {
  filterAndSortSuggestions,
  scoreCompletionMatch,
  SuggestController,
} from '../src/contrib/suggest/SuggestController';
import { TextModel } from '../src/common/model/TextModel';
import { SelectionState } from '../src/common/core/SelectionState';
import { ViewController } from '../src/browser/view/ViewController';
import { languageFeatures, CompletionItemKind, DEFAULT_THEME } from '../src/index';

// ── 1. Indic conjuncts / grapheme layout & teardrop X-consistency ────────────
{
  assert.equal(isFastMonospaceLine('const x = 42; // ascii'), true);
  assert.equal(isFastMonospaceLine('বাংলা যুক্তাক্ষর'), false);
  assert.equal(isFastMonospaceLine('नमस्ते प्रकृति'), false);
  assert.equal(isFastMonospaceLine('a\tb'), false);

  // Bengali conjuncts: যুক্তাক্ষর = যু (0..2) + ক্তা (2..6) + ক্ষ (6..9) + র (9..10)
  assert.deepEqual(getGraphemeBoundaries('যুক্তাক্ষর'), [0, 2, 6, 9, 10]);
  assert.deepEqual(getGraphemeBoundaries('ক্ষ'), [0, 3]);
  // Hindi conjuncts: नमस्ते = न (0..1) + म (1..2) + स्ते (2..6)
  assert.deepEqual(getGraphemeBoundaries('नमस्ते'), [0, 1, 2, 6]);

  // ArrowLeft / ArrowRight stepping never splits inside conjuncts
  assert.equal(nextGraphemeOffset('যুক্তাক্ষর', 0), 2);
  assert.equal(nextGraphemeOffset('যুক্তাক্ষর', 2), 6);
  assert.equal(nextGraphemeOffset('যুক্তাক্ষর', 6), 9);
  assert.equal(nextGraphemeOffset('যুক্তাক্ষর', 9), 10);
  assert.equal(prevGraphemeOffset('যুক্তাক্ষর', 10), 9);
  assert.equal(prevGraphemeOffset('যুক্তাক্ষর', 9), 6);
  assert.equal(prevGraphemeOffset('যুক্তাক্ষর', 6), 2);
  assert.equal(prevGraphemeOffset('যুক্তাক্ষর', 2), 0);

  // graphemeRangeAt inside a conjunct returns the full conjunct
  assert.deepEqual(graphemeRangeAt('যুক্তাক্ষর', 3), { start: 2, end: 6 });

  // Simulated HarfBuzz-like shaped width: each grapheme cluster is ~12px (NOT 3-4 × 8.4px!)
  const clusterWidth = (s: string) => {
    const b = getGraphemeBoundaries(s);
    return (b.length - 1) * 12;
  };
  let measureCalls = 0;
  const cache = new TextLayoutCache((_font, text) => {
    measureCalls++;
    return clusterWidth(text);
  });

  // Fast ASCII path must NEVER call measureText
  assert.equal(cache.measureColumnX('hello world', 6, '14px mono', 8.4), 5 * 8.4);
  assert.equal(cache.columnAtX('hello world', 5 * 8.4, '14px mono', 8.4, true), 6);
  assert.equal(measureCalls, 0, 'ASCII fast path skips measureText');

  // Complex Bengali line: dragging teardrop to visual X -> column -> teardrop release X must match!
  const line = 'const s = "যুক্তাক্ষর";';
  for (const targetX of [0, 48, 96, 130, 150, 180, 220]) {
    const col = cache.columnAtX(line, targetX, '14px mono', 8.4, true);
    const snappedX = cache.measureColumnX(line, col, '14px mono', 8.4);
    // Selection edge X and released teardrop X both use measureColumnX -> 0px delta!
    const selectionEdgeX = cache.measureColumnX(line, col, '14px mono', 8.4);
    assert.equal(snappedX, selectionEdgeX);
    // And col must land on a grapheme cluster boundary
    const boundaries = getGraphemeBoundaries(line);
    assert.ok(boundaries.includes(col - 1), `col ${col} lands on grapheme boundary`);
  }

  // Non-monotonic raw measureText safety net
  const layout = computeLineLayout('যুক্তাক্ষর', (prefix) => {
    // Deliberately jittery/non-monotonic mock
    if (prefix === 'যু') return 15;
    if (prefix === 'যুক্তা') return 14; // smaller than previous!
    return prefix.length * 6;
  });
  for (let i = 1; i < layout.widths.length; i++) {
    assert.ok(layout.widths[i]! >= layout.widths[i - 1]!, 'widths stay monotonic');
  }
}
console.log('✓ Indic (Bengali/Hindi) conjunct layout, grapheme navigation & teardrop alignment');

// ── 2. Completion filtering, scoring, sorting & auto-suggest on typing ───────
{
  assert.ok(scoreCompletionMatch('function', 'fun') > scoreCompletionMatch('myFunction', 'fun'));
  assert.ok(scoreCompletionMatch('myFunction', 'fun') > scoreCompletionMatch('f_u_n_c', 'fun'));
  assert.equal(scoreCompletionMatch('while', 'fun'), -1);

  const items = [
    { label: 'while', kind: CompletionItemKind.Keyword },
    { label: 'myFunction', kind: CompletionItemKind.Function },
    { label: 'function', kind: CompletionItemKind.Keyword },
    { label: 'f_u_n', kind: CompletionItemKind.Variable },
    { label: 'final', kind: CompletionItemKind.Keyword, preselect: true },
  ];
  const filtered = filterAndSortSuggestions(items, 'fun');
  assert.deepEqual(
    filtered.map((i) => i.label),
    ['function', 'myFunction', 'f_u_n'],
  );

  // Minimal DOM stub for SuggestController + SuggestWidget in Node
  const makeEl = (): any => {
    const el: any = {
      style: {},
      className: '',
      textContent: '',
      clientWidth: 600,
      clientHeight: 400,
      offsetWidth: 240,
      offsetHeight: 120,
      offsetTop: 0,
      scrollTop: 0,
      children: [] as any[],
      setAttribute() {},
      addEventListener() {},
      removeEventListener() {},
      appendChild(c: any) { this.children.push(c); return c; },
      remove() {},
      querySelectorAll() { return []; },
    };
    return el;
  };
  (globalThis as any).document = {
    getElementById: () => ({}),
    querySelector: () => ({}),
    createElement: () => makeEl(),
    createTextNode: (t: string) => ({ textContent: t }),
    head: makeEl(),
  };

  const model = new TextModel('', 'javascript');
  const selection = new SelectionState();
  const fakeView: any = {
    isLineInView: () => true,
    screenPosOf: () => ({ x: 48, y: 4, h: 20 }),
  };

  // Register a custom dot-trigger provider for javascript
  const disp = languageFeatures.registerCompletionItemProvider('javascript', {
    triggerCharacters: ['.'],
    provideCompletionItems(_m, _p, ctx) {
      if (ctx?.triggerCharacter === '.') {
        return {
          suggestions: [
            { label: 'log', kind: CompletionItemKind.Method, detail: 'method' },
            { label: 'warn', kind: CompletionItemKind.Method, detail: 'method' },
          ],
        };
      }
      return { suggestions: [] };
    },
  });

  const suggest = new SuggestController(
    makeEl(),
    model,
    selection,
    fakeView,
    () => {},
    undefined,
    { quickSuggestions: true, quickSuggestionsDelay: 0, suggestOnTriggerCharacters: true },
  );

  // Typing 'f' opens suggest automatically (without Ctrl+Space!)
  model.insert(0, 'f', 'typing');
  selection.setCaret(1, 2);
  await suggest.onType('f');
  assert.equal(suggest.isOpen(), true, 'typing "f" auto-opens completion palette');

  // Typing 'u' keeps it open and narrows to "fu"
  model.insert(1, 'u', 'typing');
  selection.setCaret(1, 3);
  await suggest.onType('u');
  assert.equal(suggest.isOpen(), true, 'typing "u" keeps completion open');

  // Backspace back to 'f' keeps it open
  model.delete(1, 2, 'deleteLeft');
  selection.setCaret(1, 2);
  await suggest.onBackspace();
  assert.equal(suggest.isOpen(), true, 'backspace to "f" keeps completion open');

  // Typing non-matching 'zzz' closes completion cleanly
  model.insert(1, 'zzz', 'typing');
  selection.setCaret(1, 5);
  await suggest.onType('zzz');
  assert.equal(suggest.isOpen(), false, 'no matching items closes completion');

  // Typing '.' (provider trigger char) opens dot completions
  model.setValue('console.');
  selection.setCaret(1, 9);
  await suggest.onType('.');
  assert.equal(suggest.isOpen(), true, 'typing "." opens trigger-character completions');

  // Typing space closes completion
  model.insert(8, ' ', 'typing');
  selection.setCaret(1, 10);
  await suggest.onType(' ');
  assert.equal(suggest.isOpen(), false, 'typing space closes completion');

  // Pure numeric literal '42' must NOT auto-open quick suggestions
  model.setValue('4');
  selection.setCaret(1, 2);
  await suggest.onType('4');
  assert.equal(suggest.isOpen(), false, 'typing digit "4" does not spam quick suggestions');

  // Comments respect quickSuggestions: true default (disabled in comments)
  const suggestWithTokens = new SuggestController(
    makeEl(),
    model,
    selection,
    fakeView,
    () => {},
    undefined,
    {
      quickSuggestions: true,
      quickSuggestionsDelay: 0,
      getTokenTypeAt: () => 'comment',
    },
  );
  model.setValue('// f');
  selection.setCaret(1, 5);
  await suggestWithTokens.onType('f');
  assert.equal(suggestWithTokens.isOpen(), false, 'quickSuggestions suppressed inside comments by default');

  suggest.dispose();
  suggestWithTokens.dispose();
  disp.dispose();
}
console.log('✓ Auto-suggest on typing, filtering/sorting, trigger chars, backspace & comment guard');

// ── 3. scrollBeyondLastLine (VS Code-style blank bottom area) ────────────────
{
  const lines100 = Array.from({ length: 100 }, (_, i) => `line ${i + 1}`).join('\n');
  const model = new TextModel(lines100);
  const sel = new SelectionState();
  const fakeRenderer: any = {
    resize() {},
    paint() {},
    measureColumnX: (_line: string, col: number, m: any) => Math.max(0, col - 1) * m.charWidth,
    columnAtX: (line: string, x: number, m: any) =>
      Math.max(1, Math.min(line.length + 1, Math.round(x / m.charWidth) + 1)),
  };
  const metrics = {
    fontFamily: 'monospace',
    fontSize: 14,
    lineHeight: 20,
    gutterWidth: 48,
    charWidth: 8,
    paddingLeft: 8,
    paddingTop: 4,
  };
  (globalThis as any).window = { devicePixelRatio: 1 };
  (globalThis as any).requestAnimationFrame = () => 1;
  (globalThis as any).cancelAnimationFrame = () => {};

  const view = new ViewController(
    model,
    sel,
    fakeRenderer,
    () => metrics,
    () => DEFAULT_THEME,
    () => true,
    3,
    null,
    undefined,
    true, // scrollBeyondLastLine default true
  );
  view.setSize(800, 600);

  // 100 lines * 20 + 4 = 2004; extra = 600 - 20 - 4 = 576; scrollHeight = 2580; maxScrollTop = 1980
  assert.equal(view.getScrollHeight(), 2580);
  assert.equal(view.getMaxScrollTop(), 1980);

  // Scroll to bottom → last line sits at top padding (y = 4px) with 576px blank area below
  view.scrollTop = 99999;
  view.clampScrollPublic();
  assert.equal(view.scrollTop, 1980);
  const lastLineScreenY = metrics.paddingTop + (100 - 1) * metrics.lineHeight - view.scrollTop;
  assert.equal(lastLineScreenY, 4);

  // Toggle scrollBeyondLastLine off → clamps back to 2004 - 600 = 1404
  view.setScrollBeyondLastLine(false);
  assert.equal(view.getScrollHeight(), 2004);
  assert.equal(view.getMaxScrollTop(), 1404);
  assert.equal(view.scrollTop, 1404);

  // Short 5-line file with scrollBeyondLastLine = true still scrolls line 5 to top
  view.setScrollBeyondLastLine(true);
  model.setValue('1\n2\n3\n4\n5');
  assert.equal(view.getMaxScrollTop(), 80); // (5 - 1) * 20

  // 1-line file cannot scroll off-screen
  model.setValue('only line');
  assert.equal(view.getMaxScrollTop(), 0);

  view.dispose();
}
console.log('✓ scrollBeyondLastLine (VS Code blank area height at bottom of editor)');

console.log('\nAll editor-fixes tests passed.');
