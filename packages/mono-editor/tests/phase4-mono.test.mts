import assert from 'node:assert/strict';
import {
  registerDefaultLanguages,
  registerBuiltinThemes,
  softenDynamicColor,
  resolveDynamicCaretColor,
  detectLineColors,
  detectLineEmbeddedScope,
  parseColorLiteral,
  formatColorPresentation,
  ColorPickerWidget,
  ReferencesPeekView,
  MinimapController,
  OverlayScrollbar,
  languages,
  languageFeatures,
  DEFAULT_THEME,
  Uri,
} from '../src/index';
import { TextModel } from '../src/common/model/TextModel';
import { SelectionState } from '../src/common/core/SelectionState';
import { TokenizationSupport } from '../src/common/languages/tokenization/TokenizationSupport';
import { InputController } from '../src/browser/input/InputController';
import { FindWidget } from '../src/contrib/find/FindWidget';
import { HoverController } from '../src/contrib/hover/HoverController';
import { resolveWidgetTheme } from '../src/platform/theme/widgetTheme';

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
  children: StubElement[] = [];
  parentNode: StubElement | null = null;
  listeners = new Map<string, Listener[]>();
  private _textContent = '';
  get textContent(): string {
    return this._textContent;
  }
  set textContent(v: string) {
    this._textContent = String(v ?? '');
    for (const c of this.children) c.parentNode = null;
    this.children = [];
  }
  className = '';
  dataset: Record<string, string> = {};
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
  offsetWidth = 300;
  offsetHeight = 36;
  width = 0;
  height = 0;

  constructor(tag: string) {
    this.tagName = tag.toUpperCase();
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
  querySelectorAll(selector: string): StubElement[] {
    const out: StubElement[] = [];
    const visit = (el: StubElement) => {
      for (const c of el.children) {
        const match =
          (selector.startsWith('.') && c.className.split(/\s+/).includes(selector.slice(1))) ||
          c.tagName.toLowerCase() === selector.toLowerCase() ||
          (selector === '[role="option"]' && c.getAttribute('role') === 'option');
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
    (globalThis as any).document.activeElement = this;
  }
  blur() {
    if ((globalThis as any).document.activeElement === this) {
      (globalThis as any).document.activeElement = null;
    }
  }
  select() {}
  setSelectionRange() {}
  getBoundingClientRect() {
    return {
      left: 0,
      top: 0,
      width: this.clientWidth,
      height: this.clientHeight,
      right: this.clientWidth,
      bottom: this.clientHeight,
    };
  }
  getContext() {
    const grad = { addColorStop() {} };
    return {
      save() {},
      restore() {},
      scale() {},
      fillRect() {},
      strokeRect() {},
      clearRect() {},
      createLinearGradient() {
        return grad;
      },
      fillStyle: '',
      strokeStyle: '',
      globalAlpha: 1,
      lineWidth: 1,
    };
  }
}

function installDomStub() {
  const head = new StubElement('head');
  const body = new StubElement('body');
  const doc = {
    head,
    body,
    activeElement: null as any,
    getElementById() {
      return null;
    },
    querySelector() {
      return null;
    },
    createElement(tag: string) {
      return new StubElement(tag);
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

function hexLightness(hex: string): number {
  const clean = hex.replace('#', '');
  const n = parseInt(clean, 16);
  const r = ((n >> 16) & 255) / 255;
  const g = ((n >> 8) & 255) / 255;
  const b = (n & 255) / 255;
  return (Math.max(r, g, b) + Math.min(r, g, b)) / 2;
}

async function run() {
  console.log('Phase 4 + 5 Fixes + Color Bullets/Picker test suite:');
  registerDefaultLanguages();
  registerBuiltinThemes();

  // ── FIX 1: Hover auto-hides cleanly on scroll or cursor change ────────────
  await test('Fix 1: HoverController hides active hover & cancels pending timers', async () => {
    installDomStub();
    const host = document.createElement('div') as unknown as HTMLElement;
    const model = new TextModel('const foo = 1;', 'javascript');
    const selection = new SelectionState();
    const viewStub = {
      screenPosOf: () => ({ x: 40, y: 40, h: 20 }),
      cssWidth: 600,
      cssHeight: 400,
    } as any;

    const sub = languages.registerHoverProvider('javascript', {
      provideHover: () => ({ contents: [{ value: '**foo**: number' }] }),
    });
    const hover = new HoverController(host, model, selection, viewStub);

    await hover.showAt(1, 7);
    assert.equal(hover.isOpen(), true, 'hover opens on demand');

    // Scroll / cursor change triggers hover.hide()
    hover.hide();
    assert.equal(hover.isOpen(), false, 'hover hides immediately');

    // Scheduled hover cancelled before delay expires must never appear
    hover.schedule(1, 7, 25);
    hover.hide();
    await new Promise((r) => setTimeout(r, 45));
    assert.equal(hover.isOpen(), false, 'cancelled scheduled hover stays hidden');

    hover.dispose();
    sub.dispose();
  });

  // ── FIX 2 & FIX 4: VS Code-faithful Inline References Peek View ───────────
  await test('Fix 2 & Fix 4: ReferencesPeekView renders VS Code split view, tracks scroll/pointerX, & live-syncs shared model', () => {
    installDomStub();
    const host = document.createElement('div') as unknown as HTMLElement;
    const sharedModel = new TextModel(
      'const alpha = 1;\nfunction run() {\n  return alpha + 2;\n}\nconsole.log(alpha);',
      'javascript',
    );

    let revealedLine = -1;
    let closedCount = 0;
    let peekThemeCalls = 0;

    const peek = new ReferencesPeekView(host);
    const wt = resolveWidgetTheme(DEFAULT_THEME);
    peek.applyTheme(wt);

    const uri = Uri.parse('inmemory://src/utils/calc.ts');
    peek.open({
      anchorLine: 1,
      anchorColumn: 7,
      anchorEndColumn: 12,
      model: sharedModel,
      items: [
        {
          location: { uri, range: { startLineNumber: 1, startColumn: 7, endLineNumber: 1, endColumn: 12 } },
          lineNumber: 1,
          startColumn: 7,
          endColumn: 12,
          lineText: sharedModel.getLineContent(1),
          fileName: 'calc.ts',
          dirPath: 'src/utils',
        },
        {
          location: { uri, range: { startLineNumber: 3, startColumn: 10, endLineNumber: 3, endColumn: 15 } },
          lineNumber: 3,
          startColumn: 10,
          endColumn: 15,
          lineText: sharedModel.getLineContent(3),
          fileName: 'calc.ts',
          dirPath: 'src/utils',
        },
        {
          location: { uri, range: { startLineNumber: 5, startColumn: 13, endLineNumber: 5, endColumn: 18 } },
          lineNumber: 5,
          startColumn: 13,
          endColumn: 18,
          lineText: sharedModel.getLineContent(5),
          fileName: 'calc.ts',
          dirPath: 'src/utils',
        },
      ],
      callbacks: {
        createPeekEditor: (_container, model) => {
          // Verify exact same TextModel instance is shared for live bidirectional edits
          assert.strictEqual(model, sharedModel, 'embedded peek editor shares exact backing TextModel');
          return {
            setSelection() {},
            revealLineInCenter(ln: number) {
              revealedLine = ln;
            },
            deltaDecorations: () => [],
            focus() {},
            layout() {},
            setTheme() {
              peekThemeCalls++;
            },
            dispose() {},
          } as any;
        },
        onClose: () => {
          closedCount++;
        },
      },
    });

    assert.equal(peek.isVisible(), true);
    const el = peek.getElement() as unknown as StubElement;
    assert.ok(el, 'peek root mounted');

    // Header shows fileName + dirPath - References (3)
    const header = el.querySelector('.mono-references-peek-header')!;
    const spans = header.querySelectorAll('span');
    assert.equal(spans[0]!.textContent, 'calc.ts');
    assert.equal(spans[1]!.textContent, 'src/utils - References (3)');

    // Vertical scroll moves the inline peek container, horizontal scroll moves triangle pointer
    peek.syncPosition({ top: 120, height: 232, pointerX: 145, rightInset: 80, viewportHeight: 600, topInset: 0 });
    assert.equal(el.style.top, '120px');
    assert.equal(el.style.right, '80px');
    const pointer = el.querySelector('.mono-references-peek-pointer')!;
    assert.equal(pointer.style.left, '145px');

    peek.syncPosition({ top: 64, height: 232, pointerX: 92, rightInset: 80, viewportHeight: 600, topInset: 0 });
    assert.equal(el.style.top, '64px', 'scrolls vertically with document');
    assert.equal(pointer.style.left, '92px', 'triangle tracks horizontal scroll');

    // Clicking a right-hand reference list item navigates the embedded peek editor to that line
    const rows = el.querySelectorAll('[role="option"]');
    assert.equal(rows.length, 3);
    rows[2]!.dispatch('click');
    assert.equal(revealedLine, 5, 'clicking reference row jumps embedded peek editor to line 5');

    // Live model edit updates right-hand preview automatically
    sharedModel.insert(sharedModel.getOffsetAt(5, 1), '// edited ');
    const updatedRows = el.querySelectorAll('[role="option"]');
    assert.ok(updatedRows[2]!.children.some((c) => c.textContent.includes('// edited')));

    // Clicking close button closes peek view cleanly and notifies onClose
    const closeBtn = header.querySelector('button')!;
    closeBtn.dispatch('click');
    assert.equal(peek.isVisible(), false);
    assert.equal(closedCount, 1);
    assert.equal(peekThemeCalls, 0);
  });

  // ── FIX 3 + MINI-CHANGE: FindWidget compact 3px spacing & layout height callback ──
  await test('Fix 3: FindWidget reports height for topInset gap and uses compact 3px padding/gap', () => {
    installDomStub();
    const host = document.createElement('div') as unknown as HTMLElement;
    const heights: number[] = [];

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
      onLayoutChange: (h) => heights.push(h),
    });

    fw.reveal(false, false);
    const el = fw.getElement() as unknown as StubElement;
    assert.equal(el.style.padding, '3px', 'FindWidget padding is compact 3px');
    assert.equal(el.style.gap, '3px', 'FindWidget row gap is compact 3px');
    assert.ok(heights.length >= 1 && heights[heights.length - 1]! > 0, 'opening Find reports positive height');

    fw.hide();
    assert.equal(heights[heights.length - 1], 0, 'closing Find resets top gap to 0');
    fw.dispose();
  });

  // ── FIX 5: Softened Theme-Adaptive Dynamic Caret & Teardrop Colors ─────────
  await test('Fix 5: softenDynamicColor adapts dark vs light themes with calm viewable contrast', () => {
    // Deep saturated blue (#0000ff) on dark theme becomes soft luminous tint (L ~ 0.66-0.76)
    const darkSoft = softenDynamicColor('#0000ff', true);
    const darkL = hexLightness(darkSoft);
    assert.ok(darkL >= 0.64 && darkL <= 0.78, `expected dark theme soft lightness 0.64..0.78, got ${darkL}`);
    assert.notEqual(darkSoft.toLowerCase(), '#0000ff', 'does not keep harsh raw deep color');

    // Bright cyan (#00ffff) on light theme becomes calm darker readable tint (L ~ 0.34-0.46)
    const lightSoft = softenDynamicColor('#00ffff', false);
    const lightL = hexLightness(lightSoft);
    assert.ok(lightL >= 0.32 && lightL <= 0.48, `expected light theme soft lightness 0.32..0.48, got ${lightL}`);
    assert.notEqual(darkSoft, lightSoft, 'dark and light themes produce distinct adaptive tints');

    // resolveDynamicCaretColor respects isDark flag
    const tokens = [{ startColumn: 1, endColumn: 6, type: 'keyword' }];
    const cDark = resolveDynamicCaretColor(tokens, 2, { keyword: '#569cd6' }, '#aeafad', true, true);
    const cLight = resolveDynamicCaretColor(tokens, 2, { keyword: '#569cd6' }, '#000000', true, false);
    assert.equal(cDark, softenDynamicColor('#569cd6', true));
    assert.equal(cLight, softenDynamicColor('#569cd6', false));
  });

  // ── MINI-CHANGE: Strict Axis-Isolated Scrollbar Reveal ─────────────────────
  await test('Mini-change: Vertical scroll never reveals horizontal scrollbar & vice-versa', () => {
    installDomStub();
    const host = document.createElement('div') as unknown as HTMLElement;
    const sb = new OverlayScrollbar(host, () => {}, {
      vertical: 'auto',
      horizontal: 'auto',
      hideVerticalOnScrollEnd: true,
      hideHorizontalOnScrollEnd: true,
      fadeDelayMs: 500,
    });

    const state = {
      scrollTop: 50,
      scrollLeft: 20,
      scrollHeight: 1600,
      scrollWidth: 1600,
      viewportHeight: 400,
      viewportWidth: 600,
      contentLeft: 48,
      rightInset: 80,
      isDark: true,
      ticks: [],
    };
    const tracks = (host as any).children as StubElement[];
    const vTrack = tracks.find((c) => c.className === 'mono-scrollbar-v')!;
    const hTrack = tracks.find((c) => c.className === 'mono-scrollbar-h')!;

    // Vertical-only scroll wakes vertical ONLY; horizontal stays completely hidden
    sb.update(state, true, { vertical: true, horizontal: false });
    assert.equal(vTrack.style.opacity, '1');
    assert.equal(hTrack.style.opacity, '0', 'horizontal scrollbar stays hidden during vertical scroll');

    // Reset via idle -> now horizontal-only scroll wakes horizontal ONLY
    sb.setOptions({ fadeDelayMs: 500 });
    const host2 = document.createElement('div') as unknown as HTMLElement;
    const sb2 = new OverlayScrollbar(host2, () => {}, {
      vertical: 'auto',
      horizontal: 'auto',
      hideVerticalOnScrollEnd: true,
      hideHorizontalOnScrollEnd: true,
      fadeDelayMs: 500,
    });
    sb2.update(state, true, { vertical: false, horizontal: true });
    const tracks2 = (host2 as any).children as StubElement[];
    const v2 = tracks2.find((c) => c.className === 'mono-scrollbar-v')!;
    const h2 = tracks2.find((c) => c.className === 'mono-scrollbar-h')!;
    assert.equal(h2.style.opacity, '1');
    assert.equal(v2.style.opacity, '0', 'vertical scrollbar stays hidden during horizontal scroll');

    sb.dispose();
    sb2.dispose();
  });

  // ── NEW: Color Bullets, Extensible Rules API (<style>/<script>/comments) & Color Picker ──
  await test('NEW: Color engine detects hex/rgb/hsl/named, skips comments, handles <style>/<script>/customRule & ColorPicker cycles formats', () => {
    installDomStub();
    const tokSupport = new TokenizationSupport();

    // 1) Parser & formatter sanity
    assert.deepEqual(parseColorLiteral('#0ea5e9')?.rgba, { r: 14, g: 165, b: 233, a: 1 });
    assert.deepEqual(parseColorLiteral('rgba(16, 185, 129, 0.5)')?.rgba, { r: 16, g: 185, b: 129, a: 0.5 });
    assert.ok(parseColorLiteral('hsl(210, 100%, 50%)'));
    assert.deepEqual(parseColorLiteral('coral')?.rgba, { r: 255, g: 127, b: 80, a: 1 });
    assert.equal(formatColorPresentation({ r: 14, g: 165, b: 233, a: 1 }, 'hex'), '#0ea5e9');
    assert.equal(formatColorPresentation({ r: 14, g: 165, b: 233, a: 1 }, 'rgb'), 'rgb(14, 165, 233)');

    // 2) JS: strings detected, comments suppressed by default, allowInComments overrides
    const jsModel = new TextModel('const c = "#38bdf8"; // #ff0000\nconst raw = coral;', 'javascript');
    const jsTokens1 = tokSupport.getLineTokens(jsModel, 1);
    const mJsDefault = detectLineColors(jsModel, 1, jsTokens1, undefined);
    assert.equal(mJsDefault.length, 1, 'only string color detected, comment color suppressed');
    assert.equal(mJsDefault[0]!.rawText, '#38bdf8');

    const mJsAllowComments = detectLineColors(jsModel, 1, jsTokens1, { allowInComments: true });
    assert.equal(mJsAllowComments.length, 2, 'allowInComments: true includes comment color');

    // Bare identifier `coral` in JS is NOT shown under default strings-only rule
    const mJsRaw = detectLineColors(jsModel, 2, tokSupport.getLineTokens(jsModel, 2), undefined);
    assert.equal(mJsRaw.length, 0, 'JS defaults to strings-only');

    // 3) HTML embedded <style> (raw CSS) vs <script> (strings-only) + style="..."
    const htmlCode = [
      '<style>',
      '  /* #ff0000 */',
      '  .card { color: coral; background: rgba(14, 165, 233, 0.8); }',
      '</style>',
      '<div style="border-color: #22c55e;"></div>',
      '<script>',
      '  const x = "#a855f7"; // #111111',
      '  const coral = 123;',
      '</script>',
    ].join('\n');
    const htmlModel = new TextModel(htmlCode, 'html');

    assert.equal(detectLineEmbeddedScope(htmlModel, 3, 'html').scope, 'htmlStyleTag');
    assert.equal(detectLineEmbeddedScope(htmlModel, 7, 'html').scope, 'htmlScriptTag');

    // Line 2 CSS comment inside <style> -> suppressed
    assert.equal(
      detectLineColors(htmlModel, 2, tokSupport.getLineTokens(htmlModel, 2), undefined).length,
      0,
    );
    // Line 3 inside <style> -> detects both `coral` and `rgba(...)`
    const styleColors = detectLineColors(htmlModel, 3, tokSupport.getLineTokens(htmlModel, 3), undefined);
    assert.equal(styleColors.length, 2);
    // Disabling styleTag via rules API suppresses line 3 colors
    const styleDisabled = detectLineColors(htmlModel, 3, tokSupport.getLineTokens(htmlModel, 3), {
      embeddedScopes: { styleTag: { enabled: false } },
    });
    assert.equal(styleDisabled.length, 0, 'embeddedScopes.styleTag.enabled = false works');

    // Line 5 inside style="..." attribute -> detects `#22c55e`
    const attrColors = detectLineColors(htmlModel, 5, tokSupport.getLineTokens(htmlModel, 5), undefined);
    assert.equal(attrColors.length, 1);
    assert.equal(attrColors[0]!.rawText, '#22c55e');

    // Line 7 inside <script> -> detects `"#a855f7"` only (not comment `#111111`)
    const scriptColors = detectLineColors(htmlModel, 7, tokSupport.getLineTokens(htmlModel, 7), undefined);
    assert.equal(scriptColors.length, 1);
    assert.equal(scriptColors[0]!.rawText, '#a855f7');

    // Line 8 inside <script> -> raw identifier `coral` ignored (strings-only in <script>)
    const scriptRaw = detectLineColors(htmlModel, 8, tokSupport.getLineTokens(htmlModel, 8), undefined);
    assert.equal(scriptRaw.length, 0);

    // Custom rule predicate API
    const customBlocked = detectLineColors(htmlModel, 7, tokSupport.getLineTokens(htmlModel, 7), {
      customRule: (ctx) => ctx.embeddedScope !== 'htmlScriptTag',
    });
    assert.equal(customBlocked.length, 0, 'customRule predicate filters matches');

    // 4) ColorPickerWidget format cycling (hex -> rgb -> hsl)
    const host = document.createElement('div') as unknown as HTMLElement;
    const picker = new ColorPickerWidget(host);
    const emitted: string[] = [];
    picker.open(scriptColors[0]!, { x: 40, y: 80, top: 60 }, {
      onColorChange: (txt) => emitted.push(txt),
    });
    assert.equal(picker.isOpen(), true);
    const headerBtn = (host as any).querySelector('button') as StubElement;
    headerBtn.dispatch('click'); // hex -> rgb
    headerBtn.dispatch('click'); // rgb -> hsl
    assert.ok(emitted[0]!.startsWith('rgb('), `expected rgb(...), got ${emitted[0]}`);
    assert.ok(emitted[1]!.startsWith('hsl('), `expected hsl(...), got ${emitted[1]}`);
    picker.dispose();

    // 5) languages.registerColorProvider registers & disposes cleanly
    const cp = languages.registerColorProvider('javascript', {
      provideDocumentColors: () => [],
    });
    assert.ok(languageFeatures.getColorProviders('javascript').length >= 1);
    cp.dispose();
  });

  // ── PHASE 4: Multi-Cursor Selection, Simultaneous Editing & Single Undo ────
  await test('Phase 4: Multi-cursor typing, backspace & Escape collapse work in single undo step', () => {
    installDomStub();
    const host = document.createElement('div') as unknown as HTMLElement;
    const model = new TextModel('foo = 1;\nfoo = 2;\nfoo = 3;', 'javascript');
    const selection = new SelectionState();
    selection.setSelections([
      { anchor: { lineNumber: 1, column: 1 }, active: { lineNumber: 1, column: 4 } },
      { anchor: { lineNumber: 2, column: 1 }, active: { lineNumber: 2, column: 4 } },
      { anchor: { lineNumber: 3, column: 1 }, active: { lineNumber: 3, column: 4 } },
    ]);
    assert.equal(selection.hasMultipleCursors, true);
    assert.equal(selection.selections.length, 3);

    const input = new InputController(host, model, selection, () => {});
    // Type "bar" across all 3 selections simultaneously
    input.textarea.value = 'bar';
    (input.textarea as any).dispatch('input');
    assert.equal(model.getValue(), 'bar = 1;\nbar = 2;\nbar = 3;');
    assert.equal(selection.selections.length, 3);

    // Single undo reverts all 3 edits atomically
    assert.equal(model.undo(), true);
    assert.equal(model.getValue(), 'foo = 1;\nfoo = 2;\nfoo = 3;');

    // Escape collapses back to primary cursor
    (input.textarea as any).dispatch('keydown', { key: 'Escape' });
    assert.equal(selection.hasMultipleCursors, false);
    assert.equal(selection.selections.length, 1);
    input.dispose();
  });

  // ── PHASE 4: Canvas Minimap Controller ─────────────────────────────────────
  await test('Phase 4: MinimapController mounts, calculates width, toggles & paints cleanly', () => {
    installDomStub();
    const host = document.createElement('div') as unknown as HTMLElement;
    const model = new TextModel('const a = 1;\nconst b = 2;\nconst c = 3;', 'javascript');
    const selection = new SelectionState();
    const tokSupport = new TokenizationSupport();
    const viewStub = {
      cssHeight: 400,
      scrollTop: 0,
      getMaxScrollTop: () => 200,
      getScrollHeight: () => 600,
      clampScrollPublic() {},
      paint() {},
    } as any;

    const mm = new MinimapController(
      host,
      model,
      selection,
      viewStub,
      tokSupport,
      () => DEFAULT_THEME,
      () => ({ findMatches: [], diagnostics: [] }),
      { enabled: true, side: 'right' },
    );
    assert.ok(mm.getWidth() >= 64, 'enabled minimap reserves width');
    mm.paint();
    mm.setOptions({ enabled: false });
    assert.equal(mm.getWidth(), 0, 'disabled minimap reports 0 width');
    mm.dispose();
  });

  // ── PHASE 4: All 6 Remaining Built-in Language Tokenizers ──────────────────
  await test('Phase 4: Java, C/C++, Markdown, YAML, Shell, and SQL tokenizers produce rich tokens', () => {
    const tokSupport = new TokenizationSupport();

    const samples: Array<{ lang: string; code: string; expectedTypes: string[] }> = [
      {
        lang: 'java',
        code: '@Override\npublic class Demo {\n  // note\n  String s = "hi";\n  int n = 42;\n}',
        expectedTypes: ['keyword', 'type', 'string', 'number', 'comment'],
      },
      {
        lang: 'cpp',
        code: '#include <vector>\n/* block */\nint main() { std::string s = "ok"; return 0; }',
        expectedTypes: ['keyword', 'type', 'string', 'number', 'comment'],
      },
      {
        lang: 'markdown',
        code: '# Heading\nUse `code` and **bold** text\n<!-- comment -->',
        expectedTypes: ['heading', 'codeInline', 'strong', 'comment'],
      },
      {
        lang: 'yaml',
        code: '# config\nname: "mono"\nenabled: true\nport: 3000',
        expectedTypes: ['comment', 'property', 'string', 'keyword', 'number'],
      },
      {
        lang: 'shell',
        code: '#!/usr/bin/env bash\n# greet user\nif [ -n $HOME ]; then echo "ok"; fi',
        expectedTypes: ['attribute', 'comment', 'keyword', 'variable', 'string'],
      },
      {
        lang: 'sql',
        code: '-- query\nSELECT COUNT(id) FROM users WHERE active = TRUE AND age > 18;',
        expectedTypes: ['comment', 'keyword', 'function', 'number'],
      },
    ];

    for (const { lang, code, expectedTypes } of samples) {
      const m = new TextModel(code, lang);
      const seen = new Set<string>();
      for (let ln = 1; ln <= m.getLineCount(); ln++) {
        for (const t of tokSupport.getLineTokens(m, ln)) {
          seen.add(t.type);
        }
      }
      for (const req of expectedTypes) {
        assert.ok(
          seen.has(req),
          `Language "${lang}" expected token type "${req}", got: ${[...seen].join(', ')}`,
        );
      }
    }
  });

  console.log(`\nAll ${passed} Phase 4 + 5 Fixes + Color Picker tests passed!`);
}

run().catch((err) => {
  console.error(err);
  process.exit(1);
});
