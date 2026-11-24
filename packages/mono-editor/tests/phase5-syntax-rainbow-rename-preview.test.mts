import assert from 'node:assert/strict';
import { performance } from 'node:perf_hooks';
import {
  BUILTIN_THEME_IDS,
  BracketColorizer,
  DEFAULT_THEME,
  MonoCommands,
  languages,
  monoThemeService,
  registerBuiltinThemes,
  registerDefaultLanguageConfigurations,
  registerDefaultLanguages,
  resolveBracketColorizationOptions,
  getLanguageConfiguration,
  toggleLineComment,
} from '../src/index';
import {
  DEFAULT_MAX_TOKENIZATION_LINE_LENGTH,
  StateInterner,
} from '../src/common/languages/index';
import { SelectionState } from '../src/common/core/SelectionState';
import { TokenizationSupport } from '../src/common/languages/tokenization/TokenizationSupport';
import { createRegexTokensProvider } from '../src/common/languages/tokenization/createRegexTokensProvider';
import { TextModel } from '../src/common/model/TextModel';
import { registerCoreKeybindingsAndActions } from '../src/browser/editor/defaultKeybindings';
import { RenameController } from '../src/contrib/rename/RenameController';
import { SuggestController } from '../src/contrib/suggest/SuggestController';
import { CommandService } from '../src/platform/commands/CommandService';
import { KeybindingService } from '../src/platform/keybindings/KeybindingService';
import {
  MERMAID_STRICT_CONFIG,
  MarkdownPreview,
  getPreviewLoaderStats,
  parseMarkdownBlocks,
  resetPreviewLoaderState,
  sanitizePreviewUrl,
  scanMarkdownFeatures,
} from '../src/preview/index';

let passed = 0;
function test(name: string, fn: () => void | Promise<void>) {
  return Promise.resolve()
    .then(fn)
    .then(() => {
      passed++;
      console.log(`  ok  ${name}`);
    });
}

// ── Minimal DOM Stub for Widget / Preview Tests ──────────────────────────────
type Listener = (ev: any) => void;
class StubNode {
  tagName: string;
  style: Record<string, string> = {};
  attrs = new Map<string, string>();
  children: StubNode[] = [];
  parentNode: StubNode | null = null;
  listeners = new Map<string, Listener[]>();
  private _text = '';
  className = '';
  value = '';
  type = '';
  checked = false;
  disabled = false;
  href = '';
  src = '';
  alt = '';
  target = '';
  rel = '';
  clientWidth = 600;
  clientHeight = 400;
  offsetWidth = 220;
  offsetHeight = 56;
  focused = false;
  selected = false;

  constructor(tag: string) {
    this.tagName = tag.toUpperCase();
  }
  get textContent(): string {
    if (this.children.length === 0) return this._text;
    return this.children.map((c) => c.textContent).join('');
  }
  set textContent(v: string) {
    this._text = String(v ?? '');
    for (const c of this.children) c.parentNode = null;
    this.children = [];
  }
  setAttribute(k: string, v: string) { this.attrs.set(k, v); }
  getAttribute(k: string) { return this.attrs.get(k) ?? null; }
  appendChild(child: any) {
    if (!child) return child;
    if (child.tagName === '#FRAGMENT') {
      for (const c of [...child.children]) this.appendChild(c);
      child.children = [];
      return child;
    }
    child.parentNode = this;
    this.children.push(child);
    return child;
  }
  replaceChildren(...nodes: any[]) {
    for (const c of this.children) c.parentNode = null;
    this.children = [];
    for (const n of nodes) this.appendChild(n);
  }
  remove() {
    if (!this.parentNode) return;
    const i = this.parentNode.children.indexOf(this);
    if (i >= 0) this.parentNode.children.splice(i, 1);
    this.parentNode = null;
  }
  contains(node: any): boolean {
    if (node === this) return true;
    return this.children.some((c) => c.contains(node));
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
      preventDefault() { this.defaultPrevented = true; },
      stopPropagation() { this.stopped = true; },
      ...ev,
    };
    let cur: StubNode | null = this;
    while (cur && !event.stopped) {
      for (const fn of cur.listeners.get(type) ?? []) fn(event);
      cur = cur.parentNode;
    }
    return event;
  }
  focus() { this.focused = true; (globalThis as any).document.activeElement = this; }
  blur() { this.focused = false; }
  select() { this.selected = true; }
  querySelectorAll(sel: string): StubNode[] {
    const out: StubNode[] = [];
    const visit = (el: StubNode) => {
      for (const c of el.children) {
        const match =
          (sel.startsWith('.') && c.className.split(/\s+/).includes(sel.slice(1))) ||
          c.tagName.toLowerCase() === sel.toLowerCase();
        if (match) out.push(c);
        visit(c);
      }
    };
    visit(this);
    return out;
  }
}

function installDomStub() {
  const head = new StubNode('head');
  const body = new StubNode('body');
  const doc = {
    head,
    body,
    activeElement: null as any,
    getElementById: () => null,
    querySelector: () => null,
    createElement: (tag: string) => new StubNode(tag),
    createDocumentFragment: () => new StubNode('#FRAGMENT'),
    createTextNode: (t: string) => {
      const n = new StubNode('#TEXT');
      n.textContent = t;
      return n;
    },
    addEventListener() {},
    removeEventListener() {},
  };
  (globalThis as any).document = doc;
  (globalThis as any).Node = StubNode;
  (globalThis as any).HTMLElement = StubNode;
  (globalThis as any).KeyboardEvent = class KeyboardEvent {
    type: string;
    constructor(type: string) { this.type = type; }
  };
  (globalThis as any).window = {
    setTimeout,
    clearTimeout,
    addEventListener() {},
    removeEventListener() {},
    dispatchEvent() {},
    devicePixelRatio: 1,
  };
  return doc;
}

// Seeded PRNG (mulberry32) for deterministic fuzzing
function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function tokenSlice(line: string, tok: { startColumn: number; endColumn: number; type: string }) {
  return { text: line.slice(tok.startColumn - 1, tok.endColumn - 1), type: tok.type };
}

async function run() {
  console.log('Phase 5 — Monarch Syntax, Embedded HTML/MD, Rainbow Brackets, Rename Popup & Lazy Preview:');
  registerDefaultLanguages();
  registerDefaultLanguageConfigurations();
  registerBuiltinThemes();

  // ── 1. Multiline Template Literals, Nested ${expr}, Escapes & Semantic Roles ──
  await test('JS/TS: multiline template literals, nested ${var}/${`...`}, escapes, regex, decorators & O(1) interned states', () => {
    const code = [
      '@sealed',
      'export async function greet(user: User) {',
      '  const msg = `Hello ${user.name ?? `guest-${1 + 2}`}',
      '    line 2 \\n with ${{ key: [1, 2] }.key[0]}',
      '    end`;',
      '  const re = /foo\\d+/gi;',
      '  return true ? msg : null;',
      '}',
    ].join('\n');

    const model = new TextModel(code, 'typescript');
    const tok = new TokenizationSupport();

    // Line 1: @sealed decorator
    const l1 = tok.getLineTokens(model, 1).map((t) => tokenSlice(model.getLineContent(1), t));
    assert.ok(l1.some((t) => t.text === '@sealed' && t.type === 'decorator'), `got ${JSON.stringify(l1)}`);

    // Line 3: template literal + `${` delimiter + nested expression + nested backtick!
    const l3 = tok.getLineTokens(model, 3).map((t) => tokenSlice(model.getLineContent(3), t));
    assert.ok(l3.some((t) => t.type === 'templateDelimiter' && t.text === '${'), `expected \${ delimiter in ${JSON.stringify(l3)}`);
    assert.ok(l3.some((t) => t.type === 'string' && t.text.includes('Hello ')), `expected string part in ${JSON.stringify(l3)}`);
    assert.ok(l3.some((t) => t.type === 'number' && t.text === '1'), `expected number inside nested template in ${JSON.stringify(l3)}`);

    // Line 4: continues inside multiline template string, highlights \n escape and nested `{ key: [1, 2] }` inside `${...}`
    const l4 = tok.getLineTokens(model, 4).map((t) => tokenSlice(model.getLineContent(4), t));
    assert.ok(l4.some((t) => t.type === 'stringEscape' && t.text === '\\n'), `expected \\n escape in ${JSON.stringify(l4)}`);
    assert.ok(l4.some((t) => t.type === 'templateDelimiter' && t.text === '${'), `expected \${ on line 4 in ${JSON.stringify(l4)}`);
    assert.ok(l4.some((t) => t.type === 'number' && t.text === '2'), `expected number inside nested object expr in ${JSON.stringify(l4)}`);

    // Line 5: closes multiline template cleanly
    const l5 = tok.getLineTokens(model, 5).map((t) => tokenSlice(model.getLineContent(5), t));
    assert.ok(l5.some((t) => t.type === 'string' && t.text.includes('end')));

    // Line 6: regex literal
    const l6 = tok.getLineTokens(model, 6).map((t) => tokenSlice(model.getLineContent(6), t));
    assert.ok(l6.some((t) => t.type === 'regexp' && t.text === '/foo\\d+/gi'), `expected regexp in ${JSON.stringify(l6)}`);

    // Line 7: keywordControl (`return`), boolean (`true`), constant/boolean (`null`)
    const l7 = tok.getLineTokens(model, 7).map((t) => tokenSlice(model.getLineContent(7), t));
    assert.ok(l7.some((t) => t.text === 'return' && t.type === 'keywordControl'), `expected keywordControl in ${JSON.stringify(l7)}`);
    assert.ok(l7.some((t) => t.text === 'true' && t.type === 'boolean'), `expected boolean in ${JSON.stringify(l7)}`);

    // O(1) interned integer end states (no deep object equality needed)
    for (let ln = 1; ln <= model.getLineCount(); ln++) {
      const endState = tok.getLineEndState(model, ln);
      assert.equal(typeof endState, 'number', `line ${ln} endState should be interned integer ID, got ${typeof endState}`);
    }
  });

  // ── 2. HTML Embedded Languages (<style>, <script> variants, HTML5 raw-text </script> in string) ──
  await test('HTML: embedded <style>/CSS, <script> module/ts/json/unknown, HTML5 </script>-in-string & compact languageSegments', () => {
    const html = [
      '<!DOCTYPE html>',
      '<style>',
      '  .card { color: #38bdf8; padding: 12px; }',
      '</style>',
      '<script type="module">',
      '  import { ok } from "./mod.js";',
      '  const msg = `hi ${ok}`;',
      '</script>',
      '<script lang="ts">',
      '  interface Item { id: number; }',
      '  const trap = "</script>";',
      '</script>',
      '<script type="application/ld+json">',
      '  { "name": "Mono", "version": 5 }',
      '</script>',
      '<script type="text/x-template">',
      '  {{ raw template }}',
      '</script>',
      '<div style="display: flex; gap: 8px;">OK</div>',
    ].join('\n');

    const model = new TextModel(html, 'html');
    const tok = new TokenizationSupport();

    // Verify zero per-token `languageId` bloat — language lives in per-line segments!
    const styleTokens = tok.getLineTokens(model, 3);
    assert.ok(styleTokens.length > 0);
    assert.equal('languageId' in (styleTokens[0] as any), false, 'MonoToken must stay lean without per-token languageId');

    // Line 3: inside <style> -> CSS language segment + CSS selector/property/unit tokens
    assert.equal(tok.getLanguageIdAtPosition(model, 3, 5), 'css');
    const l3 = styleTokens.map((t) => tokenSlice(model.getLineContent(3), t));
    assert.ok(l3.some((t) => t.type === 'selector' && t.text === '.card'), `got ${JSON.stringify(l3)}`);
    assert.ok(l3.some((t) => t.type === 'property' && t.text === 'color'), `got ${JSON.stringify(l3)}`);

    // Line 6-7: inside <script type="module"> -> javascript + template interpolation
    assert.equal(tok.getLanguageIdAtPosition(model, 6, 5), 'javascript');
    const l7 = tok.getLineTokens(model, 7).map((t) => tokenSlice(model.getLineContent(7), t));
    assert.ok(l7.some((t) => t.type === 'templateDelimiter' && t.text === '${'), `got ${JSON.stringify(l7)}`);

    // Line 10: inside <script lang="ts"> -> typescript
    assert.equal(tok.getLanguageIdAtPosition(model, 10, 5), 'typescript');

    // Line 11: HTML5 raw-text rule — `</script>` inside JS string STILL closes `<script>`!
    const l11 = model.getLineContent(11);
    const closeIdx = l11.indexOf('</script>');
    assert.equal(tok.getLanguageIdAtPosition(model, 11, 5), 'typescript', 'before </script> is still typescript');
    assert.equal(tok.getLanguageIdAtPosition(model, 11, closeIdx + 2), 'html', '</script> closes raw-text script element per HTML5 spec');
    const l11Tokens = tok.getLineTokens(model, 11).map((t) => tokenSlice(l11, t));
    assert.ok(l11Tokens.some((t) => t.type === 'tag' && t.text.includes('script')), `expected closing </script> tag token in ${JSON.stringify(l11Tokens)}`);

    // Line 14: <script type="application/ld+json"> -> json
    assert.equal(tok.getLanguageIdAtPosition(model, 14, 6), 'json');

    // Line 17: unknown MIME <script type="text/x-template"> -> plaintext
    assert.equal(tok.getLanguageIdAtPosition(model, 17, 6), 'plaintext');

    // Line 19: HTML root + inline style="..."
    assert.equal(tok.getLanguageIdAtPosition(model, 19, 2), 'html');
    const styleValCol = model.getLineContent(19).indexOf('display') + 1;
    assert.equal(tok.getLanguageIdAtPosition(model, 19, styleValCol), 'css');
  });

  // ── 3. Markdown Highlighting & Fenced Code Delegation ────────────────────────
  await test('Markdown: headings, inline formatting, math, and fenced code languageSegments', () => {
    const md = [
      '# Architecture Overview',
      'Run `npm test` for **fast** *checks* and $E = mc^2$ with [docs](https://mono.dev).',
      '```ts',
      'const score: number = 100;',
      '```',
      '```css',
      '.panel { display: grid; }',
      '```',
    ].join('\n');

    const model = new TextModel(md, 'markdown');
    const tok = new TokenizationSupport();

    assert.equal(tok.getLineTokens(model, 1)[0]!.type, 'heading');
    const l2 = tok.getLineTokens(model, 2).map((t) => tokenSlice(model.getLineContent(2), t));
    assert.ok(l2.some((t) => t.type === 'codeInline'));
    assert.ok(l2.some((t) => t.type === 'strong'));
    assert.ok(l2.some((t) => t.type === 'emphasis'));
    assert.ok(l2.some((t) => t.type === 'math'));
    assert.ok(l2.some((t) => t.type === 'link'));

    // Fenced code blocks delegate to TypeScript and CSS
    assert.equal(tok.getLanguageIdAtPosition(model, 4, 3), 'typescript');
    assert.ok(tok.getLineTokens(model, 4).some((t) => t.type === 'keyword'));
    assert.equal(tok.getLanguageIdAtPosition(model, 7, 3), 'css');
    assert.ok(tok.getLineTokens(model, 7).some((t) => t.type === 'selector'));
  });

  // ── 4. Multi-line Comment Toggle Uses Selection START Embedded Language ──────
  await test('Embedded Comment Toggle: multi-line selection uses language at selection START position', async () => {
    installDomStub();
    const html = [
      '<style>',
      '  .btn { color: red; }',
      '  .box { margin: 0; }',
      '</style>',
      '<script>',
      '  const x = 1;',
      '</script>',
    ].join('\n');

    const model = new TextModel(html, 'html');
    const tok = new TokenizationSupport();
    const selection = new SelectionState();
    const commands = new CommandService();
    const keybindings = new KeybindingService();

    registerCoreKeybindingsAndActions({
      getModel: () => model,
      selection,
      view: { ensureCaretVisible() {}, paint() {} } as any,
      keybindings,
      commands,
      isReadOnly: () => false,
      getTabSize: () => 2,
      getLanguageIdAtPosition: (ln, col) => tok.getLanguageIdAtPosition(model, ln, col),
      syncTextarea() {},
      emitContent() {},
      emitCursorEvents() {},
      applyStackSelection() {},
    });

    // Multi-line selection starting inside <style> (line 2) and ending inside <script> (line 6)
    // Reverse selection (anchor on line 6, active on line 2) MUST still pick START = line 2 ('css')!
    selection.anchor = { lineNumber: 6, column: 8 };
    selection.active = { lineNumber: 2, column: 4 };
    await commands.executeCommand(MonoCommands.CommentLine);
    assert.ok(
      model.getLineContent(2).includes('/*') && model.getLineContent(6).includes('*/'),
      `expected CSS /* ... */ comment from start position, got:\n${model.getValue()}`,
    );

    // Undo and test inside <script> (line 6) -> JS `//` comment
    model.undo();
    selection.setCaret(6, 5);
    await commands.executeCommand(MonoCommands.CommentLine);
    assert.ok(
      model.getLineContent(6).trim().startsWith('//'),
      `expected JS // comment inside <script>, got: ${model.getLineContent(6)}`,
    );

    // Verify pure toggleLineComment helper still works directly with HTML config
    model.undo();
    toggleLineComment(model, selection, getLanguageConfiguration('html'));
    assert.ok(model.getLineContent(6).includes('<!--'));
  });

  // ── 5. Embedded CSS & JS Completions inside HTML ─────────────────────────────
  await test('Embedded Completions: HTML <style> resolves CSS suggestions and <script> resolves JS suggestions', async () => {
    installDomStub();
    const host = document.createElement('div') as unknown as HTMLElement;
    const html = [
      '<style>',
      '  .card { disp }',
      '</style>',
      '<script>',
      '  cons',
      '</script>',
    ].join('\n');

    const model = new TextModel(html, 'html');
    const tok = new TokenizationSupport();
    const selection = new SelectionState();
    const viewStub = {
      screenPosOf: () => ({ x: 40, y: 40, h: 20 }),
      caretScreenPos: () => ({ x: 40, y: 40, h: 20 }),
      isLineInView: () => true,
      getTopInset: () => 0,
      cssWidth: 600,
      cssHeight: 400,
    } as any;

    const suggest = new SuggestController(
      host,
      model,
      selection,
      viewStub,
      () => {},
      undefined,
      {
        getLanguageIdAtPosition: (ln, col) => tok.getLanguageIdAtPosition(model, ln, col),
      },
    );

    // Cursor right after `disp` on line 2 inside <style>
    selection.setCaret(2, 15);
    await suggest.trigger();
    assert.equal(suggest.isOpen(), true, 'CSS suggest opens inside HTML <style>');
    const cssLabels = (host as any)
      .querySelectorAll('span')
      .map((s: StubNode) => s.textContent);
    assert.ok(cssLabels.includes('display'), `expected CSS 'display' completion, got ${cssLabels.slice(0, 10)}`);
    suggest.cancel();

    // Cursor right after `cons` on line 5 inside <script>
    selection.setCaret(5, 7);
    await suggest.trigger();
    assert.equal(suggest.isOpen(), true, 'JS suggest opens inside HTML <script>');
    const jsLabels = (host as any)
      .querySelectorAll('span')
      .map((s: StubNode) => s.textContent);
    assert.ok(
      jsLabels.includes('const') || jsLabels.includes('console'),
      `expected JS 'const'/'console' completion, got ${jsLabels.slice(0, 10)}`,
    );
    suggest.dispose();
  });

  // ── 6. Safety Limits: maxTokenizationLineLength & Time-Budget Backtracking Guard ──
  await test('Safety Limits: maxTokenizationLineLength fallback & regex time-budget guard prevent freezes', () => {
    const tok = new TokenizationSupport();
    assert.equal(tok.getLimits().maxTokenizationLineLength, DEFAULT_MAX_TOKENIZATION_LINE_LENGTH);
    tok.setLimits({ maxTokenizationLineLength: 512, maxTokenizationLineTimeMs: 4 });

    const hugeLine = 'const x = ' + '"a" + '.repeat(200) + '1;';
    assert.ok(hugeLine.length > 512);
    const m = new TextModel(`${hugeLine}\nconst after = 42;`, 'javascript');

    const t0 = performance.now();
    const l1 = tok.getLineTokens(m, 1);
    const dt = performance.now() - t0;
    assert.equal(l1.length, 1);
    assert.equal(l1[0]!.type, 'plain', 'line exceeding maxTokenizationLineLength falls back cleanly to plain');
    assert.ok(dt < 25, `oversized line fallback should be instant, took ${dt.toFixed(2)}ms`);

    // Next normal line still tokenizes properly
    const l2 = tok.getLineTokens(m, 2);
    assert.ok(l2.some((t) => t.type === 'keyword'));

    // Custom regex provider with tiny budget still terminates cleanly
    const custom = createRegexTokensProvider({
      languageId: 'stress-lang',
      rules: [],
      keywords: ['foo', 'bar'],
    });
    const res = custom.tokenizeLine('foo bar '.repeat(500), custom.getInitialState(), {
      maxLineLength: 100_000,
      timeBudgetMs: 0.0001,
    });
    assert.ok(res.tokens.length >= 1, 'time-budget guard yields remaining slice cleanly without throwing');
  });

  // ── 7. Incremental == Full Tokenize Fuzz Test (Template Literal & <script>/<style> Boundaries) ──
  await test('Fuzz Test: incremental tokenize == full tokenize across 160 random edits on JS templates, HTML <script>/<style> & Markdown fences', () => {
    const rng = mulberry32(0x5eed2026);
    const scenarios: Array<{ lang: string; seed: string; snippets: string[] }> = [
      {
        lang: 'javascript',
        seed: [
          'const a = `hello ${',
          '  obj.fn(`nested ${1 + 2}`)',
          '} world`;',
          '/* block',
          'comment */',
          'function done(x) { return `${x}\\n`; }',
        ].join('\n'),
        snippets: ['`', '${', '}', '\\`', '/*', '*/', '\n', 'const z = `', '`;\n', '{ a: 1 }', '// note\n', '"hi"'],
      },
      {
        lang: 'html',
        seed: [
          '<style>',
          '  .box { color: #0ea5e9; }',
          '</style>',
          '<script type="module">',
          '  const s = `hi ${name}`;',
          '  const trap = "</script>";',
          '</script>',
          '<script lang="ts">',
          '  const n: number = 1;',
          '</script>',
          '<div style="color: red;">ok</div>',
        ].join('\n'),
        snippets: [
          '<style>', '</style>', '<script>', '<script type="module">', '<script lang="ts">',
          '<script type="application/json">', '</script>', '</SCRIPT >', '`', '${', '}', '/*', '*/',
          '<!--', '-->', '\n', '"</script>"', ' style="margin: 0;"',
        ],
      },
      {
        lang: 'markdown',
        seed: [
          '# Title',
          'Inline `$not_math$` and $a+b$',
          '```js',
          'const t = `a ${b}`;',
          '```',
          '```css',
          '.a { color: red; }',
          '```',
        ].join('\n'),
        snippets: ['```js\n', '```css\n', '```\n', '~~~\n', '`', '${', '}', '\n', '# H\n', '**b**', '<!-- ', ' -->'],
      },
    ];

    for (const sc of scenarios) {
      const model = new TextModel(sc.seed, sc.lang);
      const inc = new TokenizationSupport();
      model.onDidChange((ver, change) => inc.applyChange(change, ver));

      // Prime cache
      for (let ln = 1; ln <= model.getLineCount(); ln++) inc.getLineTokens(model, ln);

      for (let step = 0; step < 55; step++) {
        const totalLen = model.getValue().length;
        const op = rng();
        if (op < 0.45 || totalLen === 0) {
          const pos = Math.floor(rng() * (totalLen + 1));
          const snip = sc.snippets[Math.floor(rng() * sc.snippets.length)]!;
          model.insert(pos, snip);
        } else if (op < 0.8) {
          const a = Math.floor(rng() * totalLen);
          const delLen = Math.min(totalLen - a, 1 + Math.floor(rng() * 18));
          model.delete(a, a + delLen);
        } else {
          const a = Math.floor(rng() * totalLen);
          const b = Math.min(totalLen, a + Math.floor(rng() * 14));
          const snip = sc.snippets[Math.floor(rng() * sc.snippets.length)]!;
          model.applyEdit({ startOffset: a, endOffset: b, text: snip });
        }

        // Compare incremental against a completely fresh full-document tokenizer on EVERY line!
        const fresh = new TokenizationSupport();
        const lineCount = model.getLineCount();
        for (let ln = 1; ln <= lineCount; ln++) {
          const incToks = inc.getLineTokens(model, ln);
          const freshToks = fresh.getLineTokens(model, ln);
          assert.deepEqual(
            incToks,
            freshToks,
            `[${sc.lang} step ${step} line ${ln}] incremental tokens diverged from full tokenize\nDOC:\n${model.getValue()}`,
          );

          const incSegs = inc.getLineLanguageSegments(model, ln);
          const freshSegs = fresh.getLineLanguageSegments(model, ln);
          assert.deepEqual(
            incSegs,
            freshSegs,
            `[${sc.lang} step ${step} line ${ln}] incremental languageSegments diverged from full tokenize`,
          );
        }
      }
    }
  });

  // ── 8. Rainbow Bracket Colorization (5 Levels, Theme Harmonics, Rules, Token-Aware & 50k Cutoff) ──
  await test('Rainbow Brackets: 5 theme-aware levels, custom rules, independent pools, token-aware skip, ${expr} support & 50k cutoff', () => {
    // All 5 built-in themes provide 5 distinct rainbow bracket colors + unexpectedBracketColor
    for (const id of BUILTIN_THEME_IDS) {
      monoThemeService.setTheme(id);
      const t = monoThemeService.toPartialEditorTheme(id);
      assert.equal(t.rainbowBrackets?.length, 5, `theme ${id} must define 5 rainbow bracket levels`);
      assert.equal(new Set(t.rainbowBrackets).size, 5, `theme ${id} rainbow colors must be distinct`);
      assert.ok(t.unexpectedBracketColor, `theme ${id} must define unexpectedBracketColor`);
    }

    // 5-level depth cycling & unexpected closing bracket
    const bc = new BracketColorizer({ enabled: true, maxLevels: 5 }, 'javascript');
    const tok = new TokenizationSupport();
    const m1 = new TextModel('(((((x))))) )', 'javascript');
    const b1 = bc.getLineBrackets(m1, 1, (ln) => tok.getLineTokens(m1, ln));
    // Openers at cols 0..4 -> levels 0,1,2,3,4; closers at cols 6..10 -> 4,3,2,1,0; stray ')' at col 12 -> unexpected
    assert.deepEqual(
      b1.map((e) => ({ c: e.column, l: e.level, u: e.unexpected })),
      [
        { c: 0, l: 0, u: false },
        { c: 1, l: 1, u: false },
        { c: 2, l: 2, u: false },
        { c: 3, l: 3, u: false },
        { c: 4, l: 4, u: false },
        { c: 6, l: 4, u: false },
        { c: 7, l: 3, u: false },
        { c: 8, l: 2, u: false },
        { c: 9, l: 1, u: false },
        { c: 10, l: 0, u: false },
        { c: 12, l: -1, u: true },
      ],
    );

    // Token-aware: skips brackets inside strings, comments, regexes — STILL colors inside `${...}`!
    const m2 = new TextModel('const s = "([{" + `v ${fn([1])}`; // (((', 'javascript');
    const b2 = bc.getLineBrackets(m2, 1, (ln) => tok.getLineTokens(m2, ln));
    const line2 = m2.getLineContent(1);
    const coloredChars = b2.map((e) => line2[e.column]).join('');
    assert.equal(coloredChars, '{([])}', `expected only {([])} from \${fn([1])} to be colored, got "${coloredChars}"`);

    // Independent color pool per bracket type: '(' and '[' both start at level 0
    const bcInd = new BracketColorizer({ enabled: true, independentColorPoolPerBracketType: true }, 'javascript');
    const m3 = new TextModel('([{}])', 'javascript');
    const b3 = bcInd.getLineBrackets(m3, 1);
    assert.deepEqual(
      b3.slice(0, 3).map((e) => e.level),
      [0, 0, 0],
      'independent pools start each bracket type at level 0',
    );

    // Custom pairs & per-language rule override & clamping maxLevels
    const resolved = resolveBracketColorizationOptions(
      {
        enabled: true,
        maxLevels: 99,
        pairs: [['<', '>']],
        languages: { plaintext: { enabled: false } },
      },
      'plaintext',
    );
    assert.equal(resolved.enabled, false, 'per-language override disables rainbow brackets for plaintext');
    assert.equal(resolved.maxLevels, 5, 'maxLevels clamps safely to 1..5');

    // Large-file cutoff: 50,001 lines returns empty brackets instantaneously (no lag)
    const bigLines = new Array(50_001).fill('function f() { return [1]; }').join('\n');
    const bigModel = new TextModel(bigLines, 'javascript');
    const t0 = performance.now();
    const bigBrackets = bc.getLineBrackets(bigModel, 25_000);
    const dt = performance.now() - t0;
    assert.equal(bigBrackets.length, 0, '50k+ line file hits large-file rainbow cutoff');
    assert.ok(dt < 10, `50k+ line cutoff should be O(1), took ${dt.toFixed(2)}ms`);
  });

  // ── 9. Rename Symbol Popup: Scroll Move, Out-of-View State Preservation, Self-Tap & Soft Keyboard ──
  await test('Rename Popup: moves on scroll, hides visually out of view preserving draft, immune to self-tap & soft-keyboard scroll, dismisses on canvas tap/cursor change', async () => {
    installDomStub();
    const root = document.createElement('div') as unknown as StubNode;
    const model = new TextModel('const alpha = 1;\nconsole.log(alpha);', 'javascript');
    const commands = new CommandService();
    const keybindings = new KeybindingService();
    let scrollY = 0;
    let viewportH = 400;
    let focusCalls = 0;
    const appliedEdits: any[] = [];

    const renameReg = languages.registerRenameProvider('javascript', {
      resolveRenameLocation: () => ({
        range: { startLineNumber: 1, startColumn: 7, endLineNumber: 1, endColumn: 12 },
        text: 'alpha',
      }),
      provideRenameEdits: (_m, _p, newName) => ({
        edits: [
          {
            resource: model.uri,
            edit: { range: { startLineNumber: 1, startColumn: 7, endLineNumber: 1, endColumn: 12 }, text: newName },
          },
        ],
      }),
    });

    const host: any = {
      root,
      commands,
      keybindings,
      isReadOnly: () => false,
      getPosition: () => ({ lineNumber: 1, column: 8 }),
      getLanguageIdAtPosition: () => 'javascript',
      modelAsFeatureLike: () => ({
        uri: model.uri,
        getValue: () => model.getValue(),
        getLineContent: (ln: number) => model.getLineContent(ln),
        getLineCount: () => model.getLineCount(),
        getLanguageId: () => model.getLanguageId(),
      }),
      wordAtPosition: () => ({ word: 'alpha', startColumn: 7, endColumn: 12 }),
      view: {
        cssWidth: 600,
        get cssHeight() { return viewportH; },
        getTopInset: () => 0,
        screenPosOf: () => ({ x: 80, y: 120 - scrollY, h: 20 }),
      },
      applyWorkspaceEdit: (e: any) => appliedEdits.push(e),
      focus: () => { focusCalls++; },
    };

    const ctrl = new RenameController(host);
    const opened = await ctrl.runRenameSymbol();
    assert.equal(opened, true);
    assert.equal(ctrl.isOpen(), true);

    const widget = ctrl.getWidget();
    const popupEl = widget.getElement() as unknown as StubNode;
    const inputEl = widget.getInputElement() as unknown as StubNode;
    assert.equal(popupEl.style.top, '144px'); // 120 + 20 + 4

    // User edits draft text inside rename input
    inputEl.value = 'betaSymbol';

    // 1) Self-tap on popup or input stops propagation and NEVER dismisses
    let rootSawPointerDown = false;
    root.addEventListener('pointerdown', () => { rootSawPointerDown = true; });
    const tapEv = inputEl.dispatch('pointerdown');
    assert.equal(tapEv.stopped, true, 'tapping rename input stops event propagation');
    assert.equal(rootSawPointerDown, false, 'editor root does not see pointerdown from rename input');
    assert.equal(ctrl.isOpen(), true, 'self-tap never dismisses rename popup');

    // 2) Smooth vertical scroll moves popup without dismissing
    scrollY = 40;
    ctrl.onScroll();
    assert.equal(ctrl.isOpen(), true);
    assert.equal(popupEl.style.top, '104px', 'popup moves smoothly with scroll');

    // 3) Mobile soft-keyboard resize + scroll event NEVER dismisses popup
    viewportH = 220;
    ctrl.onLayout();
    ctrl.onPointerInteract('scroll');
    ctrl.onPointerInteract('scrollEnd');
    assert.equal(ctrl.isOpen(), true, 'soft keyboard resize & scroll events never dismiss rename popup');

    // 4) Scrolling anchor out of viewport hides popup visually while preserving state & draft input!
    scrollY = 400; // anchor.y = -280 (out of view)
    ctrl.onScroll();
    assert.equal(ctrl.isOpen(), true, 'out-of-view scroll keeps rename session open');
    assert.equal(widget.isHiddenOutOfView(), true);
    assert.equal(popupEl.style.visibility, 'hidden');
    assert.equal(popupEl.style.pointerEvents, 'none');
    assert.equal(widget.getInputValue(), 'betaSymbol', 'draft text preserved while scrolled out of view');

    // 5) Scrolling back into view restores visibility & draft text
    scrollY = 20;
    ctrl.onScroll();
    assert.equal(widget.isHiddenOutOfView(), false);
    assert.equal(popupEl.style.visibility, 'visible');
    assert.equal(popupEl.style.pointerEvents, 'auto');
    assert.equal(popupEl.style.top, '124px');
    assert.equal(widget.getInputValue(), 'betaSymbol');

    // 6) Tapping editor canvas dismisses rename popup
    ctrl.onPointerInteract('tap');
    assert.equal(ctrl.isOpen(), false, 'tapping editor canvas dismisses rename popup');

    // 7) Re-open and verify cursor movement dismisses rename popup
    await ctrl.runRenameSymbol();
    assert.equal(ctrl.isOpen(), true);
    ctrl.onCursorChange('keyboard');
    assert.equal(ctrl.isOpen(), false, 'cursor change dismisses rename popup');

    // 8) Re-open and verify Enter submits rename edits cleanly
    await ctrl.runRenameSymbol();
    const inp2 = widget.getInputElement() as unknown as StubNode;
    inp2.value = 'gammaName';
    inp2.dispatch('keydown', { key: 'Enter' });
    await new Promise((r) => setTimeout(r, 10));
    assert.equal(ctrl.isOpen(), false);
    assert.equal(appliedEdits.length, 1);
    assert.equal(appliedEdits[0].edits[0].edit.text, 'gammaName');
    assert.ok(focusCalls >= 1);

    ctrl.dispose();
    renameReg.dispose();
  });

  // ── 10. Optional @mono/editor/preview: Lazy KaTeX/Mermaid, Strict Security & Sanitization ──
  await test('@mono/editor/preview: zero eager KaTeX/Mermaid load, strict Mermaid security, safe URLs & code highlighting', async () => {
    installDomStub();
    resetPreviewLoaderState();

    // Security invariants
    assert.equal(MERMAID_STRICT_CONFIG.securityLevel, 'strict', 'Mermaid must enforce securityLevel: strict');
    assert.equal(sanitizePreviewUrl('javascript:alert(1)'), null);
    assert.equal(sanitizePreviewUrl('vbscript:msgbox(1)'), null);
    assert.equal(sanitizePreviewUrl('data:text/html,<script>alert(1)</script>'), null);
    assert.equal(sanitizePreviewUrl('https://example.com/docs'), 'https://example.com/docs');
    assert.equal(sanitizePreviewUrl('#section-1'), '#section-1');

    // Feature scanner ignores $ and mermaid mentions inside code blocks
    const plainMd = [
      '# Plain Doc',
      'Price is `$100` and code:',
      '```bash',
      'echo "$HOME" # not math',
      '```',
      '| A | B |',
      '| - | -: |',
      '| 1 | 2 |',
      '- [x] done',
    ].join('\n');
    assert.deepEqual(scanMarkdownFeatures(plainMd), { hasMath: false, hasMermaid: false });
    const parsedBlocks = parseMarkdownBlocks(plainMd);
    assert.ok(parsedBlocks.some((b) => b.type === 'table'));
    assert.ok(parsedBlocks.some((b) => b.type === 'list'));

    // Render plain Markdown -> ZERO KaTeX or Mermaid dynamic imports triggered!
    const host = document.createElement('div') as unknown as HTMLElement;
    const preview = new MarkdownPreview(host, { debounceMs: 0, theme: DEFAULT_THEME });
    await preview.renderNow(plainMd);
    assert.deepEqual(getPreviewLoaderStats(), { katexLoads: 0, mermaidLoads: 0 });

    // Feature scanner detects math and mermaid accurately
    assert.deepEqual(scanMarkdownFeatures('Formula $x^2 + y^2 = r^2$'), { hasMath: true, hasMermaid: false });
    assert.deepEqual(scanMarkdownFeatures('$$\n\\int_0^1 x dx\n$$'), { hasMath: true, hasMermaid: false });
    assert.deepEqual(scanMarkdownFeatures('```mermaid\ngraph TD\n  A --> B\n```'), { hasMath: false, hasMermaid: true });

    // Render math-only Markdown -> dynamically loads KaTeX ONLY (mermaidLoads stays 0)
    await preview.renderNow('Euler: $e^{i\\pi} + 1 = 0$');
    const statsAfterMath = getPreviewLoaderStats();
    assert.equal(statsAfterMath.katexLoads, 1, 'KaTeX lazy-loaded once on first math expression');
    assert.equal(statsAfterMath.mermaidLoads, 0, 'Mermaid NOT loaded when no mermaid fence exists');
    preview.dispose();
  });

  // ── 11. Performance Budget Check (10k-Line Tokenize + Incremental Typing Latency) ──
  await test('Performance Budget: 10,000-line TS tokenize & incremental single-keystroke latency within budget', () => {
    const lines: string[] = [];
    for (let i = 0; i < 10_000; i++) {
      if (i % 20 === 0) lines.push(`export function batch_${i}(xs: number[]): string {`);
      else if (i % 20 === 19) lines.push('}');
      else lines.push(`  const msg_${i} = \`item \${xs[${i % 8}] * 2} ready\`; // ok`);
    }
    const model = new TextModel(lines.join('\n'), 'typescript');
    const tok = new TokenizationSupport();
    model.onDidChange((ver, change) => tok.applyChange(change, ver));

    const tFull0 = performance.now();
    for (let ln = 1; ln <= 10_000; ln++) tok.getLineTokens(model, ln);
    const fullMs = performance.now() - tFull0;

    // 50 incremental single-character edits on line 5000 + immediate re-tokenize of visible viewport (40 lines)
    const tEdit0 = performance.now();
    for (let k = 0; k < 50; k++) {
      const off = model.getOffsetAt(5000, 12);
      model.insert(off, 'a');
      for (let ln = 4990; ln <= 5030; ln++) tok.getLineTokens(model, ln);
    }
    const avgKeystrokeMs = (performance.now() - tEdit0) / 50;

    console.log(
      `       [perf] 10k-line full tokenize: ${fullMs.toFixed(1)} ms | avg incremental keystroke (40 visible lines): ${avgKeystrokeMs.toFixed(3)} ms`,
    );
    assert.ok(fullMs < 1500, `10k-line tokenize exceeded budget (${fullMs.toFixed(1)} ms)`);
    assert.ok(avgKeystrokeMs < 5, `incremental keystroke latency exceeded 5ms budget (${avgKeystrokeMs.toFixed(3)} ms)`);

    // Sanity check StateInterner deduplication
    const interner = new StateInterner<string>();
    const id1 = interner.intern('root', () => 'root');
    const id2 = interner.intern('root', () => 'root');
    const id3 = interner.intern('comment', () => 'comment');
    assert.equal(id1, id2);
    assert.notEqual(id1, id3);
  });

  console.log(`\nAll ${passed} Phase 5 Monarch/Embedded/Rainbow/Rename/Preview tests passed!`);
}

run().catch((err) => {
  console.error(err);
  process.exit(1);
});
