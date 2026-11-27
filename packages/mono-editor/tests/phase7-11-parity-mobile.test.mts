import assert from 'node:assert/strict';
import {
  BUILTIN_THEME_IDS,
  ContentWidgetPositionPreference,
  EndOfLineSequence,
  HC_BLACK_ID,
  MarkerSeverity,
  MarkerTag,
  MonoCommands,
  MonoDiffEditor,
  MouseTargetType,
  OverlayWidgetPositionPreference,
  ScrollType,
  SymbolKind,
  TrackedRangeStickiness,
  Uri,
  computeLineDiff,
  convertIndentation,
  deleteDuplicateLines,
  editor,
  getLanguageConfiguration,
  getLanguages,
  joinLines,
  languageFeatures,
  languages,
  monoThemeService,
  registerBuiltinThemes,
  registerDefaultLanguageConfigurations,
  registerDefaultLanguages,
  resolveWidgetTheme,
  sortLines,
  transformCase,
  transposeCharacters,
  trimTrailingWhitespace,
} from '../src/index';
import { DEFAULT_THEME } from '../src/common/config/themeTypes';
import { SelectionState } from '../src/common/core/SelectionState';
import { DecorationsCollection } from '../src/common/decorations/DecorationsCollection';
import { indentSelectionLines, outdentSelectionLines } from '../src/common/editOperations/indentOperations';
import { TextModel } from '../src/common/model/TextModel';
import { computeEditorLayoutInfo } from '../src/browser/editor/editorViewFacade';
import { TextAreaBridge } from '../src/browser/input/textAreaBridge';
import { EditorWidgetManager } from '../src/browser/view/WidgetManagers';
import { CodeLensController } from '../src/contrib/codeLens/CodeLensController';
import { LinkedEditingController } from '../src/contrib/linkedEditing/LinkedEditingController';
import { MobileController } from '../src/contrib/mobile/MobileController';
import { QuickNavController } from '../src/contrib/quickNav/QuickNavController';
import { CommandService } from '../src/platform/commands/CommandService';
import { KeybindingService } from '../src/platform/keybindings/KeybindingService';

let passed = 0;
async function test(name: string, fn: () => void | Promise<void>) {
  await fn();
  passed++;
  console.log(`  ok  ${name}`);
}

// ── Minimal Safe DOM Stub for Headless Node Testing ──────────────────────────
class StubNode {
  tagName: string;
  className = '';
  width = 800;
  height = 600;
  clientWidth = 800;
  clientHeight = 600;
  style: Record<string, any> = {
    setProperty(k: string, v: string) { (this as any)[k] = v; },
    removeProperty(k: string) { delete (this as any)[k]; },
  };
  dataset: Record<string, string> = {};
  attrs = new Map<string, string>();
  children: StubNode[] = [];
  parentNode: StubNode | null = null;
  listeners = new Map<string, Array<(ev: any) => void>>();
  value = '';
  type = '';
  title = '';
  placeholder = '';
  autocomplete = '';
  autocapitalize = '';
  spellcheck = false;
  readOnly = false;
  tabIndex = 0;
  private _text = '';
  rect = { left: 0, top: 0, right: 800, bottom: 600, width: 800, height: 600 };

  constructor(tag: string) {
    this.tagName = tag.toUpperCase();
  }
  getContext() {
    return {
      fillStyle: '', strokeStyle: '', font: '', textBaseline: 'top', lineWidth: 1, globalAlpha: 1,
      shadowColor: '', shadowBlur: 0, shadowOffsetY: 0,
      save() {}, restore() {}, scale() {}, translate() {}, rotate() {}, setTransform() {},
      clearRect() {}, fillRect() {}, strokeRect() {}, beginPath() {}, closePath() {},
      rect() {}, clip() {}, moveTo() {}, lineTo() {}, arc() {}, quadraticCurveTo() {}, bezierCurveTo() {},
      fill() {}, stroke() {}, fillText() {}, setLineDash() {},
      measureText(s: string) { return { width: s.length * 8 }; },
    };
  }
  get textContent(): string {
    return this.children.length ? this.children.map((c) => c.textContent).join('') : this._text;
  }
  set textContent(v: string) {
    this._text = String(v ?? '');
    this.children = [];
  }
  setAttribute(k: string, v: string) { this.attrs.set(k, String(v)); }
  getAttribute(k: string) { return this.attrs.get(k) ?? null; }
  removeAttribute(k: string) { this.attrs.delete(k); }
  appendChild<T extends StubNode>(c: T): T {
    if (c.tagName === '#FRAGMENT') {
      for (const grand of [...c.children]) this.appendChild(grand);
      c.children = [];
      return c;
    }
    c.parentNode = this;
    this.children.push(c);
    return c;
  }
  append(...nodes: StubNode[]) { for (const n of nodes) this.appendChild(n); }
  replaceChildren(...nodes: StubNode[]) {
    this.children = [];
    for (const n of nodes) this.appendChild(n);
  }
  remove() {
    if (!this.parentNode) return;
    this.parentNode.children = this.parentNode.children.filter((x) => x !== this);
    this.parentNode = null;
  }
  contains(node: StubNode | null): boolean {
    if (!node) return false;
    if (node === this) return true;
    return this.children.some((c) => c.contains(node));
  }
  addEventListener(type: string, fn: (ev: any) => void) {
    const arr = this.listeners.get(type) ?? [];
    arr.push(fn);
    this.listeners.set(type, arr);
  }
  removeEventListener(type: string, fn: (ev: any) => void) {
    const arr = this.listeners.get(type) ?? [];
    this.listeners.set(type, arr.filter((f) => f !== fn));
  }
  dispatch(type: string, ev: Record<string, unknown> = {}) {
    const payload = {
      defaultPrevented: false,
      preventDefault() { this.defaultPrevented = true; },
      stopPropagation() { /* */ },
      ...ev,
    };
    for (const fn of this.listeners.get(type) ?? []) fn(payload);
    return payload;
  }
  focus() { /* no-op */ }
  select() { /* no-op */ }
  scrollIntoView() { /* no-op */ }
  getBoundingClientRect() { return { ...this.rect }; }
  querySelectorAll(predicate: (n: StubNode) => boolean, out: StubNode[] = []): StubNode[] {
    for (const c of this.children) {
      if (predicate(c)) out.push(c);
      c.querySelectorAll(predicate, out);
    }
    return out;
  }
  querySelector(): StubNode | null { return null; }
}

function installDomStub() {
  const vvListeners = new Map<string, Set<() => void>>();
  const visualViewport = {
    height: 800,
    width: 390,
    offsetTop: 0,
    offsetLeft: 0,
    addEventListener(t: string, cb: () => void) {
      const s = vvListeners.get(t) ?? new Set();
      s.add(cb);
      vvListeners.set(t, s);
    },
    removeEventListener(t: string, cb: () => void) {
      vvListeners.get(t)?.delete(cb);
    },
    fire(t: string) {
      for (const cb of vvListeners.get(t) ?? []) cb();
    },
  };

  const docHead = new StubNode('head');
  const docBody = new StubNode('body');
  (globalThis as any).document = {
    head: docHead,
    body: docBody,
    getElementById: () => null,
    createElement: (tag: string) => new StubNode(tag),
    createTextNode: (text: string) => {
      const n = new StubNode('#TEXT');
      n.textContent = text;
      return n;
    },
    createDocumentFragment: () => new StubNode('#FRAGMENT'),
    addEventListener: () => {},
    removeEventListener: () => {},
    activeElement: null,
  };
  (globalThis as any).window = {
    devicePixelRatio: 1,
    innerWidth: 1024,
    innerHeight: 768,
    matchMedia: () => ({ matches: false }),
    visualViewport,
    addEventListener: () => {},
    removeEventListener: () => {},
    dispatchEvent: () => true,
  };
  (globalThis as any).requestAnimationFrame = () => 1;
  (globalThis as any).cancelAnimationFrame = () => {};
  (globalThis as any).ResizeObserver = class {
    observe() {}
    unobserve() {}
    disconnect() {}
  };
  return { visualViewport };
}

const { visualViewport } = installDomStub();
registerDefaultLanguages();
registerDefaultLanguageConfigurations();
registerBuiltinThemes();

console.log('Running Phase 7–11 Parity & Mobile Test Suite...');

// ── 1. Granular Content Deltas & Standalone Model Parity ─────────────────────
await test('Granular TextModel content changes: insert, undo, redo, flush', () => {
  const m = new TextModel('hello world', 'typescript');
  const events: any[] = [];
  m.onDidChange((versionId, change) => events.push({ versionId, change }));

  m.applyEdit({ startOffset: 5, endOffset: 11, text: ' mono' });
  assert.equal(m.getValue(), 'hello mono');
  assert.equal(events.length, 1);
  assert.equal(events[0].change.isUndoing, false);
  assert.equal(events[0].change.isRedoing, false);
  assert.equal(events[0].change.isFlush, false);
  assert.equal(events[0].change.changes.length, 1);
  assert.deepEqual(events[0].change.changes[0], {
    range: { startLineNumber: 1, startColumn: 6, endLineNumber: 1, endColumn: 12 },
    rangeOffset: 5,
    rangeLength: 6,
    text: ' mono',
  });

  m.undo();
  assert.equal(m.getValue(), 'hello world');
  assert.equal(events[1].change.isUndoing, true);
  assert.equal(events[1].change.isRedoing, false);

  m.redo();
  assert.equal(m.getValue(), 'hello mono');
  assert.equal(events[2].change.isRedoing, true);
  assert.equal(events[2].change.isUndoing, false);

  m.setValue('replaced');
  assert.equal(events[3].change.isFlush, true);
  assert.equal(events[3].change.full, true);
});

await test('Full IStandaloneTextModel parity & lifecycle events', () => {
  const created: string[] = [];
  const disposed: string[] = [];
  const langChanges: string[] = [];
  const s1 = editor.onDidCreateModel((m) => created.push(m.uri.toString()));
  const s2 = editor.onWillDisposeModel((m) => disposed.push(m.uri.toString()));
  const s3 = editor.onDidChangeModelLanguage((e) => langChanges.push(`${e.oldLanguage}->${e.model.getLanguageId()}`));

  const uri = Uri.parse('file:///parity-test.ts');
  const model = editor.createModel('    const alpha = 1;\n    const beta = alpha + 2;\n', 'typescript', uri);
  assert.ok(created.includes(uri.toString()));
  assert.equal(model.getLineLength(1), 20);
  assert.equal(model.getLineFirstNonWhitespaceColumn(1), 5);
  assert.equal(model.getLineLastNonWhitespaceColumn(1), 21);
  assert.equal(model.getLinesContent().length, 3);
  assert.equal(
    model.getValueInRange({ startLineNumber: 1, startColumn: 11, endLineNumber: 1, endColumn: 16 }),
    'alpha',
  );
  assert.deepEqual(model.getWordAtPosition({ lineNumber: 1, column: 13 }), {
    word: 'alpha',
    startColumn: 11,
    endColumn: 16,
  });
  assert.deepEqual(model.getWordUntilPosition({ lineNumber: 1, column: 14 }), {
    word: 'alp',
    startColumn: 11,
    endColumn: 14,
  });
  assert.deepEqual(model.validatePosition({ lineNumber: 99, column: 99 }), { lineNumber: 3, column: 1 });
  assert.deepEqual(model.modifyPosition({ lineNumber: 1, column: 5 }, 5), { lineNumber: 1, column: 10 });

  const matches = model.findMatches('alpha', true, false, true, null, false);
  assert.equal(matches.length, 2);
  const next = model.findNextMatch('alpha', { lineNumber: 1, column: 12 }, false, true, null, false);
  assert.equal(next?.range.startLineNumber, 2);
  const prev = model.findPreviousMatch('alpha', { lineNumber: 2, column: 1 }, false, true, null, false);
  assert.equal(prev?.range.startLineNumber, 1);

  model.detectIndentation(true, 2);
  assert.equal(model.getOptions().insertSpaces, true);
  assert.equal(model.getOptions().tabSize, 4);

  let optsFired = false;
  model.onDidChangeOptions(() => { optsFired = true; });
  model.updateOptions({ insertSpaces: false, tabSize: 2 });
  assert.equal(optsFired, true);
  assert.equal(model.getOptions().insertSpaces, false);

  let decFired = false;
  model.onDidChangeDecorations(() => { decFired = true; });
  const decIds = model.deltaDecorations([], [
    { range: { startLineNumber: 1, startColumn: 1, endLineNumber: 1, endColumn: 5 }, options: { glyphMarginClassName: 'breakpoint' } },
  ]);
  assert.equal(decFired, true);
  assert.equal(model.getAllDecorations().length, 1);
  assert.equal(model.getDecorationsInRange({ startLineNumber: 1, startColumn: 1, endLineNumber: 1, endColumn: 10 }).length, 1);
  model.deltaDecorations(decIds, []);
  assert.equal(model.getAllDecorations().length, 0);

  let contentDeltaCount = 0;
  model.onDidChangeContent((e) => {
    contentDeltaCount += e.changes.length;
    assert.equal(e.eol, '\n');
  });
  model.pushEditOperations(null, [
    { range: { startLineNumber: 1, startColumn: 11, endLineNumber: 1, endColumn: 16 }, text: 'gamma' },
  ]);
  assert.equal(contentDeltaCount, 1);
  assert.ok(model.getLineContent(1).includes('gamma'));

  let localLang = '';
  model.onDidChangeLanguage((e) => { localLang = `${e.oldLanguage}->${e.newLanguage}`; });
  editor.setModelLanguage(model, 'javascript');
  assert.equal(localLang, 'typescript->javascript');
  assert.ok(langChanges.includes('typescript->javascript'));

  let willDisposeCalled = false;
  model.onWillDispose(() => { willDisposeCalled = true; });
  model.dispose();
  assert.equal(willDisposeCalled, true);
  assert.equal(model.isDisposed(), true);
  assert.ok(disposed.includes(uri.toString()));

  s1.dispose(); s2.dispose(); s3.dispose();
});

// ── 2. Phase 6 Daily Editing & Indentation Operations ────────────────────────
await test('Phase 6 line transforms: join, sort, dedupe, transpose, case, trim, convertIndent', () => {
  const m = new TextModel('banana  \napple\nbanana  \ncherry\t\n', 'plaintext');

  const lines1to4 = { startLineNumber: 1, startColumn: 1, endLineNumber: 4, endColumn: 8 };
  sortLines(m, lines1to4, 'asc');
  assert.equal(m.getLineContent(1), 'apple');
  assert.equal(m.getLineContent(4), 'cherry\t');

  sortLines(m, lines1to4, 'desc');
  assert.equal(m.getLineContent(1), 'cherry\t');

  deleteDuplicateLines(m, lines1to4);
  assert.equal(m.getLineCount(), 4); // cherry, banana, apple, ''

  trimTrailingWhitespace(m);
  assert.equal(m.getLineContent(1), 'cherry');
  assert.equal(m.getLineContent(2), 'banana');

  joinLines(m, { startLineNumber: 1, startColumn: 1, endLineNumber: 1, endColumn: 1 });
  assert.equal(m.getLineContent(1), 'cherry banana');

  const line1All = { startLineNumber: 1, startColumn: 1, endLineNumber: 1, endColumn: 14 };
  transformCase(m, line1All, 'upper');
  assert.equal(m.getLineContent(1), 'CHERRY BANANA');
  transformCase(m, line1All, 'lower');
  assert.equal(m.getLineContent(1), 'cherry banana');
  transformCase(m, line1All, 'title');
  assert.equal(m.getLineContent(1), 'Cherry Banana');

  // Transpose characters around column 2 ('C|h' -> 'hC')
  transposeCharacters(m, { lineNumber: 1, column: 2 });
  assert.equal(m.getLineContent(1).startsWith('hC'), true);

  // Convert indentation spaces <-> tabs + insertSpaces: false
  const m2 = new TextModel('    const x = 1;\n        return x;', 'typescript');
  convertIndentation(m2, false, 4);
  assert.equal(m2.getLineContent(1), '\tconst x = 1;');
  assert.equal(m2.getLineContent(2), '\t\treturn x;');
  convertIndentation(m2, true, 2);
  assert.equal(m2.getLineContent(1), '  const x = 1;');
  assert.equal(m2.getLineContent(2), '    return x;');

  const s2 = new SelectionState();
  s2.setCaret(1, 1);
  indentSelectionLines(m2, s2, 2, false);
  assert.equal(m2.getLineContent(1), '\t  const x = 1;');
  outdentSelectionLines(m2, s2, 2);
  assert.equal(m2.getLineContent(1), '  const x = 1;');
});

// ── 3. Phase 7 Widgets, Multi-Zone ViewZones, LayoutInfo, Decorations ────────
await test('EditorWidgetManager: ContentWidget, OverlayWidget & multi-zone changeViewZones', () => {
  const root = new StubNode('div') as unknown as HTMLDivElement;
  const zones: any[] = [];
  const mgr = new EditorWidgetManager({
    root,
    getLineHeight: () => 20,
    getContentLeft: () => 48,
    getCssWidth: () => 640,
    getCssHeight: () => 400,
    screenPosOf: () => ({ x: 100, y: 40, h: 20 }),
    getZoneTopForLine: (afterLine) => afterLine * 20,
    onZonesChanged: (next) => {
      zones.length = 0;
      zones.push(...next);
    },
  });
  const cwNode = new StubNode('div') as unknown as HTMLElement;
  const cw = {
    getId: () => 'cw.1',
    getDomNode: () => cwNode,
    getPosition: () => ({ position: { lineNumber: 2, column: 5 }, preference: [ContentWidgetPositionPreference.BELOW] }),
  };
  mgr.addContentWidget(cw);
  assert.equal(cwNode.style.left, '100px');
  assert.equal(cwNode.style.top, '60px');

  const owNode = new StubNode('div') as unknown as HTMLElement;
  const ow = {
    getId: () => 'ow.1',
    getDomNode: () => owNode,
    getPosition: () => ({ preference: OverlayWidgetPositionPreference.TOP_RIGHT_CORNER }),
  };
  mgr.addOverlayWidget(ow);
  assert.ok(owNode.style.right !== '' || owNode.style.left !== '');

  let z1 = '';
  let z2 = '';
  mgr.changeViewZones((acc) => {
    z1 = acc.addZone({ afterLineNumber: 1, heightInPx: 20, domNode: new StubNode('div') as any });
    z2 = acc.addZone({ afterLineNumber: 4, heightInPx: 140, domNode: new StubNode('div') as any });
  });
  assert.equal(zones.length, 2);
  assert.ok(z1 && z2 && z1 !== z2);

  mgr.changeViewZones((acc) => { acc.removeZone(z1); });
  assert.equal(zones.length, 1);
  assert.equal(zones[0].id, z2);

  mgr.removeContentWidget(cw);
  mgr.removeOverlayWidget(ow);
  mgr.dispose();
  assert.equal(zones.length, 0);
});

await test('computeEditorLayoutInfo, MarkerTag, and glyphMargin decorations', () => {
  const layout = computeEditorLayoutInfo({
    width: 800,
    height: 500,
    metrics: {
      fontFamily: 'monospace',
      fontSize: 14,
      lineHeight: 20,
      gutterWidth: 74,
      glyphMarginWidth: 20,
      foldGutterWidth: 16,
      gutterNumberPad: 8,
      charWidth: 8,
      paddingLeft: 8,
      paddingTop: 4,
    },
    minimapWidth: 80,
    glyphMargin: true,
    showLineNumbers: true,
  });
  assert.equal(layout.glyphMarginWidth, 20);
  assert.equal(layout.contentLeft, 74);
  assert.equal(layout.contentWidth, 800 - 74 - 80);

  assert.equal(MarkerTag.Unnecessary, 1);
  assert.equal(MarkerTag.Deprecated, 2);
  assert.equal(MouseTargetType.GUTTER_GLYPH_MARGIN, 2);
  assert.equal(ScrollType.Smooth, 0);
  assert.equal(TrackedRangeStickiness.AlwaysGrowsWhenTypingAtEdges, 0);
  assert.equal(EndOfLineSequence.CRLF, 1);

  const decs = new DecorationsCollection();
  decs.deltaDecorations([], [
    {
      range: { startLineNumber: 3, startColumn: 1, endLineNumber: 3, endColumn: 1 },
      options: { isWholeLine: true, glyphMarginClassName: 'breakpoint', glyphMarginColor: '#e51400' },
    },
  ]);
  const rendered = decs.toRenderItems();
  assert.equal(rendered.length, 1);
  assert.equal(rendered[0]!.glyphMarginColor, '#e51400');
});

await test('CodeLensController queries provider, renders strips, and executes commands', async () => {
  const model = new TextModel('export function greet() {}\n', 'typescript');
  const zones: any[] = [];
  const executed: string[] = [];

  const reg = languages.registerCodeLensProvider('typescript', {
    provideCodeLenses: () => ({
      lenses: [
        {
          range: { startLineNumber: 1, startColumn: 1, endLineNumber: 1, endColumn: 1 },
          command: { id: 'demo.runGreet', title: '▶ Run greet' },
        },
      ],
    }),
  });

  const host = {
    root: new StubNode('div'),
    initialOptions: { codeLens: true },
    isPeekEditor: false,
    isDisposed: () => false,
    getModel: () => model,
    getMetrics: () => ({ charWidth: 8 }),
    modelAsFeatureLike: () => ({
      uri: 'inmemory://1',
      getValue: () => model.getValue(),
      getLineCount: () => model.getLineCount(),
      getLineContent: (ln: number) => model.getLineContent(ln),
      getOffsetAt: (p: any) => model.getOffsetAt(p.lineNumber, p.column),
      getPositionAt: (o: number) => model.getPositionAt(o),
      getLanguageId: () => model.getLanguageId(),
    }),
    changeViewZones: (cb: any) => {
      cb({
        addZone: (z: any) => { const id = `z${zones.length + 1}`; zones.push({ id, ...z }); return id; },
        removeZone: (id: string) => { const idx = zones.findIndex((z) => z.id === id); if (idx >= 0) zones.splice(idx, 1); },
        layoutZone: () => {},
      });
    },
    executeCommand: async (id: string) => { executed.push(id); },
  } as any;

  const ctrl = new CodeLensController(host);
  await new Promise((r) => setTimeout(r, 180));
  assert.equal(zones.length, 1);
  assert.equal(zones[0].afterLineNumber, 0);
  const btns = (zones[0].domNode as StubNode).querySelectorAll((n) => n.tagName === 'BUTTON');
  assert.equal(btns.length, 1);
  assert.equal(btns[0]!.textContent, '▶ Run greet');
  // Dragging across a lens strip must not misfire
  btns[0]!.dispatch('pointerdown', { clientX: 10, clientY: 10 });
  btns[0]!.dispatch('pointerup', { clientX: 10, clientY: 34 });
  assert.deepEqual(executed, []);
  // Clean tap invokes the CodeLens command
  btns[0]!.dispatch('pointerdown', { clientX: 10, clientY: 10 });
  btns[0]!.dispatch('pointerup', { clientX: 11, clientY: 11 });
  assert.deepEqual(executed, ['demo.runGreet']);

  ctrl.dispose();
  reg.dispose();
  assert.equal(zones.length, 0);
});

await test('LinkedEditingController auto-renames paired HTML tags', async () => {
  const model = new TextModel('<div class="card">Hello</div>', 'html');
  let pos = { lineNumber: 1, column: 5 };
  const selState = new SelectionState();
  const host = {
    initialOptions: { linkedEditing: true },
    selection: selState,
    view: { paint: () => {} },
    syncTextarea: () => {},
    isDisposed: () => false,
    isReadOnly: () => false,
    getModel: () => model,
    getPosition: () => pos,
    getSelection: () => ({ startLineNumber: pos.lineNumber, startColumn: pos.column, endLineNumber: pos.lineNumber, endColumn: pos.column }),
    getLanguageIdAtPosition: () => 'html',
    modelAsFeatureLike: () => ({
      uri: 'inmemory://html',
      getValue: () => model.getValue(),
      getLineCount: () => model.getLineCount(),
      getLineContent: (ln: number) => model.getLineContent(ln),
      getOffsetAt: (p: any) => model.getOffsetAt(p.lineNumber, p.column),
      getPositionAt: (o: number) => model.getPositionAt(o),
      getLanguageId: () => 'html',
    }),
    executeEdits: (_src: string, edits: any[]) => {
      model.applyEdits(edits);
      return true;
    },
  } as any;

  const ctrl = new LinkedEditingController(host);
  // Simulate user editing `<div` -> `<section`
  model.applyEdits([{ range: { startLineNumber: 1, startColumn: 2, endLineNumber: 1, endColumn: 5 }, text: 'section' }]);
  pos = { lineNumber: 1, column: 9 };
  ctrl.onInputChange({ kind: 'type', text: 'section' });
  await new Promise((r) => setTimeout(r, 10));

  assert.equal(model.getLineContent(1), '<section class="card">Hello</section>');
  ctrl.dispose();
});

await test('QuickNavController: Go to Line (line:col) and Go to Symbol', async () => {
  const model = new TextModel('line1\nconst target = 42;\nline3\n', 'typescript');
  const root = new StubNode('div');
  const kb = new KeybindingService();
  const cmds = new CommandService(kb);
  let lastPos = { lineNumber: 1, column: 1 };
  const announcements: string[] = [];

  const host = {
    root,
    keybindings: kb,
    commands: cmds,
    getModel: () => model,
    getPosition: () => lastPos,
    setPosition: (p: any) => { lastPos = p; },
    revealPositionInCenter: () => {},
    focus: () => {},
    announce: (m: string) => announcements.push(m),
    getDocumentSymbols: async () => [
      {
        name: 'target',
        kind: SymbolKind.Variable,
        range: { startLineNumber: 2, startColumn: 1, endLineNumber: 2, endColumn: 18 },
        selectionRange: { startLineNumber: 2, startColumn: 7, endLineNumber: 2, endColumn: 13 },
      },
    ],
  } as any;

  const ctrl = new QuickNavController(host);
  ctrl.onThemeChange(resolveWidgetTheme(DEFAULT_THEME));
  ctrl.openGoToLine();
  assert.equal(ctrl.isOpen(), true);
  const input = root.querySelectorAll((n) => n.tagName === 'INPUT')[0]!;
  input.value = '3:4';
  input.dispatch('input');
  input.dispatch('keydown', { key: 'Enter' });
  assert.deepEqual(lastPos, { lineNumber: 3, column: 4 });
  assert.equal(ctrl.isOpen(), false);

  await ctrl.openGoToSymbol();
  assert.equal(ctrl.isOpen(), true);
  input.value = 'tar';
  input.dispatch('input');
  input.dispatch('keydown', { key: 'Enter' });
  assert.deepEqual(lastPos, { lineNumber: 2, column: 7 });
  assert.ok(announcements.some((a) => a.includes('target')));
  ctrl.dispose();
});

await test('editor.tokenize, editor.colorize, and editor.colorizeElement', async () => {
  const tokens = editor.tokenize('const x = 42;', 'typescript');
  assert.equal(tokens.length, 1);
  assert.ok(tokens[0]!.some((t) => t.type === 'keyword'));
  assert.ok(tokens[0]!.some((t) => t.type === 'number'));

  const html = await editor.colorize('const x = "<hi>";', 'typescript');
  assert.ok(html.includes('<span'));
  assert.ok(html.includes('&lt;hi&gt;')); // properly escaped

  const pre = new StubNode('pre');
  pre.textContent = 'fn main() { let x = 1; }';
  await editor.colorizeElement(pre as unknown as HTMLElement, { mimeType: 'rust' });
  assert.ok(pre.children.some((c) => c.tagName === 'SPAN'));
});

// ── 4. Phase 8 Languages & ReDoS Grammar Safety Suite ────────────────────────
await test('All 9 new languages registered, configured, and tokenizing accurately', () => {
  const expectedNew: Record<string, string> = {
    rust: 'fn main() { let x: u32 = 42; // comment\nprintln!("hi"); }',
    go: 'package main\nfunc add(a int) int { return a + 1 }',
    kotlin: 'data class User(val name: String = "mono")',
    swift: 'struct Point { let x: Double = 3.14 }',
    php: '<?php function greet($name) { return "hi"; }',
    ruby: 'def hello(name)\n  puts "hi #{name}"\nend',
    xml: '<?xml version="1.0"?><item id="1"><!-- note --></item>',
    toml: '[package]\nname = "mono-editor"\nversion = "1.0.0"',
    dockerfile: 'FROM node:22-alpine\nRUN npm ci\nEXPOSE 3000',
  };

  const registeredIds = new Set(getLanguages().map((l) => l.id));
  for (const [lang, sample] of Object.entries(expectedNew)) {
    assert.ok(registeredIds.has(lang), `Missing language registration: ${lang}`);
    assert.ok(getLanguageConfiguration(lang), `Missing LanguageConfiguration: ${lang}`);
    const tokLines = editor.tokenize(sample, lang);
    const flat = tokLines.flat();
    assert.ok(flat.length >= 2, `Language ${lang} produced too few tokens`);
    assert.ok(
      flat.some((t) => t.type === 'keyword' || t.type === 'tag' || t.type === 'string' || t.type === 'property'),
      `Language ${lang} did not highlight core syntax tokens`,
    );
  }
});

await test('Grammar ReDoS safety: every built-in language finishes pathological inputs in < 50ms', () => {
  const evilInputs = [
    'a'.repeat(5000) + '!',
    '/* ' + 'x'.repeat(5000),
    '"' + '\\a'.repeat(2500),
    '('.repeat(2000) + '1234567890'.repeat(400),
  ];

  const allLangs = getLanguages().map((l) => l.id);
  assert.ok(allLangs.length >= 19, `Expected >= 19 built-in languages, got ${allLangs.length}`);

  for (const lang of allLangs) {
    for (const input of evilInputs) {
      const t0 = performance.now();
      editor.tokenize(input, lang);
      const elapsed = performance.now() - t0;
      assert.ok(
        elapsed < 50,
        `ReDoS / slow tokenization detected in "${lang}": took ${elapsed.toFixed(1)}ms`,
      );
    }
  }
});

// ── 5. Phase 9 Diff Engine & Responsive MonoDiffEditor ───────────────────────
await test('computeLineDiff produces accurate hunks, inline rows, and side-by-side rows', () => {
  const orig = 'line1\nline2\nline3\nline4';
  const mod = 'line1\nline2-edited\nline3\nline3.5\nline4';
  const diff = computeLineDiff(orig, mod);
  assert.equal(diff.hunks.length, 2);
  assert.equal(diff.removedCount, 1);
  assert.equal(diff.addedCount, 2);
  assert.ok(diff.inlineRows.some((r) => r.kind === 'delete' && r.text === 'line2'));
  assert.ok(diff.inlineRows.some((r) => r.kind === 'insert' && r.text === 'line2-edited'));
  assert.ok(diff.sideBySideRows.some((r) => r.kind === 'modify' && r.originalText === 'line2' && r.modifiedText === 'line2-edited'));
});

await test('MonoDiffEditor switches between mobile inline and desktop split views', () => {
  const host = new StubNode('div');
  const diffEd = editor.createDiffEditor(host as unknown as HTMLElement, { inlineBreakpointPx: 720 });
  const m1 = editor.createModel('a\nb\nc', 'plaintext');
  const m2 = editor.createModel('a\nB\nc\nd', 'plaintext');

  let updates = 0;
  diffEd.onDidUpdateDiff(() => { updates++; });
  diffEd.setModel({ original: m1, modified: m2 });
  assert.equal(updates, 1);
  assert.equal(diffEd.getLineChanges().length, 2);

  // Force mobile inline mode
  diffEd.updateOptions({ renderSideBySide: false });
  const modeBtnMobile = host.querySelectorAll((n) => n.tagName === 'BUTTON')[2]!;
  assert.equal(modeBtnMobile.textContent, 'Split'); // button offers switching to Split

  // Force desktop split mode
  diffEd.updateOptions({ renderSideBySide: true });
  assert.equal(modeBtnMobile.textContent, 'Inline'); // button offers switching to Inline

  diffEd.dispose();
  m1.dispose();
  m2.dispose();
});

// ── 6. Phase 10–11 Accessibility, High Contrast & Mobile Controls ────────────
await test('High-Contrast theme (hc-black) is registered and resolves stark contrast', () => {
  assert.ok(BUILTIN_THEME_IDS.includes(HC_BLACK_ID));
  monoThemeService.setTheme(HC_BLACK_ID);
  const partial = monoThemeService.toPartialEditorTheme();
  assert.equal(partial.background, '#000000');
  assert.equal(partial.foreground, '#ffffff');
  monoThemeService.setTheme('mscode-dark');
});

await test('TextAreaBridge sets ARIA textbox attributes and announces politely', async () => {
  const root = new StubNode('div');
  const bridge = new TextAreaBridge(root as unknown as HTMLElement, false, 'TypeScript Editor');

  assert.equal(bridge.textarea.getAttribute('role'), 'textbox');
  assert.equal(bridge.textarea.getAttribute('aria-multiline'), 'true');
  assert.equal(bridge.textarea.getAttribute('aria-label'), 'TypeScript Editor');
  assert.equal(bridge.liveRegion.getAttribute('aria-live'), 'polite');

  bridge.announce('Error on line 4');
  await Promise.resolve();
  assert.equal(bridge.liveRegion.textContent, 'Error on line 4');

  bridge.setAriaLabel('Updated label');
  assert.equal(bridge.textarea.getAttribute('aria-label'), 'Updated label');
  bridge.dispose();
});

await test('MobileController: non-focus-stealing quick keys, visualViewport inset & diagnostic announce', () => {
  const root = new StubNode('div');
  root.rect = { left: 0, top: 0, right: 390, bottom: 700, width: 390, height: 700 };
  const model = new TextModel('const a = 1;\nconst b = 2;', 'typescript');
  let bottomInset = 0;
  let pos = { lineNumber: 1, column: 13 };
  const announcements: string[] = [];
  const ranCmds: string[] = [];

  const host = {
    root,
    isPeekEditor: false,
    initialOptions: {
      mobileQuickKeys: {
        enabled: true,
        keys: [
          { label: '{', insert: '{}' },
          { label: 'GoTo', command: MonoCommands.GoToLine },
        ],
      },
    },
    view: {
      setBottomInset: (px: number) => { bottomInset = px; },
      ensureCaretVisible: () => {},
      paint: () => {},
    },
    isDisposed: () => false,
    isReadOnly: () => false,
    getTabSize: () => 2,
    getModel: () => model,
    getPosition: () => pos,
    getSelection: () => ({
      startLineNumber: pos.lineNumber,
      startColumn: pos.column,
      endLineNumber: pos.lineNumber,
      endColumn: pos.column,
    }),
    setPosition: (ln: number, col: number) => { pos = { lineNumber: ln, column: col }; },
    executeEdits: (_src: string, edits: any[]) => { model.applyEdits(edits); return true; },
    executeCommand: async (id: string) => { ranCmds.push(id); },
    focus: () => {},
    getMarkers: () => [
      {
        owner: 'ts',
        severity: MarkerSeverity.Error,
        message: 'Type mismatch on line 2',
        startLineNumber: 2,
        startColumn: 1,
        endLineNumber: 2,
        endColumn: 6,
      },
    ],
    announce: (msg: string) => announcements.push(msg),
  } as any;

  const ctrl = new MobileController(host);
  assert.equal(bottomInset, 42); // bar height alone when keyboard closed

  // Tap `{` quick key — pointerdown MUST preventDefault() so soft keyboard stays open
  const buttons = root.querySelectorAll((n) => n.tagName === 'BUTTON');
  assert.equal(buttons.length, 2);
  const ev = buttons[0]!.dispatch('pointerdown');
  assert.equal(ev.defaultPrevented, true);
  assert.equal(model.getLineContent(1), 'const a = 1;{}');

  // Tap custom command key
  buttons[1]!.dispatch('pointerdown');
  assert.deepEqual(ranCmds, [MonoCommands.GoToLine]);

  // Simulate Android/iOS soft keyboard shrinking visualViewport to 420px (root bottom = 700 -> overlap 280px)
  visualViewport.height = 420;
  visualViewport.fire('resize');
  assert.equal(bottomInset, 280 + 42);

  // Keyboard closes
  visualViewport.height = 800;
  visualViewport.fire('resize');
  assert.equal(bottomInset, 42);

  // Move cursor to line 2 with error marker -> polite screen reader announcement
  pos = { lineNumber: 2, column: 1 };
  ctrl.onCursorChange('keyboard');
  assert.ok(announcements.some((a) => a.includes('Line 2: Type mismatch on line 2')));

  // Disable bar dynamically -> inset drops to 0
  ctrl.onOptionsChange({ mobileQuickKeys: false });
  assert.equal(bottomInset, 0);

  ctrl.dispose();
});

console.log(`\nALL ${passed} Phase 7–11 Parity & Mobile tests passed!`);
