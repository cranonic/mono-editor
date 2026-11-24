import assert from 'node:assert/strict';
import {
  editor,
  languages,
  Uri,
  EndOfLineSequence,
  CompletionItemInsertTextRule,
  registerDefaultLanguages,
  registerBuiltinThemes,
  monoThemeService,
  resolveWidgetTheme,
  resolveDynamicCaretColor,
  softenDynamicColor,
  ViewLineProjection,
  FoldingModel,
  OverlayScrollbar,
  SnippetSession,
  parseSnippet,
  hasSnippetSyntax,
  renderMarkdownToDom,
  languageFeatures,
  DEFAULT_THEME,
} from '../src/index';
import { TextModel } from '../src/common/model/TextModel';
import { SelectionState } from '../src/common/core/SelectionState';
import { TokenizationSupport } from '../src/common/languages/tokenization/TokenizationSupport';
import { DEFAULT_TOKEN_COLORS } from '../src/common/languages/tokenization/tokenTypes';
import { IndentScopeFinder, layoutStickyForScroll } from '../src/common/viewModel/StickyScroll';
import { FindWidget } from '../src/contrib/find/FindWidget';
import { replaceMatch } from '../src/contrib/find/FindModel';
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
  style: Record<string, any> = {
    setProperty(k: string, v: string) {
      this[k] = v;
    },
    removeProperty(k: string) {
      delete this[k];
    },
  };
  attrs = new Map<string, string>();
  dataset: Record<string, string>;
  children: StubElement[] = [];
  parentNode: StubElement | null = null;
  listeners = new Map<string, Listener[]>();
  textContent = '';
  className = '';
  value = '';
  title = '';
  type = '';
  placeholder = '';
  rows = 1;
  readOnly = false;
  disabled = false;
  tabIndex = 0;
  clientWidth = 800;
  clientHeight = 600;
  offsetWidth = 260;
  offsetHeight = 100;
  offsetTop = 0;
  scrollTop = 0;
  focusCalls = 0;
  blurCalls = 0;
  selectionStart = 0;
  selectionEnd = 0;

  constructor(tag: string) {
    this.tagName = tag.toUpperCase();
    const toAttr = (prop: string) =>
      'data-' + prop.replace(/[A-Z]/g, (m) => '-' + m.toLowerCase());
    this.dataset = new Proxy({} as Record<string, string>, {
      get: (_t, prop) => (typeof prop === 'string' ? this.attrs.get(toAttr(prop)) : undefined),
      set: (_t, prop, val) => {
        if (typeof prop === 'string') this.attrs.set(toAttr(prop), String(val));
        return true;
      },
      deleteProperty: (_t, prop) => {
        if (typeof prop === 'string') this.attrs.delete(toAttr(prop));
        return true;
      },
    });
  }
  setAttribute(k: string, v: string) {
    this.attrs.set(k, v);
  }
  getAttribute(k: string) {
    return this.attrs.get(k) ?? null;
  }
  removeAttribute(k: string) {
    this.attrs.delete(k);
  }
  replaceChildren(...nodes: any[]) {
    for (const c of this.children) c.parentNode = null;
    this.children = [];
    for (const n of nodes) this.appendChild(n);
  }
  appendChild(child: any) {
    if (child && typeof child === 'object') {
      if (child.tagName === '#FRAGMENT') {
        for (const c of [...child.children]) {
          this.appendChild(c);
        }
        return child;
      }
      child.parentNode = this;
      this.children.push(child);
    }
    return child;
  }
  remove() {
    if (this.parentNode) {
      const idx = this.parentNode.children.indexOf(this);
      if (idx >= 0) this.parentNode.children.splice(idx, 1);
      this.parentNode = null;
    }
  }
  contains(node: any): boolean {
    if (node === this) return true;
    for (const c of this.children) {
      if (c.contains(node)) return true;
    }
    return false;
  }
  closest(selector: string): StubElement | null {
    const parts = selector.split(',').map((s) => s.trim().toLowerCase());
    let cur: StubElement | null = this;
    while (cur) {
      for (const p of parts) {
        if (p === cur.tagName.toLowerCase()) return cur;
        if (p === '[data-mono-focusable="true"]' && cur.getAttribute('data-mono-focusable') === 'true') {
          return cur;
        }
        if (p === '[contenteditable="true"]' && cur.getAttribute('contenteditable') === 'true') {
          return cur;
        }
      }
      cur = cur.parentNode;
    }
    return null;
  }
  querySelectorAll(selector: string): StubElement[] {
    const out: StubElement[] = [];
    const visit = (el: StubElement) => {
      for (const c of el.children) {
        const match =
          (selector.startsWith('.') && c.className.split(/\s+/).includes(selector.slice(1))) ||
          c.tagName.toLowerCase() === selector.toLowerCase() ||
          (selector === 'button:not([data-opt])' &&
            c.tagName === 'BUTTON' &&
            !c.attrs.has('data-opt')) ||
          (selector.startsWith('button[data-opt="') &&
            c.tagName === 'BUTTON' &&
            c.getAttribute('data-opt') === selector.slice('button[data-opt="'.length, -2));
        if (match) out.push(c);
        visit(c);
      }
    };
    visit(this);
    return out;
  }
  querySelector(selector: string): StubElement | null {
    return this.querySelectorAll(selector)[0] ?? null;
  }
  addEventListener(type: string, fn: Listener) {
    const arr = this.listeners.get(type) ?? [];
    arr.push(fn);
    this.listeners.set(type, arr);
  }
  removeEventListener(type: string, fn: Listener) {
    const arr = this.listeners.get(type);
    if (!arr) return;
    const i = arr.indexOf(fn);
    if (i >= 0) arr.splice(i, 1);
  }
  dispatch(type: string, ev: any = {}) {
    const event = {
      defaultPrevented: false,
      stopped: false,
      target: this,
      preventDefault() {
        this.defaultPrevented = true;
      },
      stopPropagation() {
        this.stopped = true;
      },
      ...ev,
    };
    for (const fn of this.listeners.get(type) ?? []) fn(event);
    return event;
  }
  focus() {
    this.focusCalls++;
    (globalThis as any).document.activeElement = this;
  }
  blur() {
    this.blurCalls++;
    if ((globalThis as any).document.activeElement === this) {
      (globalThis as any).document.activeElement = null;
    }
  }
  select() {
    this.selectionStart = 0;
    this.selectionEnd = this.value.length;
  }
  setSelectionRange(s: number, e: number) {
    this.selectionStart = s;
    this.selectionEnd = e;
  }
  getBoundingClientRect() {
    return { left: 0, top: 0, width: this.clientWidth, height: this.clientHeight, right: this.clientWidth, bottom: this.clientHeight };
  }
}

function installDomStub() {
  const head = new StubElement('head');
  const body = new StubElement('body');
  const byId = new Map<string, StubElement>();
  const doc = {
    head,
    body,
    activeElement: null as any,
    getElementById(id: string) {
      return byId.get(id) ?? null;
    },
    querySelector() {
      return null;
    },
    createElement(tag: string) {
      const el = new StubElement(tag);
      const origSetAttr = el.setAttribute.bind(el);
      el.setAttribute = (k: string, v: string) => {
        origSetAttr(k, v);
        if (k === 'id') byId.set(v, el);
      };
      Object.defineProperty(el, 'id', {
        get() {
          return el.attrs.get('id') ?? '';
        },
        set(v: string) {
          el.attrs.set('id', v);
          byId.set(v, el);
        },
      });
      return el;
    },
    createDocumentFragment() {
      return new StubElement('#FRAGMENT');
    },
    createTextNode(text: string) {
      const n = new StubElement('#TEXT');
      n.textContent = text;
      return n;
    },
    addEventListener() {},
    removeEventListener() {},
  };
  (globalThis as any).document = doc;
  (globalThis as any).HTMLElement = StubElement;
  (globalThis as any).window = {
    setTimeout,
    clearTimeout,
    addEventListener() {},
    removeEventListener() {},
    dispatchEvent() {},
    devicePixelRatio: 1,
  };
  (globalThis as any).requestAnimationFrame = (cb: () => void) => setTimeout(cb, 0);
  (globalThis as any).cancelAnimationFrame = (id: any) => clearTimeout(id);
  return doc;
}

async function run() {
  console.log('Phase 3 + 6 Fixes test suite:');
  registerDefaultLanguages();
  registerBuiltinThemes();

  // ── FIX 1: Sticky Scroll stays active when blocks are collapsed ────────────
  await test('Fix 1: Sticky Scroll remains active and accurate when blocks are collapsed', () => {
    const code = [
      'class Workspace {',
      '  helper() {',
      '    const a = 1;',
      '    const b = 2;',
      '    return a + b;',
      '  }',
      '  process() {',
      '    const x = 10;',
      '    const y = 20;',
      '    const z = 30;',
      '    const w = 40;',
      '    return x + y + z + w;',
      '  }',
      '}',
    ].join('\n');

    const model = new TextModel(code, 'javascript');
    const folding = new FoldingModel(model);
    folding.updateSync();
    // Collapse `helper()` on line 2 (hides lines 3..6)
    assert.equal(folding.foldAtLine(2), true);
    assert.equal(folding.isLineHidden(3), true);

    const projection = new ViewLineProjection();
    projection.sync({
      model,
      modelVersion: model.getVersionId(),
      foldVersion: folding.getVersion(),
      hasFolds: folding.getFoldedCount() > 0,
      isLineHidden: (ln) => folding.isLineHidden(ln),
      wordWrap: 'off',
      wrappingIndent: 'same',
      wrapWidthPx: 600,
      tabSize: 2,
      charWidth: 8,
      measureColumnX: (_ln, col) => (col - 1) * 8,
    });
    assert.equal(projection.isIdentity(), false, 'projection is non-identity with a fold');

    const finder = new IndentScopeFinder(model);

    // Scroll down into `process()` body (line 10 is visual row 5 because 4 lines are hidden)
    const rowOfLine10 = projection.modelLineToFirstVisualRow(10);
    const metrics = {
      fontFamily: 'monospace',
      fontSize: 14,
      lineHeight: 20,
      gutterWidth: 48,
      foldGutterWidth: 16,
      charWidth: 8,
      paddingLeft: 8,
      paddingTop: 0,
    };
    const scrollTop = rowOfLine10 * metrics.lineHeight + 2;

    const sticky = layoutStickyForScroll(
      finder,
      scrollTop,
      metrics,
      5,
      true,
      undefined,
      undefined,
      false,
      projection,
      (ln) => folding.isLineHidden(ln),
    );

    const stickyLines = sticky.lines.map((s) => s.lineNumber);
    assert.ok(stickyLines.includes(1), `expected class Workspace (line 1) in sticky headers, got ${stickyLines}`);
    assert.ok(stickyLines.includes(7), `expected process() (line 7) in sticky headers, got ${stickyLines}`);
    assert.ok(!stickyLines.includes(2), 'collapsed sibling helper() should not leak into process() sticky headers');
  });

  // ── FIX 2: Independent Auto-Hide Vertical & Horizontal Scrollbars ──────────
  await test('Fix 2: Scrollbars completely hide (opacity 0) by default & support independent V/H flags', async () => {
    installDomStub();
    const host = document.createElement('div') as unknown as HTMLElement;
    const sb = new OverlayScrollbar(host, () => {}, {
      vertical: 'auto',
      horizontal: 'auto',
      fadeDelayMs: 15,
    });

    // Default options must enable complete hide on both axes
    assert.equal(sb.getOptions().hideVerticalOnScrollEnd, true);
    assert.equal(sb.getOptions().hideHorizontalOnScrollEnd, true);

    const state = {
      scrollTop: 40,
      scrollLeft: 30,
      scrollHeight: 1500,
      scrollWidth: 1600,
      viewportHeight: 400,
      viewportWidth: 600,
      contentLeft: 48,
      isDark: true,
      ticks: [],
    };

    // Active vertical + horizontal scroll wakes both thumbs to opacity 1
    sb.update(state, true, { vertical: true, horizontal: true });
    const tracks = (host as any).children as StubElement[];
    const vTrack = tracks.find((c) => c.className === 'mono-scrollbar-v')!;
    const hTrack = tracks.find((c) => c.className === 'mono-scrollbar-h')!;
    assert.equal(vTrack.style.opacity, '1');
    assert.equal(hTrack.style.opacity, '1');

    // After fadeDelayMs, both completely hide (opacity '0' & pointerEvents 'none')
    await new Promise((r) => setTimeout(r, 40));
    assert.equal(vTrack.style.opacity, '0');
    assert.equal(vTrack.style.pointerEvents, 'none');
    assert.equal(hTrack.style.opacity, '0');
    assert.equal(hTrack.style.pointerEvents, 'none');

    // Disable hideVerticalOnScrollEnd only → vertical lingers at 0.35, horizontal still hides at 0
    sb.setOptions({ hideVerticalOnScrollEnd: false, hideHorizontalOnScrollEnd: true, fadeDelayMs: 15 });
    sb.update(state, true, { vertical: true, horizontal: true });
    await new Promise((r) => setTimeout(r, 40));
    assert.equal(vTrack.style.opacity, '0.35');
    assert.equal(hTrack.style.opacity, '0');

    sb.dispose();
  });

  // ── FIX 3 & FIX 5: Codicon FindWidget + Live Dark/Light Theme Sync ─────────
  await test('Fix 3 & Fix 5: FindWidget uses local codicons and syncs with Dark/Light themes', () => {
    installDomStub();
    const host = document.createElement('div') as unknown as HTMLElement;
    const fw = new FindWidget(host, {
      onSearchChange() {},
      onReplaceChange() {},
      onToggleOption() {},
      onTogglePreserveCase() {},
      onFindNext() {},
      onFindPrev() {},
      onReplaceOne() {},
      onReplaceAll() {},
      onToggleReplace() {},
      onClose() {},
    });

    fw.reveal(true, false);
    fw.update({
      isRevealed: true,
      isReplaceRevealed: true,
      searchString: 'foo',
      replaceString: 'bar',
      options: { caseSensitive: true, wholeWord: false, regex: false, preserveCase: true },
      matches: [
        { startOffset: 0, endOffset: 3, lineNumber: 1, startColumn: 1, endColumn: 4 },
        { startOffset: 10, endOffset: 13, lineNumber: 2, startColumn: 1, endColumn: 4 },
        { startOffset: 20, endOffset: 23, lineNumber: 3, startColumn: 1, endColumn: 4 },
      ],
      currentIndex: 0,
    });

    const widgetEl = fw.getElement() as unknown as StubElement;
    assert.ok(widgetEl, 'FindWidget root mounted');

    // Verify authentic Monaco codicon classes are used (zero inline SVG fallback in widget)
    const icons = widgetEl.querySelectorAll('.codicon');
    const iconClasses = icons.map((i) => i.className);
    for (const expected of [
      'codicon-chevron-down',
      'codicon-case-sensitive',
      'codicon-whole-word',
      'codicon-regex',
      'codicon-arrow-up',
      'codicon-arrow-down',
      'codicon-close',
      'codicon-preserve-case',
      'codicon-replace',
      'codicon-replace-all',
    ]) {
      assert.ok(
        iconClasses.some((cls) => cls.includes(expected)),
        `Expected FindWidget to render ${expected}, got: ${iconClasses.join(', ')}`,
      );
    }

    // Apply Light+ theme and verify widget surfaces switch to light palette
    monoThemeService.setTheme('mscode-light');
    const lightTheme = resolveWidgetTheme(
      { ...DEFAULT_THEME, ...monoThemeService.toPartialEditorTheme('mscode-light') },
      monoThemeService.resolve().colors,
    );
    fw.applyTheme(lightTheme);
    assert.equal(lightTheme.isDark, false);
    assert.equal(widgetEl.style.background, lightTheme.background);
    assert.equal(widgetEl.style.color, lightTheme.foreground);

    // Apply Dark+ theme and verify widget updates live
    monoThemeService.setTheme('mscode-dark');
    const darkTheme = resolveWidgetTheme(
      { ...DEFAULT_THEME, ...monoThemeService.toPartialEditorTheme('mscode-dark') },
      monoThemeService.resolve().colors,
    );
    fw.applyTheme(darkTheme);
    assert.equal(darkTheme.isDark, true);
    assert.equal(widgetEl.style.background, darkTheme.background);
    assert.notEqual(darkTheme.background, lightTheme.background);

    fw.dispose();
  });

  // ── FIX 4: FindWidget Inputs Retain Focus (No Editor Focus Theft) ──────────
  await test('Fix 4: FindWidget inputs keep focus without InputController stealing it back', async () => {
    const doc = installDomStub();
    const host = document.createElement('div') as unknown as HTMLElement;
    const model = new TextModel('hello world\nhello mono', 'javascript');
    const selection = new SelectionState();
    const input = new InputController(host, model, selection, () => {});

    const fw = new FindWidget(host, {
      onSearchChange() {},
      onReplaceChange() {},
      onToggleOption() {},
      onTogglePreserveCase() {},
      onFindNext() {},
      onFindPrev() {},
      onReplaceOne() {},
      onReplaceAll() {},
      onToggleReplace() {},
      onClose() {},
    });
    fw.reveal(true, false);
    fw.update({
      isRevealed: true,
      isReplaceRevealed: true,
      searchString: '',
      replaceString: '',
      options: { caseSensitive: false, wholeWord: false, regex: false, preserveCase: false },
      matches: [],
      currentIndex: -1,
    });

    const widgetEl = fw.getElement() as unknown as StubElement;
    const inputs = widgetEl.querySelectorAll('input');
    assert.equal(inputs.length, 2, 'Find and Replace inputs present');

    const findInput = inputs[0]!;
    // Clicking input must stop propagation to editor canvas WITHOUT calling preventDefault()
    const pd = findInput.dispatch('pointerdown');
    assert.equal(pd.defaultPrevented, false, 'pointerdown on Find input must NOT preventDefault');

    // Focus moves from editor textarea to Find input
    input.focus();
    const focusCallsBefore = (input.textarea as any).focusCalls;
    findInput.focus();
    (input.textarea as any).dispatch('blur');
    await new Promise((r) => setTimeout(r, 15));

    assert.equal(doc.activeElement, findInput, 'Find input must retain focus');
    assert.equal((input.textarea as any).focusCalls, focusCallsBefore, 'Editor textarea must not steal focus back');

    // Also verify preserveCase replacement works on real TextModel matches
    const pcModel = new TextModel('Hello HELLO hello', 'plaintext');
    const opts = { caseSensitive: false, wholeWord: false, regex: false, preserveCase: true };
    replaceMatch(pcModel, { startLineNumber: 1, startColumn: 1, endLineNumber: 1, endColumn: 6 }, 'world', 'hello', opts, undefined, true);
    replaceMatch(pcModel, { startLineNumber: 1, startColumn: 7, endLineNumber: 1, endColumn: 12 }, 'world', 'hello', opts, undefined, true);
    replaceMatch(pcModel, { startLineNumber: 1, startColumn: 13, endLineNumber: 1, endColumn: 18 }, 'World', 'hello', opts, undefined, true);
    assert.equal(pcModel.getValue(), 'World WORLD world');

    fw.dispose();
    input.dispose();
  });

  // ── FIX 6: Dynamic Caret & Independent Selection Teardrop Syntax Colors ────
  await test('Fix 6: Dynamic caret & independent selection teardrop colors match token syntax colors', () => {
    const model = new TextModel('const   msg = "hi"; // 42\n   ', 'javascript');
    const tokSupport = new TokenizationSupport();
    const tokens = tokSupport.getLineTokens(model, 1);
    const tokenColors = DEFAULT_TOKEN_COLORS as unknown as Record<string, string | undefined>;
    const fallback = DEFAULT_THEME.caret;

    // On `const` (keyword) → softened theme-adaptive keyword color
    const kwColor = resolveDynamicCaretColor(tokens, 3, tokenColors, fallback, true, true);
    assert.equal(kwColor, softenDynamicColor(tokenColors.keyword!, true));

    // On `"hi"` (string) → softened theme-adaptive string color
    const strCol = 'const   msg = "h'.length;
    const strColor = resolveDynamicCaretColor(tokens, strCol, tokenColors, fallback, true, true);
    assert.equal(strColor, softenDynamicColor(tokenColors.string!, true));
    assert.notEqual(kwColor, strColor, 'selection start (keyword) and end (string) resolve independently');

    // On pure whitespace (not touching any syntax token) → fallback theme caret color
    const wsColor = resolveDynamicCaretColor(tokens, 7, tokenColors, fallback, true);
    assert.equal(wsColor, fallback);

    // On blank/whitespace-only line → fallback theme caret color
    const emptyLineTokens = tokSupport.getLineTokens(model, 2);
    assert.equal(resolveDynamicCaretColor(emptyLineTokens, 2, tokenColors, fallback, true), fallback);

    // When disabled (`dynamicCaretColor: false`) → always fallback theme caret color
    const disabledColor = resolveDynamicCaretColor(tokens, 3, tokenColors, fallback, false);
    assert.equal(disabledColor, fallback);
  });

  // ── PHASE 3: CRLF / LF EOL Normalization ───────────────────────────────────
  await test('Phase 3: TextModel auto-detects & preserves CRLF vs LF with exact offsets and undo', () => {
    const crlfModel = new TextModel('line1\r\nline2\r\nline3', 'plaintext');
    assert.equal(crlfModel.getEOL(), '\r\n');
    assert.equal(crlfModel.getLineCount(), 3);
    assert.equal(crlfModel.getLineContent(1), 'line1');
    assert.equal(crlfModel.getValue(), 'line1\r\nline2\r\nline3');

    // Offset math accounts for 2-char `\r\n`
    assert.equal(crlfModel.getOffsetAt(2, 1), 7);
    assert.deepEqual(crlfModel.getPositionAt(7), { lineNumber: 2, column: 1 });
    // Offset landing between \r and \n clamps cleanly to end of line 1
    assert.deepEqual(crlfModel.getPositionAt(6), { lineNumber: 1, column: 6 });

    // Inserting LF text into a CRLF model normalizes to CRLF
    crlfModel.insert(7, 'A\nB\n');
    assert.equal(crlfModel.getValue(), 'line1\r\nA\r\nB\r\nline2\r\nline3');
    assert.equal(crlfModel.undo(), true);
    assert.equal(crlfModel.getValue(), 'line1\r\nline2\r\nline3');

    // Switch EOL to LF
    crlfModel.setEOL(EndOfLineSequence.LF);
    assert.equal(crlfModel.getEOL(), '\n');
    assert.equal(crlfModel.getValue(), 'line1\nline2\nline3');
    assert.equal(crlfModel.getOffsetAt(2, 1), 6);
  });

  // ── PHASE 3: Snippet Parsing & Tabstop Session ─────────────────────────────
  await test('Phase 3: SnippetSession expands placeholders, choices, indent & Tab/Shift+Tab navigation', () => {
    assert.equal(hasSnippetSyntax('fn(${1:arg})'), true);
    assert.equal(hasSnippetSyntax('plainText'), false);

    const parsed = parseSnippet('const ${1:name} = ${2|one,two,three|}; // \\$100$0');
    assert.equal(parsed.text, 'const name = one; // $100');
    assert.equal(parsed.tabstops.length, 3);

    const model = new TextModel('  fn', 'javascript');
    const selection = new SelectionState();
    const session = new SnippetSession();

    // Insert multi-line snippet with 2-space base indent
    session.insert(
      model,
      selection,
      2,
      4,
      'function ${1:myFn}(${2:arg}) {\n  return ${3:arg};\n}$0',
      '  ',
    );

    assert.equal(
      model.getValue(),
      '  function myFn(arg) {\n    return arg;\n  }',
    );
    assert.equal(session.isActive(), true);
    assert.equal(session.getActiveIndex(), 1);
    // $1 ("myFn") is selected
    assert.deepEqual(selection.anchor, { lineNumber: 1, column: 12 });
    assert.deepEqual(selection.active, { lineNumber: 1, column: 16 });

    // Replace $1 with a longer name ("computeSum") and sync offsets
    const s1 = model.getOffsetAt(selection.anchor.lineNumber, selection.anchor.column);
    const e1 = model.getOffsetAt(selection.active.lineNumber, selection.active.column);
    model.replaceRange(s1, e1, 'computeSum');
    const afterPos = model.getPositionAt(s1 + 'computeSum'.length);
    selection.setCaret(afterPos.lineNumber, afterPos.column);
    session.syncAfterEdit();

    // Tab -> jumps cleanly to $2 ("arg") even though $1 grew by 6 chars!
    assert.equal(session.next(), true);
    assert.equal(session.getActiveIndex(), 2);
    const s2 = model.getOffsetAt(selection.anchor.lineNumber, selection.anchor.column);
    const e2 = model.getOffsetAt(selection.active.lineNumber, selection.active.column);
    assert.equal(model.getValue().slice(s2, e2), 'arg');

    // Shift+Tab -> back to $1
    assert.equal(session.prev(), true);
    assert.equal(session.getActiveIndex(), 1);

    // Tab -> $2 -> $3 -> $0 finishes session
    session.next();
    session.next();
    assert.equal(session.getActiveIndex(), 3);
    session.next();
    assert.equal(session.isActive(), false);
  });

  // ── PHASE 3: Safe Markdown DOM Renderer ────────────────────────────────────
  await test('Phase 3: renderMarkdownToDom renders Markdown safely without raw HTML injection', () => {
    installDomStub();
    const wrap = document.createElement('div') as unknown as StubElement;
    const theme = resolveWidgetTheme(DEFAULT_THEME);
    renderMarkdownToDom(
      wrap as unknown as HTMLElement,
      '# Title\n\nUse **bold**, *italic*, `code`, [safe](https://example.com), and [xss](javascript:alert(1)).\n\n```js\nconst x = 1;\n```',
      theme,
    );

    assert.ok(wrap.querySelectorAll('strong').length >= 1, 'renders <strong>');
    assert.ok(wrap.querySelectorAll('em').length >= 1, 'renders <em>');
    assert.ok(wrap.querySelectorAll('code').length >= 2, 'renders inline & fenced <code>');
    assert.ok(wrap.querySelectorAll('pre').length === 1, 'renders fenced <pre>');

    const links = wrap.querySelectorAll('a');
    assert.equal(links.length, 1, 'only https link rendered as <a>, javascript: URL stripped');
    assert.equal((links[0] as any).href, 'https://example.com');
  });

  // ── PHASE 3: Multi-Model & LSP Provider Registries ─────────────────────────
  await test('Phase 3: Standalone models expose EOL/language/events & LSP registries round-trip', () => {
    const uri = Uri.parse('inmemory://test/phase3.js');
    const m = editor.createModel('const a = 1;\r\nconst b = 2;', 'javascript', uri);
    assert.equal(m.getEOL(), '\r\n');
    let changeEvents = 0;
    const sub = m.onDidChangeContent(() => changeEvents++);
    m.setEOL(EndOfLineSequence.LF);
    assert.equal(m.getEOL(), '\n');
    assert.equal(changeEvents, 1);
    editor.setModelLanguage(m, 'typescript');
    assert.equal(m.getLanguageId(), 'typescript');
    sub.dispose();
    m.dispose();

    // Verify all 7 new Phase 3 LSP provider registries register & dispose cleanly
    const d1 = languages.registerSignatureHelpProvider('typescript', {
      provideSignatureHelp: () => ({
        value: {
          signatures: [{ label: 'fn(x: number)', parameters: [{ label: 'x: number' }] }],
          activeSignature: 0,
          activeParameter: 0,
        },
      }),
    });
    const d2 = languages.registerDocumentFormattingEditProvider('typescript', {
      provideDocumentFormattingEdits: () => [],
    });
    const d3 = languages.registerDocumentRangeFormattingEditProvider('typescript', {
      provideDocumentRangeFormattingEdits: () => [],
    });
    const d4 = languages.registerDefinitionProvider('typescript', {
      provideDefinition: () => null,
    });
    const d5 = languages.registerReferenceProvider('typescript', {
      provideReferences: () => [],
    });
    const d6 = languages.registerRenameProvider('typescript', {
      provideRenameEdits: () => null,
    });
    const d7 = languages.registerCodeActionProvider('typescript', {
      provideCodeActions: () => ({ actions: [] }),
    });

    assert.equal(languageFeatures.getSignatureHelpProviders('typescript').length >= 1, true);
    assert.equal(languageFeatures.getDocumentFormattingProviders('typescript').length >= 1, true);
    assert.equal(languageFeatures.getDocumentRangeFormattingProviders('typescript').length >= 1, true);
    assert.equal(languageFeatures.getDefinitionProviders('typescript').length >= 1, true);
    assert.equal(languageFeatures.getReferenceProviders('typescript').length >= 1, true);
    assert.equal(languageFeatures.getRenameProviders('typescript').length >= 1, true);
    assert.equal(languageFeatures.getCodeActionProviders('typescript').length >= 1, true);
    assert.equal(CompletionItemInsertTextRule.InsertAsSnippet, 4);

    [d1, d2, d3, d4, d5, d6, d7].forEach((d) => d.dispose());
  });

  console.log(`\nAll ${passed} Phase 3 + 6 Fixes tests passed!`);
}

run().catch((err) => {
  console.error(err);
  process.exit(1);
});
