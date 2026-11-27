import assert from 'node:assert/strict';
import {
  DocumentHighlightKind,
  GhostTextModel,
  InlayHintKind,
  InlineCompletionTriggerKind,
  MarkdownScopeFinder,
  MonoCommands,
  OutlineScopeFinder,
  SemanticTokensCache,
  SymbolKind,
  analyzeCallContext,
  applySemanticTokenEdits,
  buildWrappedGhostRows,
  collectInlineVirtualElements,
  decodeSemanticTokens,
  extractNextGhostLine,
  extractNextGhostWord,
  languages,
  mapVirtualXToRealX,
  registerDefaultLanguages,
  resolveParameterLabelRange,
  virtualAdvanceBeforeColumn,
  type DocumentSymbol,
  type ResolvedInlayHint,
} from '../src/index';
import { TextModel } from '../src/common/model/TextModel';
import { ViewLineProjection } from '../src/common/viewModel/ViewLineProjection';
import { languageFeatures } from '../src/common/languages/languageFeaturesService';
import { FoldingModel } from '../src/common/viewModel/FoldingModel';
import { HoverWidget } from '../src/contrib/hover/HoverWidget';
import { SignatureHelpWidget } from '../src/contrib/signatureHelp/SignatureHelpWidget';
import { SelectionRangeController } from '../src/contrib/selectionRange/SelectionRangeController';
import { SelectionState } from '../src/common/core/SelectionState';
import { CommandService } from '../src/platform/commands/CommandService';
import { KeybindingService } from '../src/platform/keybindings/KeybindingService';
import { DEFAULT_THEME } from '../src/common/config/themeTypes';
import { resolveWidgetTheme } from '../src/platform/theme/widgetTheme';
import { ColorDecoratorController } from '../src/contrib/colorPicker/ColorDecoratorController';
import { MarkerSeverity } from '../src/common/decorations/types';

let passed = 0;
function test(name: string, fn: () => void | Promise<void>) {
  return Promise.resolve()
    .then(fn)
    .then(() => {
      passed++;
      console.log(`  ok  ${name}`);
    });
}

// ── Minimal Safe DOM Stub for Widget / Controller Unit Tests ─────────────────
class StubEl {
  tagName: string;
  style: Record<string, string> = {};
  attrs = new Map<string, string>();
  children: StubEl[] = [];
  parentNode: StubEl | null = null;
  listeners = new Map<string, Array<(ev: any) => void>>();
  className = '';
  classList = {
    add: (...names: string[]) => {
      this.className = [this.className, ...names].filter(Boolean).join(' ');
    },
    remove: (...names: string[]) => {
      this.className = this.className.split(/\s+/).filter((c) => !names.includes(c)).join(' ');
    },
    contains: (n: string) => this.className.split(/\s+/).includes(n),
  };
  tabIndex = 0;
  type = '';
  title = '';
  disabled = false;
  private _text = '';
  clientWidth = 600;
  clientHeight = 400;
  offsetWidth = 260;
  offsetHeight = 120;

  constructor(tag: string) {
    this.tagName = tag.toUpperCase();
  }
  get textContent(): string {
    if (!this.children.length) return this._text;
    return this._text + this.children.map((c) => c.textContent).join('');
  }
  set textContent(v: string) {
    this._text = String(v ?? '');
    this.children = [];
  }
  appendChild<T extends StubEl>(child: T): T {
    child.parentNode = this;
    this.children.push(child);
    return child;
  }
  removeChild<T extends StubEl>(child: T): T {
    this.children = this.children.filter((c) => c !== child);
    child.parentNode = null;
    return child;
  }
  remove(): void {
    this.parentNode?.removeChild(this);
  }
  setAttribute(k: string, v: string): void {
    this.attrs.set(k, v);
  }
  getAttribute(k: string): string | null {
    return this.attrs.get(k) ?? null;
  }
  addEventListener(type: string, fn: (ev: any) => void): void {
    const arr = this.listeners.get(type) ?? [];
    arr.push(fn);
    this.listeners.set(type, arr);
  }
  removeEventListener(type: string, fn: (ev: any) => void): void {
    const arr = this.listeners.get(type) ?? [];
    this.listeners.set(type, arr.filter((f) => f !== fn));
  }
  dispatch(type: string, ev: any = {}): void {
    for (const fn of this.listeners.get(type) ?? []) {
      fn({ target: this, preventDefault() {}, stopPropagation() {}, ...ev });
    }
  }
  contains(node: any): boolean {
    if (node === this) return true;
    return this.children.some((c) => c.contains(node));
  }
  getBoundingClientRect() {
    return { left: 0, top: 0, right: this.clientWidth, bottom: this.clientHeight, width: this.clientWidth, height: this.clientHeight };
  }
  querySelectorAll(pred: (el: StubEl) => boolean, out: StubEl[] = []): StubEl[] {
    for (const c of this.children) {
      if (pred(c)) out.push(c);
      c.querySelectorAll(pred, out);
    }
    return out;
  }
}

function installDomStub(): () => void {
  const prevDoc = (globalThis as any).document;
  const prevWin = (globalThis as any).window;
  const head = new StubEl('head');
  (globalThis as any).document = {
    head,
    getElementById: () => null,
    querySelector: () => null,
    createElement: (tag: string) => new StubEl(tag),
    createElementNS: (_ns: string, tag: string) => new StubEl(tag),
    createTextNode: (t: string) => {
      const el = new StubEl('#TEXT');
      el.textContent = t;
      return el;
    },
    addEventListener() {},
    removeEventListener() {},
  };
  (globalThis as any).window = {
    addEventListener() {},
    removeEventListener() {},
    dispatchEvent() {},
    matchMedia: () => ({ matches: false }),
  };
  return () => {
    (globalThis as any).document = prevDoc;
    (globalThis as any).window = prevWin;
  };
}

registerDefaultLanguages();

async function run() {
  console.log('Phase 6 — Universal Ghost Text, LSP Providers, Hover/SigHelp & Markdown Sticky Scroll:');

  await test('GhostTextModel supports multi-anchor arbitrary line/col, multiline split, partial accept, cycling & edit remapping', () => {
    const gm = new GhostTextModel();
    gm.setGhostTexts(
      [
        { id: 'g1', lineNumber: 2, column: 8, text: 'hello world\n  const x = 1;\n  return x;', autoClearOnEdit: false },
        { id: 'g2', lineNumber: 6, column: 3, text: '/* second anchor */', autoClearOnEdit: true },
      ],
      'copilot',
    );

    assert.equal(gm.hasAny(), true);
    assert.equal(gm.getInlineRunsForLine(2).length, 1);
    assert.equal(gm.getInlineRunsForLine(2)[0]!.text, 'hello world');
    assert.equal(gm.getInlineRunsForLine(6)[0]!.column, 3);

    const rows = gm.getVirtualRowsForLine({
      lineNumber: 2,
      effectiveWrap: false,
      wrapWidthPx: 400,
      charWidth: 8,
      measureText: (t) => t.length * 8,
    });
    assert.equal(rows.length, 2);
    assert.equal(rows[0]!.text, '  const x = 1;');
    assert.equal(rows[1]!.text, '  return x;');

    // Edit on line 1 inserting 2 lines: persistent g1 shifts down by 2 -> line 4; autoClear g2 is cleared
    gm.onDocumentEdit(1, 2);
    assert.equal(gm.getInlineRunsForLine(4).length, 1);
    assert.equal(gm.getInlineRunsForLine(6).length, 0);

    // Word & line extractors
    assert.deepEqual(extractNextGhostWord('  fooBar(baz)'), { accepted: '  fooBar', remaining: '(baz)' });
    assert.deepEqual(extractNextGhostLine('line1\nline2\nline3'), { accepted: 'line1', remaining: '\nline2\nline3' });

    // Partial word accept on g1
    const wRes = gm.consumeAccept('word', { lineNumber: 4, column: 8 });
    assert.ok(wRes);
    assert.equal(wRes.text, 'hello');
    assert.equal(gm.getInlineRunsForLine(4)[0]!.text, ' world');
    assert.equal(gm.getInlineRunsForLine(4)[0]!.column, 13);

    // Partial line accept finishes remaining first line
    const lRes = gm.consumeAccept('line', { lineNumber: 4, column: 13 });
    assert.ok(lRes);
    assert.equal(lRes.text, ' world');

    // Candidate cycling with provider candidates
    gm.setProviderCandidates(
      [{ insertText: 'optA()' }, { insertText: 'optB()' }, { insertText: 'optC()' }],
      { lineNumber: 1, column: 5 },
    );
    assert.equal(gm.getCandidateCount(), 3);
    assert.equal(gm.getActiveCandidateIndex(), 0);
    assert.equal(gm.getInlineRunsForLine(1)[0]!.text, 'optA()');
    assert.equal(gm.nextCandidate(), true);
    assert.equal(gm.getInlineRunsForLine(1)[0]!.text, 'optB()');
    assert.equal(gm.prevCandidate(), true);
    assert.equal(gm.getInlineRunsForLine(1)[0]!.text, 'optA()');

    gm.clearGhostTexts('copilot');
    assert.equal(gm.getAllActive().every((g) => g.owner !== 'copilot'), true);
  });

  await test('InlineVirtualLayout unifies color swatches, inlay hints & inline ghost text with exact caret X and inverse hit-testing', () => {
    const line = 'const c = draw("#ff00aa", 42);';
    const charW = 8;
    const measureText = (t: string) => t.length * charW;
    const measureColX = (l: string, col: number) => (col - 1) * charW;

    const hint: ResolvedInlayHint = {
      lineNumber: 1,
      column: 27, // before "42"
      text: 'radius:',
      parts: [{ label: 'radius:' }],
      kind: InlayHintKind.Parameter,
      paddingLeft: false,
      paddingRight: true,
      marginLeftPx: 2,
      chipWidthPx: 56,
      totalAdvancePx: 62,
    };

    const elements = collectInlineVirtualElements({
      colors: [{ startColumn: 17, endColumn: 24, raw: '#ff00aa', format: 'hex', rgba: { r: 255, g: 0, b: 170, a: 1 }, lineNumber: 1 }],
      inlayHints: [hint],
      ghostRuns: [{ id: 'g1', column: 29, text: ', true', kind: 'completion' }],
      swatchAdvancePx: 16,
      measureText,
    });

    // At column 29 (where ghost starts):
    // Real text at col 29 shifts past swatch (16px) + inlay (62px) + ghost (48px)
    const realAdv = virtualAdvanceBeforeColumn(elements, 29, true);
    const caretAdv = virtualAdvanceBeforeColumn(elements, 29, false);
    assert.equal(realAdv - caretAdv, 48, 'Caret must sit to the LEFT of inline ghost text anchored at same column');
    assert.equal(caretAdv, 16 + 62, 'Caret shifts past preceding swatch and inlay hint');

    // Inverse hit-testing: clicking on column 27's text after the inlay hint resolves back to real X of column 27
    const col27X = measureColX(line, 27) + virtualAdvanceBeforeColumn(elements, 27, true) + 1;
    const mapped = mapVirtualXToRealX(line, col27X, elements, measureColX);
    assert.equal(Math.floor(mapped.realX / charW) + 1, 27);

    // Tapping directly on the inlay hint chip snaps cleanly to column 27
    const inlayMidX = measureColX(line, 27) + 16 + 20;
    const snapped = mapVirtualXToRealX(line, inlayMidX, elements, measureColX);
    assert.equal(snapped.snappedColumn, 27);

    // Wrap-aware ghost continuation rows break long lines cleanly within wrapWidthPx
    const wrapped = buildWrappedGhostRows({
      itemId: 'item1',
      extraLines: ['  const longLineOfGhostCode = computeSomethingImportant(alpha, beta, gamma);'],
      wrapWidthPx: 160,
      charWidth: charW,
      measureText,
      effectiveWrap: true,
      italic: false,
      kind: 'completion',
    });
    assert.ok(wrapped.length >= 3, `Expected >= 3 wrapped ghost rows, got ${wrapped.length}`);
    assert.equal(wrapped[0]!.indentPx, 0, 'First sub-row carries inline leading whitespace');
    assert.equal(wrapped[1]!.indentPx, 16, 'Wrapped continuation preserves 2-space indentPx');
  });

  await test('ViewLineProjection projects multiline virtual ghost rows with blank gutter, folding & word-wrap', () => {
    const model = new TextModel('function a() {\n  const x = 1;\n  return x;\n}\nconst after = 2;');
    const folding = new FoldingModel(model);
    folding.updateSync();
    const proj = new ViewLineProjection();

    const ghostMap = new Map<number, { itemId: string; text: string; indentPx: number; kind: 'completion' }[]>([
      [
        2,
        [
          { itemId: 'g1', text: '  const y = x * 2;', indentPx: 16, kind: 'completion' },
          { itemId: 'g1', text: '  console.log(y);', indentPx: 16, kind: 'completion' },
        ],
      ],
    ]);

    proj.sync({
      model,
      modelVersion: model.getVersionId(),
      foldVersion: folding.version,
      hasFolds: folding.hasCollapsed(),
      isLineHidden: (ln) => folding.isLineHidden(ln),
      wordWrap: 'on',
      wrappingIndent: 'same',
      wrapWidthPx: 220,
      tabSize: 2,
      charWidth: 8,
      measureColumnX: (_l, col) => (col - 1) * 8,
      ghostVersion: 1,
      hasGhostRows: true,
      getLineGhostRows: (ln) => ghostMap.get(ln) ?? [],
    });

    // 5 real lines + 2 virtual ghost continuation rows = 7 visual rows
    assert.equal(proj.getVisualLineCount(), 7);
    assert.equal(proj.getVisualLine(0).modelLine, 1);
    assert.equal(proj.getVisualLine(1).modelLine, 2);
    assert.equal(proj.getVisualLine(1).isVirtualGhost, undefined);
    assert.equal(proj.getVisualLine(2).isVirtualGhost, true);
    assert.equal(proj.getVisualLine(2).ghostText, '  const y = x * 2;');
    assert.equal(proj.getVisualLine(3).isVirtualGhost, true);
    assert.equal(proj.getVisualLine(3).ghostText, '  console.log(y);');
    assert.equal(proj.getVisualLine(4).modelLine, 3);
    assert.equal(proj.modelToVisual(3, 1).visualRow, 4, 'Line 3 shifts down by 2 virtual ghost rows');
  });

  await test('MarkdownScopeFinder pins # -> ## -> ### hierarchy & ignores fenced code blocks; OutlineScopeFinder works with DocumentSymbols', () => {
    const md = [
      '# Top Guide',
      'Intro text',
      '## Architecture',
      'Details',
      '```bash',
      '# not a markdown heading inside bash fence',
      'echo "hello"',
      '```',
      '### Rendering Pipeline',
      'Line 10 body',
      'Line 11 body',
      '## Deployment',
      'Deploy line',
    ].join('\n');

    const mdModel = new TextModel(md, 'markdown');
    const mdFinder = new MarkdownScopeFinder(mdModel);

    // Line 10 is inside # Top Guide (1) -> ## Architecture (3) -> ### Rendering Pipeline (9)
    const chain10 = mdFinder.chain(10).map((s) => s.header);
    assert.deepEqual(chain10, [1, 3, 9], 'Must nest # -> ## -> ### and skip fenced # comment on line 6');

    // Line 13 is inside # Top Guide (1) -> ## Deployment (12)
    const chain13 = mdFinder.chain(13).map((s) => s.header);
    assert.deepEqual(chain13, [1, 12]);

    // OutlineScopeFinder backed by DocumentSymbol tree
    const tsModel = new TextModel('class A {\n  run() {\n    const x = 1;\n    return x;\n  }\n}\n', 'typescript');
    const symbols: DocumentSymbol[] = [
      {
        name: 'A',
        kind: SymbolKind.Class,
        range: { startLineNumber: 1, startColumn: 1, endLineNumber: 6, endColumn: 2 },
        selectionRange: { startLineNumber: 1, startColumn: 7, endLineNumber: 1, endColumn: 8 },
        children: [
          {
            name: 'run',
            kind: SymbolKind.Method,
            range: { startLineNumber: 2, startColumn: 3, endLineNumber: 5, endColumn: 4 },
            selectionRange: { startLineNumber: 2, startColumn: 3, endLineNumber: 2, endColumn: 6 },
          },
        ],
      },
    ];
    const outline = new OutlineScopeFinder(tsModel, symbols);
    assert.deepEqual(outline.chain(4).map((s) => s.header), [1, 2]);
  });

  await test('SemanticTokens decoder, incremental delta edits & SemanticTokensCache map types & modifiers accurately', () => {
    const legend = {
      tokenTypes: ['function', 'variable', 'class', 'property'],
      tokenModifiers: ['declaration', 'readonly', 'deprecated', 'static'],
    };
    // Line 0 col 0 len 3: function + declaration (bit 0)
    // Line 0 col 5 len 4: variable + readonly (bit 1) -> maps to 'constant'
    // Line 2 col 2 len 6: property + deprecated (bit 2) + static (bit 3)
    const raw = new Uint32Array([
      0, 0, 3, 0, 1 << 0,
      0, 5, 4, 1, 1 << 1,
      2, 2, 6, 3, (1 << 2) | (1 << 3),
    ]);

    const decoded = decodeSemanticTokens(raw, legend);
    assert.equal(decoded.get(1)!.length, 2);
    assert.equal(decoded.get(1)![0]!.tokenType, 'function');
    assert.equal(decoded.get(1)![0]!.bold, true);
    assert.equal(decoded.get(1)![1]!.tokenType, 'constant');
    assert.equal(decoded.get(3)![0]!.strikethrough, true);
    assert.equal(decoded.get(3)![0]!.italic, true);

    // Apply delta edit replacing the second token with class
    const edited = applySemanticTokenEdits(raw, [{ start: 5, deleteCount: 5, data: [0, 5, 4, 2, 0] }]);
    const cache = new SemanticTokensCache();
    cache.setFull(raw, legend, 'v1');
    cache.applyEdits([{ start: 5, deleteCount: 5, data: [0, 5, 4, 2, 0] }], legend, 'v2');
    assert.equal(cache.getResultId(), 'v2');
    assert.equal(cache.getLineSpans(1)[1]!.tokenType, 'class');
    assert.deepEqual(Array.from(edited), Array.from([0, 0, 3, 0, 1, 0, 5, 4, 2, 0, 2, 2, 6, 3, 12]));
  });

  await test('analyzeCallContext handles multi-line nested calls & strings; resolveParameterLabelRange finds exact parameter bounds', () => {
    const code = [
      'const out = fetchData(',
      '  "https://example.com/a,b,c",',
      '  helper(1, 2, 3),',
      '  { retry: true }',
      ');',
    ].join('\n');
    const model = new TextModel(code, 'typescript');

    const ctxArg0 = analyzeCallContext(model, { lineNumber: 2, column: 6 });
    assert.ok(ctxArg0);
    assert.equal(ctxArg0.calleeName, 'fetchData');
    assert.equal(ctxArg0.activeParameter, 0);

    const ctxNested = analyzeCallContext(model, { lineNumber: 3, column: 14 });
    assert.ok(ctxNested);
    assert.equal(ctxNested.calleeName, 'helper');
    assert.equal(ctxNested.activeParameter, 1);

    // Caret inside object literal arg `{ retry: true }` still tracks outer fetchData arg 2!
    const ctxArg2 = analyzeCallContext(model, { lineNumber: 4, column: 8 });
    assert.ok(ctxArg2);
    assert.equal(ctxArg2.calleeName, 'fetchData');
    assert.equal(ctxArg2.activeParameter, 2);

    const sig = 'fetchData(url: string, transform: (x: number, y: number) => void, opts?: RequestInit): Promise<Response>';
    const rTuple = resolveParameterLabelRange(sig, [10, 21], 0);
    assert.deepEqual(rTuple, [10, 21]);
    assert.equal(sig.slice(rTuple![0], rTuple![1]), 'url: string');

    const rString = resolveParameterLabelRange(sig, 'opts?: RequestInit', 2);
    assert.ok(rString);
    assert.equal(sig.slice(rString[0], rString[1]), 'opts?: RequestInit');
  });

  await test('ColorDecoratorController defaults colorDecoratorsOpenOnHover to false and requires explicit opt-in', () => {
    const cleanup = installDomStub();
    try {
      const root = new StubEl('div') as any;
      const model = new TextModel('const c = "#ff5500";', 'typescript');
      let pickerShown = 0;

      const host: any = {
        root,
        initialOptions: {}, // default!
        getModel: () => model,
        isReadOnly: () => false,
        isDisposed: () => false,
        view: {
          setLineColorsProvider() {},
          schedulePaint() {},
          getColorHits: () => [
            {
              match: { lineNumber: 1, startColumn: 12, endColumn: 19, raw: '#ff5500', format: 'hex', rgba: { r: 255, g: 85, b: 0, a: 1 } },
              x: 100,
              y: 10,
              w: 16,
              h: 20,
            },
          ],
        },
        executeEdits() { return true; },
        focus() {},
      };

      const ctrl = new ColorDecoratorController(host);
      assert.equal(ctrl.isOpenOnHover(), false, 'colorDecoratorsOpenOnHover must default to false');

      // Spy on internal picker.open
      (ctrl as any).picker.open = () => {
        pickerShown++;
      };

      // Default: mouse pointermove over swatch must NOT open picker or arm hover timer
      root.dispatch('pointermove', { pointerType: 'mouse', clientX: 105, clientY: 15 });
      assert.equal(pickerShown, 0, 'Hovering color swatch must NOT open picker when colorDecoratorsOpenOnHover is false');
      assert.equal((ctrl as any).hoverTimer, null, 'Hover timer must stay null when colorDecoratorsOpenOnHover is false');

      // Tapping/clicking swatch DOES open picker
      ctrl.onColorSwatchClick(host.view.getColorHits()[0]);
      assert.equal(pickerShown, 1, 'Explicit tap/click must open ColorPicker');

      // Opt-in via updateOptions({ colorDecoratorsOpenOnHover: true })
      ctrl.onOptionsChange({ colorDecoratorsOpenOnHover: true });
      assert.equal(ctrl.isOpenOnHover(), true);

      ctrl.dispose();
    } finally {
      cleanup();
    }
  });

  await test('All 13 new LSP languages.register* providers register, query, and dispose cleanly', () => {
    const d1 = languages.registerInlineCompletionsProvider('ts', { provideInlineCompletions: () => ({ items: [{ insertText: 'x' }] }) });
    const d2 = languages.registerInlayHintsProvider('ts', { provideInlayHints: () => [] });
    const d3 = languages.registerTypeDefinitionProvider('ts', { provideTypeDefinition: () => null });
    const d4 = languages.registerImplementationProvider('ts', { provideImplementation: () => null });
    const d5 = languages.registerDeclarationProvider('ts', { provideDeclaration: () => null });
    const d6 = languages.registerDocumentHighlightProvider('ts', { provideDocumentHighlights: () => [{ range: { startLineNumber: 1, startColumn: 1, endLineNumber: 1, endColumn: 2 }, kind: DocumentHighlightKind.Read }] });
    const d7 = languages.registerDocumentSymbolProvider('ts', { provideDocumentSymbols: () => [] });
    const d8 = languages.registerLinkProvider('ts', { provideLinks: () => ({ links: [] }) });
    const d9 = languages.registerSelectionRangeProvider('ts', { provideSelectionRanges: () => [] });
    const d10 = languages.registerOnTypeFormattingEditProvider('ts', { autoFormatTriggerCharacters: [';'], provideOnTypeFormattingEdits: () => [] });
    const d11 = languages.registerDocumentSemanticTokensProvider('ts', { getLegend: () => ({ tokenTypes: [], tokenModifiers: [] }), provideDocumentSemanticTokens: () => null });
    const d12 = languages.registerDocumentRangeSemanticTokensProvider('ts', { getLegend: () => ({ tokenTypes: [], tokenModifiers: [] }), provideDocumentRangeSemanticTokens: () => null });
    const d13 = languages.registerDocumentPasteEditProvider('ts', { provideDocumentPasteEdits: () => null });

    assert.ok(languageFeatures.getInlineCompletionsProviders('ts').length >= 1);
    assert.ok(languageFeatures.getInlayHintsProviders('ts').length >= 1);
    assert.ok(languageFeatures.getTypeDefinitionProviders('ts').length >= 1);
    assert.ok(languageFeatures.getImplementationProviders('ts').length >= 1);
    assert.ok(languageFeatures.getDeclarationProviders('ts').length >= 1);
    assert.ok(languageFeatures.getDocumentHighlightProviders('ts').length >= 1);
    assert.ok(languageFeatures.getDocumentSymbolProviders('ts').length >= 1);
    assert.ok(languageFeatures.getLinkProviders('ts').length >= 1);
    assert.ok(languageFeatures.getSelectionRangeProviders('ts').length >= 1);
    assert.ok(languageFeatures.getOnTypeFormattingProviders('ts').length >= 1);
    assert.ok(languageFeatures.getDocumentSemanticTokensProviders('ts').length >= 1);
    assert.ok(languageFeatures.getDocumentRangeSemanticTokensProviders('ts').length >= 1);
    assert.ok(languageFeatures.getDocumentPasteEditProviders('ts').length >= 1);

    [d1, d2, d3, d4, d5, d6, d7, d8, d9, d10, d11, d12, d13].forEach((d) => d.dispose());
    assert.equal(languageFeatures.getInlineCompletionsProviders('ts').length, 0);
    assert.equal(languageFeatures.getInlayHintsProviders('ts').length, 0);
    assert.equal(languageFeatures.getDocumentPasteEditProviders('ts').length, 0);
  });

  await test('Unified HoverWidget renders diagnostics + syntax-highlighted code blocks + interactive footer actions safely', () => {
    const cleanup = installDomStub();
    try {
      const root = new StubEl('div') as any;
      const widget = new HoverWidget(root);
      widget.applyTheme(resolveWidgetTheme(DEFAULT_THEME));

      let invoked = '';
      widget.showCard(
        {
          diagnostics: [
            {
              owner: 'ts',
              severity: MarkerSeverity.Error,
              message: "Type 'string' is not assignable to type 'number'.",
              source: 'ts',
              code: '2322',
              startLineNumber: 1,
              startColumn: 1,
              endLineNumber: 1,
              endColumn: 5,
            },
          ],
          contents: [
            '```ts\nfunction compute(x: number): number\n```\nComputes a **scaled** result.',
          ],
          actions: [
            { label: 'Quick Fix...', run: () => { invoked = 'quickFix'; } },
            { label: 'Go to Definition', run: () => { invoked = 'def'; } },
          ],
        },
        { x: 120, y: 80, top: 60 },
      );

      assert.equal(widget.isVisible(), true);
      const text = (widget as any).el.textContent;
      assert.ok(text.includes("Type 'string' is not assignable"), 'Diagnostic section rendered');
      assert.ok(text.includes('(ts 2322)'), 'Diagnostic source+code rendered');
      assert.ok(text.includes('function compute'), 'Syntax-highlighted fenced code block rendered');
      assert.ok(text.includes('Computes a scaled result.'), 'Markdown prose rendered');

      const buttons = (widget as any).el.querySelectorAll((e: StubEl) => e.tagName === 'BUTTON');
      assert.equal(buttons.length, 2);
      buttons[0]!.dispatch('click');
      assert.equal(invoked, 'quickFix');

      widget.dispose();
    } finally {
      cleanup();
    }
  });

  await test('SignatureHelpWidget syntax-highlights signature, underlines active parameter & switches overloads cleanly', () => {
    const cleanup = installDomStub();
    try {
      const root = new StubEl('div') as any;
      let cycledDelta = 0;
      const widget = new SignatureHelpWidget(root, {
        onPrev: () => { cycledDelta = -1; },
        onNext: () => { cycledDelta = 1; },
      });
      widget.applyTheme(resolveWidgetTheme(DEFAULT_THEME));

      widget.show(
        {
          activeSignature: 0,
          activeParameter: 1,
          signatures: [
            {
              label: 'fetchData(url: string, opts?: RequestInit): Promise<Response>',
              documentation: 'Performs a typed HTTP request.',
              parameters: [
                { label: 'url: string', documentation: 'Target URL' },
                { label: 'opts?: RequestInit', documentation: 'Optional fetch config' },
              ],
            },
            {
              label: 'fetchData(req: Request): Promise<Response>',
              parameters: [{ label: 'req: Request' }],
            },
          ],
        },
        { x: 140, y: 120, top: 100, languageId: 'typescript' },
      );

      assert.equal(widget.isVisible(), true);
      const text = (widget as any).el.textContent;
      assert.ok(text.includes('1/2'), 'Overload counter 1/2 rendered');
      assert.ok(text.includes('Optional fetch config'), 'Active parameter documentation rendered');

      // Active parameter span should be bold + underlined
      const activeSpans = (widget as any).el.querySelectorAll(
        (e: StubEl) => e.tagName === 'SPAN' && e.style.fontWeight === '700' && (e.style.textDecoration === 'underline' || e.style.textDecorationLine === 'underline'),
      );
      assert.equal(activeSpans.length, 1);
      assert.equal(activeSpans[0]!.textContent, 'opts?: RequestInit');

      // Overload next button triggers onNext callback
      const buttons = (widget as any).el.querySelectorAll((e: StubEl) => e.tagName === 'BUTTON');
      assert.ok(buttons.length >= 2);
      buttons[1]!.dispatch('click');
      assert.equal(cycledDelta, 1);

      widget.dispose();
    } finally {
      cleanup();
    }
  });

  await test('SelectionRangeController expands word -> parens -> line -> doc and shrinks back cleanly', async () => {
    const model = new TextModel('const res = compute("hello_world");\nconst b = 2;', 'typescript');
    const selection = new SelectionState();
    selection.setCaret(1, 24); // inside "hello_world"
    const keybindings = new KeybindingService();
    const commands = new CommandService(keybindings);

    const host: any = {
      getModel: () => model,
      selection,
      keybindings,
      commands,
      getPosition: () => selection.active,
      getSelection: () => {
        const a = selection.anchor;
        const b = selection.active;
        const fwd = a.lineNumber < b.lineNumber || (a.lineNumber === b.lineNumber && a.column <= b.column);
        const start = fwd ? a : b;
        const end = fwd ? b : a;
        return {
          startLineNumber: start.lineNumber,
          startColumn: start.column,
          endLineNumber: end.lineNumber,
          endColumn: end.column,
        };
      },
      getLanguageIdAtPosition: () => 'typescript',
      modelAsFeatureLike: () => ({}),
      view: { ensureCaretVisible() {}, paint() {} },
      syncTextarea() {},
      emitCursorEvents() {},
    };

    const ctrl = new SelectionRangeController(host);
    const readSel = () => {
      const r = host.getSelection();
      return model.getLineContent(r.startLineNumber).slice(r.startColumn - 1, r.endColumn - 1);
    };

    // 1. Expand to word: hello_world (col 22..33)
    assert.equal(await ctrl.expandSelection(), true);
    assert.equal(readSel(), 'hello_world');

    // 2. Expand to quotes: "hello_world"
    assert.equal(await ctrl.expandSelection(), true);
    assert.equal(readSel(), '"hello_world"');

    // 3. Expand to parens: ("hello_world")
    assert.equal(await ctrl.expandSelection(), true);
    assert.equal(readSel(), '("hello_world")');

    // 4. Shrink back to "hello_world"
    assert.equal(ctrl.shrinkSelection(), true);
    assert.equal(readSel(), '"hello_world"');

    // 5. Shrink back to hello_world
    assert.equal(ctrl.shrinkSelection(), true);
    assert.equal(readSel(), 'hello_world');

    assert.ok(commands.getCommands().some((c) => c.id === MonoCommands.SmartSelectExpand));
    assert.ok(commands.getCommands().some((c) => c.id === MonoCommands.SmartSelectShrink));
    ctrl.dispose();
  });

  console.log(`All ${passed} Phase 6 tests passed!`);
}

run().catch((err) => {
  console.error(err);
  process.exit(1);
});
