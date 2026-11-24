import assert from 'node:assert/strict';
import {
  registerDefaultLanguages,
  getLanguageConfiguration,
  ViewLineProjection,
  FoldingModel,
  OverlayScrollbar,
  findMatchingBracket,
  findVisibleOccurrences,
  computeIndentGuides,
  CompletionItemKind,
  MonoCommands,
} from '../src/index';
import { TextModel } from '../src/common/model/TextModel';
import { SelectionState } from '../src/common/core/SelectionState';
import { TokenizationSupport } from '../src/common/languages/tokenization/TokenizationSupport';
import { SuggestWidget } from '../src/contrib/suggest/SuggestWidget';
import { InputController } from '../src/browser/input/InputController';

let passed = 0;
function test(name: string, fn: () => void | Promise<void>) {
  return Promise.resolve()
    .then(fn)
    .then(() => {
      passed++;
      console.log(`  ok  ${name}`);
    });
}

type Listener = (ev: any) => void;

class StubElement {
  tagName: string;
  style: Record<string, any> = {};
  attrs = new Map<string, string>();
  children: StubElement[] = [];
  parentNode: StubElement | null = null;
  listeners = new Map<string, Listener[]>();
  textContent = '';
  className = '';
  value = '';
  rows = 1;
  readOnly = false;
  clientWidth = 800;
  clientHeight = 600;
  offsetWidth = 260;
  offsetHeight = 100;
  offsetTop = 0;
  scrollTop = 0;
  focusCalls = 0;
  blurCalls = 0;

  constructor(tag: string) {
    this.tagName = tag.toUpperCase();
  }
  setAttribute(k: string, v: string) {
    this.attrs.set(k, v);
  }
  getAttribute(k: string) {
    return this.attrs.get(k) ?? null;
  }
  appendChild(child: any) {
    if (child && typeof child === 'object') {
      child.parentNode = this;
      this.children.push(child);
    }
    return child;
  }
  remove() {
    if (this.parentNode) {
      this.parentNode.children = this.parentNode.children.filter((c) => c !== this);
      this.parentNode = null;
    }
  }
  contains(node: any): boolean {
    if (node === this) return true;
    return this.children.some((c) => c.contains?.(node));
  }
  getBoundingClientRect() {
    return { left: 0, top: 0, width: 12, height: 300, right: 12, bottom: 300 };
  }
  addEventListener(type: string, fn: Listener) {
    const arr = this.listeners.get(type) ?? [];
    arr.push(fn);
    this.listeners.set(type, arr);
  }
  removeEventListener(type: string, fn: Listener) {
    const arr = this.listeners.get(type);
    if (arr) this.listeners.set(type, arr.filter((f) => f !== fn));
  }
  dispatch(type: string, ev: Record<string, any> = {}) {
    const event: any = {
      type,
      target: this,
      preventDefault() {
        event.defaultPrevented = true;
      },
      stopPropagation() {
        event.propagationStopped = true;
      },
      defaultPrevented: false,
      propagationStopped: false,
      ...ev,
    };
    const arr = this.listeners.get(type) ?? [];
    for (const fn of [...arr]) fn(event);
    return event;
  }
  focus() {
    this.focusCalls++;
    (globalThis as any).document.activeElement = this;
  }
  blur() {
    this.blurCalls++;
    if ((globalThis as any).document.activeElement === this) {
      (globalThis as any).document.activeElement = (globalThis as any).document.body;
    }
  }
  querySelectorAll() {
    return [];
  }
}

function installDomStub() {
  const body = new StubElement('body');
  const head = new StubElement('head');
  const winListeners = new Map<string, Listener[]>();
  const doc: any = {
    body,
    head,
    documentElement: new StubElement('html'),
    activeElement: body,
    createElement: (tag: string) => new StubElement(tag),
    createTextNode: (text: string) => ({ textContent: text }),
    getElementById: () => null,
    querySelector: () => ({}),
    addEventListener: () => {},
    removeEventListener: () => {},
  };
  const win: any = {
    devicePixelRatio: 1,
    addEventListener(type: string, fn: Listener) {
      const arr = winListeners.get(type) ?? [];
      arr.push(fn);
      winListeners.set(type, arr);
    },
    removeEventListener(type: string, fn: Listener) {
      const arr = winListeners.get(type);
      if (arr) winListeners.set(type, arr.filter((f) => f !== fn));
    },
    dispatch(type: string, ev: Record<string, any> = {}) {
      const arr = winListeners.get(type) ?? [];
      for (const fn of [...arr]) fn(ev);
    },
    setTimeout,
    clearTimeout,
  };
  (globalThis as any).document = doc;
  (globalThis as any).window = win;
  return { doc, win };
}

async function run() {
  console.log('Phase 2 — Bug Fixes, Folding, Word Wrap, Guides, Brackets & Scrollbar Tests');
  registerDefaultLanguages();

  // ── 1. Multiline Block Comment Tokenizer Fix (JS/TS, CSS, HTML) ────────────
  await test('JS/TS multiline JSDoc & indented /* */ comments never drop indented lines or leak into next line', () => {
    const code = [
      '/**',
      ' * Greets a user in multiple scripts.',
      ' */',
      '',
      'function greetAll(name) {',
      '  const message = `Hello ${name}`;',
      '  /* open indented block comment',
      '     still indented comment line',
      '     closing indented line */',
      '  return message;',
      '}',
    ].join('\n');

    const model = new TextModel(code, 'javascript');
    const tok = new TokenizationSupport();

    // Line 1: /**
    const l1 = tok.getLineTokens(model, 1);
    assert.equal(l1.length, 1);
    assert.equal(l1[0]!.type, 'comment');

    // Line 2: ' * Greets a user in multiple scripts.' (indented!)
    const l2 = tok.getLineTokens(model, 2);
    assert.equal(l2.length, 1);
    assert.equal(l2[0]!.type, 'comment');
    assert.equal(l2[0]!.startColumn, 1);

    // Line 3: ' */' (indented closing!)
    const l3 = tok.getLineTokens(model, 3);
    assert.equal(l3.length, 1);
    assert.equal(l3[0]!.type, 'comment');

    // Line 5: 'function greetAll(name) {' MUST NOT be a comment!
    const l5 = tok.getLineTokens(model, 5);
    assert.equal(l5[0]!.type, 'keyword');
    assert.equal(l5[0]!.startColumn, 1);
    assert.equal(l5[0]!.endColumn, 9); // 'function'
    assert.ok(!l5.some((t) => t.type === 'comment'), 'function line must not inherit comment color');

    // Lines 7-9: indented /* ... */ block comment inside function
    const l7 = tok.getLineTokens(model, 7);
    assert.equal(l7[0]!.type, 'comment');
    const l8 = tok.getLineTokens(model, 8);
    assert.equal(l8.length, 1);
    assert.equal(l8[0]!.type, 'comment');
    const l9 = tok.getLineTokens(model, 9);
    assert.equal(l9.length, 1);
    assert.equal(l9[0]!.type, 'comment');

    // Line 10: '  return message;' MUST be control-flow keyword 'return', NOT comment
    const l10 = tok.getLineTokens(model, 10);
    assert.equal(l10[0]!.type, 'keywordControl');
    assert.ok(!l10.some((t) => t.type === 'comment'));
  });

  await test('CSS and HTML multiline block comments handle indented lines and close cleanly', () => {
    const tok = new TokenizationSupport();

    const css = new TextModel('/*\n  indented css comment\n  */\n.box { color: red; }', 'css');
    assert.equal(tok.getLineTokens(css, 1)[0]!.type, 'comment');
    assert.equal(tok.getLineTokens(css, 2)[0]!.type, 'comment');
    assert.equal(tok.getLineTokens(css, 3)[0]!.type, 'comment');
    const cssLine4 = tok.getLineTokens(css, 4);
    assert.ok(!cssLine4.some((t) => t.type === 'comment'), 'CSS rule after */ must not be comment');

    const html = new TextModel('<!--\n  indented html comment\n  -->\n<div class="ok">hi</div>', 'html');
    assert.equal(tok.getLineTokens(html, 1)[0]!.type, 'comment');
    assert.equal(tok.getLineTokens(html, 2)[0]!.type, 'comment');
    assert.equal(tok.getLineTokens(html, 3)[0]!.type, 'comment');
    const htmlLine4 = tok.getLineTokens(html, 4);
    assert.ok(htmlLine4.some((t) => t.type === 'tag'), 'HTML line after --> must tokenize tag name');
    assert.ok(!htmlLine4.some((t) => t.type === 'comment'), 'HTML line after --> must not inherit comment');
    assert.ok(!htmlLine4.some((t) => t.type === 'comment'), 'HTML tag after --> must not be comment');
  });

  // ── 2. Zero-Blink Touch Completion Tap ─────────────────────────────────────
  await test('SuggestWidget accepts on touchend with preventDefault and zero focus-churn blink', () => {
    const { doc } = installDomStub();
    const host = new StubElement('div');
    const model = new TextModel('con', 'javascript');
    const sel = new SelectionState();
    sel.setCaret(1, 4);

    const input = new InputController(host as any, model, sel, () => {});
    const ta = input.textarea as unknown as StubElement;
    input.focus();
    const initialFocusCalls = ta.focusCalls;
    assert.equal(doc.activeElement, ta);

    // Calling focus() again when already focused must be a no-op (prevents blink churn)
    input.focus();
    assert.equal(ta.focusCalls, initialFocusCalls);

    let acceptCount = 0;
    const widget = new SuggestWidget(host as any, {
      onAccept: () => {
        acceptCount++;
        input.focus();
      },
      onDismiss: () => {},
    });
    widget.show(
      [{ label: 'console', kind: CompletionItemKind.Variable }],
      { x: 20, y: 40, top: 20 },
      'con',
    );
    const widgetEl = host.children.find((c) => c.className.includes('mono-suggest-widget'))!;
    const rowEl = widgetEl.children[0]!.children[0]!;

    // Mobile touch tap: touchstart -> touchend (non-drag) -> followed by browser pointerup
    rowEl.dispatch('touchstart', { touches: [{ clientX: 50, clientY: 60 }] });
    const endEv = rowEl.dispatch('touchend', { changedTouches: [{ clientX: 51, clientY: 61 }] });
    assert.equal(endEv.defaultPrevented, true, 'touchend must preventDefault to stop synthetic blur');
    assert.equal(acceptCount, 1);
    assert.equal(ta.blurCalls, 0, 'textarea must never blur on touch accept');
    assert.equal(doc.activeElement, ta);

    // Trailing pointerup right after touchend must be deduplicated (no double accept)
    rowEl.dispatch('pointerup', { pointerType: 'touch', clientX: 51, clientY: 61 });
    assert.equal(acceptCount, 1);

    // Scroll drag (>6px) on touch must NOT accept or call preventDefault
    widget.show(
      [{ label: 'console', kind: CompletionItemKind.Variable }],
      { x: 20, y: 40, top: 20 },
      'con',
    );
    const row2 = widgetEl.children[0]!.children[0]!;
    row2.dispatch('touchstart', { touches: [{ clientX: 50, clientY: 60 }] });
    row2.dispatch('touchmove', { touches: [{ clientX: 50, clientY: 85 }] });
    const dragEnd = row2.dispatch('touchend', { changedTouches: [{ clientX: 50, clientY: 85 }] });
    assert.equal(dragEnd.defaultPrevented, false);
    assert.equal(acceptCount, 1);
    assert.equal(widget.isVisible(), true);

    widget.dispose();
    input.dispose();
  });

  // ── 3. FoldingModel (Indent + #region Markers) ─────────────────────────────
  await test('FoldingModel computes indent & #region ranges, toggles, folds/unfolds, and reveals hidden lines', () => {
    const code = [
      '//#region Utilities',
      'function outer() {',
      '  if (true) {',
      '    return 1;',
      '  }',
      '}',
      '//#endregion',
      'const tail = 2;',
    ].join('\n');

    const model = new TextModel(code, 'javascript');
    const folding = new FoldingModel(model);

    assert.equal(folding.isFoldable(1), true, '#region line 1 should be foldable');
    assert.equal(folding.isFoldable(2), true, 'outer() line 2 should be foldable');
    assert.equal(folding.isFoldable(3), true, 'if block line 3 should be foldable');

    // Fold inner if block (line 3 -> 4)
    assert.equal(folding.toggle(3), true);
    assert.equal(folding.isCollapsed(3), true);
    assert.equal(folding.isLineHidden(3), false, 'header line stays visible');
    assert.equal(folding.isLineHidden(4), true, 'body line 4 is hidden');
    assert.equal(folding.getFoldedCount(), 1);

    // unfoldContaining reveals hidden line 4
    assert.equal(folding.unfoldContaining(4), true);
    assert.equal(folding.isLineHidden(4), false);
    assert.equal(folding.getFoldedCount(), 0);

    // foldAtLine from line 4 folds innermost enclosing block (line 3)
    assert.equal(folding.foldAtLine(4), true);
    assert.equal(folding.isCollapsed(3), true);

    // foldAll / unfoldAll
    assert.equal(folding.foldAll(), true);
    assert.ok(folding.getFoldedCount() >= 3);
    assert.equal(folding.isLineHidden(6), true);
    assert.equal(folding.unfoldAll(), true);
    assert.equal(folding.getFoldedCount(), 0);
    assert.equal(folding.isLineHidden(6), false);

    // Verify MonoCommands Phase 2 folding command IDs
    assert.equal(MonoCommands.Fold, 'editor.fold');
    assert.equal(MonoCommands.Unfold, 'editor.unfold');
    assert.equal(MonoCommands.FoldAll, 'editor.foldAll');
    assert.equal(MonoCommands.UnfoldAll, 'editor.unfoldAll');
  });

  // ── 4. ViewLineProjection (Identity, Folding, Grapheme Word Wrap, Combined) ─
  await test('ViewLineProjection supports identity fast path, folding, grapheme word wrap, and combined fold+wrap', () => {
    const code = [
      'function demo() {',
      '  const longLine = "alpha beta gamma delta epsilon zeta eta theta iota kappa";',
      '  const bnLine = "বাংলাদেশ যুক্তাক্ষর ক্ষ ক্লান্ত প্রকৃতি আনন্দ সুন্দর ভাষা";',
      '}',
      'const after = true;',
    ].join('\n');

    const model = new TextModel(code, 'javascript');
    const folding = new FoldingModel(model);
    const proj = new ViewLineProjection();
    const charWidth = 10;
    const measureColumnX = (text: string, col: number) => Math.max(0, col - 1) * charWidth;

    // Identity fast path (wrap off, no folds)
    proj.sync({
      model,
      modelVersion: model.getVersionId(),
      foldVersion: folding.getVersion(),
      hasFolds: false,
      isLineHidden: () => false,
      wordWrap: 'off',
      wrappingIndent: 'same',
      wrapWidthPx: 200,
      tabSize: 2,
      charWidth,
      measureColumnX,
    });
    assert.equal(proj.isIdentity(), true);
    assert.equal(proj.getVisualLineCount(), 5);

    // Word wrap ON with 220px width & wrappingIndent: 'indent'
    proj.sync({
      model,
      modelVersion: model.getVersionId(),
      foldVersion: folding.getVersion(),
      hasFolds: false,
      isLineHidden: () => false,
      wordWrap: 'on',
      wrappingIndent: 'indent',
      wrapWidthPx: 220,
      tabSize: 2,
      charWidth,
      measureColumnX,
    });
    assert.equal(proj.isIdentity(), false);
    assert.ok(proj.getVisualLineCount() > 5, 'long lines must wrap into multiple visual rows');
    const line2Segs = proj.getVisualLinesForModelLine(2);
    assert.ok(line2Segs.length >= 3);
    assert.equal(line2Segs[0]!.isFirstSegment, true);
    assert.equal(line2Segs[0]!.wrapIndentPx, 0);
    // Continuation segments inherit 2 leading spaces + 2 extra tabSize spaces = 4 * 10 = 40px
    assert.equal(line2Segs[1]!.isFirstSegment, false);
    assert.equal(line2Segs[1]!.wrapIndentPx, 40);
    assert.equal(line2Segs[line2Segs.length - 1]!.isLastSegment, true);

    // Round-trip modelToVisual on wrapped column
    const midCol = line2Segs[1]!.startCol + 2;
    const mapped = proj.modelToVisual(2, midCol);
    assert.equal(mapped.visualLine.modelLine, 2);
    assert.equal(mapped.visualRow, line2Segs[1]!.visualRow);

    // Bengali line wraps cleanly without splitting a combining mark cluster
    const bnSegs = proj.getVisualLinesForModelLine(3);
    assert.ok(bnSegs.length >= 2);
    const bnText = model.getLineContent(3);
    for (let i = 0; i < bnSegs.length - 1; i++) {
      const splitIdx = bnSegs[i]!.endCol - 1;
      const nextChar = bnText[splitIdx] ?? '';
      assert.ok(!/\p{M}/u.test(nextChar), 'wrap split must not detach a Bengali combining mark');
    }

    // Combined Folding + Word Wrap: folding line 1 hides lines 2..3 (all their wrapped rows disappear!)
    folding.fold(1);
    proj.sync({
      model,
      modelVersion: model.getVersionId(),
      foldVersion: folding.getVersion(),
      hasFolds: folding.hasCollapsed(),
      isLineHidden: (ln) => folding.isLineHidden(ln),
      wordWrap: 'on',
      wrappingIndent: 'same',
      wrapWidthPx: 220,
      tabSize: 2,
      charWidth,
      measureColumnX,
    });
    assert.equal(proj.getVisualLinesForModelLine(2).length, 0);
    assert.equal(proj.getVisualLinesForModelLine(3).length, 0);
    assert.equal(proj.getVisualLinesForModelLine(5).length, 1);
  });

  // ── 5. Bracket Pair Matching, Word Occurrences & Indent Guides ─────────────
  await test('findMatchingBracket finds nested pairs across lines and ignores strings/comments', () => {
    const code = [
      'function run(items) {',
      '  const fake = "}"; // }',
      '  return items.map((x) => {',
      '    return x;',
      '  });',
      '}',
    ].join('\n');
    const model = new TextModel(code, 'javascript');
    const tok = new TokenizationSupport();
    const getTok = (ln: number, col: number) => {
      const list = tok.getLineTokens(model, ln);
      for (const t of list) if (col >= t.startColumn && col < t.endColumn) return t.type;
      return null;
    };
    const cfg = getLanguageConfiguration('javascript');

    // Caret right after outer '{' on line 1 col 22 -> matches line 6 col 1 (skipping "}" in string & comment!)
    const outer = findMatchingBracket(model, { lineNumber: 1, column: 22 }, cfg, getTok);
    assert.ok(outer);
    assert.deepEqual(outer.open, { lineNumber: 1, column: 21, length: 1 });
    assert.deepEqual(outer.close, { lineNumber: 6, column: 1, length: 1 });

    // Backward match from closing '}' on line 5 col 4 -> matches inner '{' on line 3 col 27
    const inner = findMatchingBracket(model, { lineNumber: 5, column: 4 }, cfg, getTok);
    assert.ok(inner);
    assert.deepEqual(inner.open, { lineNumber: 3, column: 27, length: 1 });
    assert.deepEqual(inner.close, { lineNumber: 5, column: 3, length: 1 });
  });

  await test('findVisibleOccurrences highlights repeated whole words & active selections', () => {
    const model = new TextModel(
      'const value = 1;\nconst valueExtra = value + value;\nconsole.log(value);',
      'javascript',
    );
    const sel = new SelectionState();
    sel.setCaret(1, 9); // inside 'value'

    const occ = findVisibleOccurrences(model, sel, 1, 3);
    assert.equal(occ.length, 4, 'must match 4 whole-word "value" hits and skip "valueExtra"');
    assert.deepEqual(occ[0], { lineNumber: 1, startColumn: 7, endColumn: 12 });
    assert.deepEqual(occ[3], { lineNumber: 3, startColumn: 13, endColumn: 18 });
  });

  await test('computeIndentGuides inherits blank-line indentation and identifies active block scope', () => {
    const code = [
      'function f() {',
      '  if (ok) {',
      '    const a = 1;',
      '',
      '    return a;',
      '  }',
      '}',
    ].join('\n');
    const model = new TextModel(code, 'javascript');
    const info = computeIndentGuides(model, 1, 7, 3, 2);

    assert.equal(info.levels.get(1), 0);
    assert.equal(info.levels.get(2), 1);
    assert.equal(info.levels.get(3), 2);
    assert.equal(info.levels.get(4), 2, 'blank line inside block inherits inner indent level');
    assert.equal(info.activeLevel, 2);
    assert.equal(info.activeStartLine, 3);
    assert.equal(info.activeEndLine, 5);
  });

  // ── 6. OverlayScrollbar (Thumbs, Overview Ticks, Focus-Safe Drag) ──────────
  await test('OverlayScrollbar renders thumbs & overview ticks and scrolls via drag without stealing focus', () => {
    const { win } = installDomStub();
    const host = new StubElement('div');
    let lastTop: number | null = null;
    const sb = new OverlayScrollbar(
      host as any,
      (st) => {
        if (st !== null) lastTop = st;
      },
      { vertical: 'visible', horizontal: 'auto' },
    );

    sb.update(
      {
        scrollTop: 0,
        scrollLeft: 0,
        scrollHeight: 1200,
        scrollWidth: 1600,
        viewportHeight: 300,
        viewportWidth: 600,
        contentLeft: 56,
        isDark: true,
        ticks: [
          { ratio: 0.25, color: '#ef4444' },
          { ratio: 0.75, color: '#f97316' },
        ],
      },
      true,
    );

    const vTrack = host.children.find((c) => c.className === 'mono-scrollbar-v')!;
    const hTrack = host.children.find((c) => c.className === 'mono-scrollbar-h')!;
    assert.equal(vTrack.style.display, 'block');
    assert.equal(hTrack.style.display, 'block');
    const tickLayer = vTrack.children[0]!;
    assert.equal(tickLayer.children.length, 2, 'must render 2 overview ruler ticks');

    // mousedown on track must preventDefault to avoid stealing editor focus
    const md = vTrack.dispatch('mousedown');
    assert.equal(md.defaultPrevented, true);

    // Track jump click at y=150 (50% of 300px track) -> scrolls to ~450px
    vTrack.dispatch('pointerdown', { clientY: 150, target: vTrack });
    assert.ok(lastTop !== null && Math.abs(lastTop - 450) <= 2);
    win.dispatch('pointerup');

    sb.dispose();
  });

  console.log(`\nPASS: ${passed} phase2-mono tests passed.`);
}

run().catch((err) => {
  console.error(err);
  process.exit(1);
});
