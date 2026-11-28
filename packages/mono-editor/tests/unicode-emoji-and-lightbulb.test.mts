import assert from 'node:assert/strict';
import test from 'node:test';
import type { IEditorContributionHost } from '../src/browser/editor/editorTypes';
import { buildFrameContext } from '../src/browser/render/frameContext';
import { coalesceStyledSpans, resolveLineSpans, textPass } from '../src/browser/render/passes/textPass';
import type { ViewController } from '../src/browser/view/ViewController';
import { withEmojiFontFallback } from '../src/common/config/editorOptions';
import { DEFAULT_THEME } from '../src/common/config/themeTypes';
import { SelectionState } from '../src/common/core/SelectionState';
import { registerDefaultLanguages } from '../src/common/languages/defaults/registerDefaults';
import { languageFeatures } from '../src/common/languages/languageFeaturesService';
import { languages } from '../src/common/languages/tokenization/TokensProvider';
import { TextModel } from '../src/common/model/TextModel';
import { CodeActionController } from '../src/contrib/codeAction/CodeActionController';
import { CodeActionLightbulbWidget } from '../src/contrib/codeAction/CodeActionLightbulbWidget';
import { CommandService } from '../src/platform/commands/CommandService';
import { KeybindingService } from '../src/platform/keybindings/KeybindingService';

registerDefaultLanguages();

class StubEl {
  tagName: string;
  id = '';
  className = '';
  title = '';
  type = '';
  style: Record<string, string> = {};
  parent: StubEl | null = null;
  children: StubEl[] = [];
  attrs = new Map<string, string>();
  clientWidth = 800;
  clientHeight = 500;
  offsetWidth = 220;
  offsetHeight = 64;
  private _text = '';

  constructor(tag: string) {
    this.tagName = tag.toUpperCase();
  }
  get textContent(): string {
    return this.children.length === 0 ? this._text : this._text + this.children.map((c) => c.textContent).join('');
  }
  set textContent(v: string) {
    this._text = v;
    this.children = [];
  }
  appendChild(child: StubEl): StubEl {
    child.parent = this;
    this.children.push(child);
    return child;
  }
  remove(): void {
    if (!this.parent) return;
    this.parent.children = this.parent.children.filter((c) => c !== this);
    this.parent = null;
  }
  setAttribute(k: string, v: string): void {
    this.attrs.set(k, v);
  }
  addEventListener(): void {}
  querySelectorAll(sel: string): StubEl[] {
    const out: StubEl[] = [];
    const cls = sel.startsWith('.') ? sel.slice(1) : null;
    const walk = (n: StubEl) => {
      for (const c of n.children) {
        if (cls && c.className.split(/\s+/).includes(cls)) out.push(c);
        walk(c);
      }
    };
    walk(this);
    return out;
  }
}

async function withStubDom<T>(fn: (root: StubEl) => T | Promise<T>): Promise<T> {
  const head = new StubEl('head');
  const prevDoc = (globalThis as Record<string, unknown>).document;
  (globalThis as Record<string, unknown>).document = {
    head,
    createElement: (tag: string) => new StubEl(tag),
    createTextNode: (t: string) => {
      const n = new StubEl('#text');
      n.textContent = t;
      return n;
    },
    getElementById: (id: string) => head.children.find((c) => c.id === id) ?? null,
    querySelector: () => null,
  };
  try {
    return await fn(new StubEl('div'));
  } finally {
    if (prevDoc === undefined) delete (globalThis as Record<string, unknown>).document;
    else (globalThis as Record<string, unknown>).document = prevDoc;
  }
}

test('complex scripts (Bengali, Hindi, Urdu) and emojis stay intact in tokenizers outside strings', () => {
  const jsProv = languages.getTokensProvider('javascript')!;
  const pyProv = languages.getTokensProvider('python')!;
  const cssProv = languages.getTokensProvider('css')!;
  const mdProv = languages.getTokensProvider('markdown')!;

  const samples = ['আমি', 'नमस्ते', 'اردو', '😀', '👨‍👩‍👧‍👦', '1️⃣'];
  for (const sample of samples) {
    for (const prov of [jsProv, pyProv, cssProv]) {
      const res = prov.tokenizeLine(sample, prov.getInitialState());
      assert.equal(res.tokens.length, 1, `${prov.languageId} must not split "${sample}"`);
      assert.equal(res.tokens[0]!.startColumn, 1);
      assert.equal(res.tokens[0]!.endColumn, sample.length + 1);
    }
  }

  // Mermaid fenced block inside markdown
  let state = mdProv.getInitialState();
  state = mdProv.tokenizeLine('```mermaid', state).endState;
  const mermaidLine = mdProv.tokenizeLine('আমি 😀', state);
  assert.equal(mermaidLine.tokens.length, 2);
  assert.equal(mermaidLine.tokens[0]!.endColumn, 4);
  assert.equal(mermaidLine.tokens[1]!.startColumn, 5);
  assert.equal(mermaidLine.tokens[1]!.endColumn, 'আমি 😀'.length + 1);
});

test('textPass coalesces same-style spans so multi-word complex scripts and emojis paint in one fillText call', () => {
  const jsProv = languages.getTokensProvider('javascript')!;
  const text = 'আমি বাংলায় 😀 1️⃣';
  const { tokens } = jsProv.tokenizeLine(text, jsProv.getInitialState());
  const spans = coalesceStyledSpans(resolveLineSpans(text.length, tokens, [], {}, DEFAULT_THEME.foreground));
  assert.equal(spans.length, 1);
  assert.equal(spans[0]!.start, 1);
  assert.equal(spans[0]!.end, text.length + 1);

  const fillCalls: { text: string; font: string }[] = [];
  const fakeCtx = {
    font: '',
    fillStyle: '',
    strokeStyle: '',
    lineWidth: 1,
    globalAlpha: 1,
    save() {},
    restore() {},
    beginPath() {},
    rect() {},
    clip() {},
    fillText(s: string) {
      fillCalls.push({ text: s, font: this.font });
    },
  } as unknown as CanvasRenderingContext2D;

  const model = new TextModel(text, 'javascript');
  const frame = buildFrameContext(
    {
      model,
      selection: new SelectionState(),
      scrollTop: 0,
      scrollLeft: 0,
      cssWidth: 600,
      cssHeight: 200,
      metrics: {
        fontFamily: 'JetBrains Mono, monospace',
        fontSize: 14,
        lineHeight: 20,
        gutterWidth: 40,
        charWidth: 8,
        paddingLeft: 8,
        paddingTop: 4,
      },
      theme: DEFAULT_THEME,
      showLineNumbers: true,
      overscan: 2,
      getLineTokens: () => tokens,
    },
    (_line, col) => (col - 1) * 8,
    (s) => s.length * 8,
  );

  textPass.paint(fakeCtx, frame);
  assert.equal(fillCalls.length, 1);
  assert.equal(fillCalls[0]!.text, text);
  assert.match(withEmojiFontFallback('JetBrains Mono'), /Noto Color Emoji/);
});

test('CodeActionLightbulbWidget and CodeActionController scale with editor fontSize', async () => {
  await withStubDom(async (root) => {
    const widget = new CodeActionLightbulbWidget(root as unknown as HTMLElement);
    widget.setFontOptions({ fontSize: 14, lineHeight: 20 });
    assert.equal(widget.getBulbSize(), 20);

    widget.setFontOptions({ fontSize: 28, lineHeight: 41 });
    assert.equal(widget.getBulbSize(), 40);

    const actions = [{ title: 'Fix import', kind: 'quickfix' }];
    widget.showLightbulb(actions, { x: 10, y: 5 }, () => {});
    const bulb = root.querySelectorAll('.mono-code-action-bulb')[0]!;
    assert.equal(bulb.style.width, '40px');
    assert.equal(bulb.style.height, '40px');

    widget.openMenu(actions, { x: 20, y: 40 }, () => {});
    const menu = root.querySelectorAll('.mono-code-action-menu')[0]!;
    assert.equal(menu.style.fontSize, '24px');

    // Verify CodeActionController updates visible lightbulb synchronously on fontSize patch
    let fontSize = 14;
    let lineHeight = 20;
    let contentLeft = 40;
    const model = new TextModel('const x = 1;', 'typescript');
    const selection = new SelectionState();
    const viewStub = {
      get contentLeft() { return contentLeft; },
      get lineHeight() { return lineHeight; },
      screenPosOf: () => ({ x: contentLeft, y: 10, h: lineHeight }),
      caretScreenPos: () => ({ x: contentLeft, y: 10, h: lineHeight }),
    } as unknown as ViewController;

    const host = {
      root: root as unknown as HTMLElement,
      view: viewStub,
      selection,
      commands: new CommandService(),
      keybindings: new KeybindingService(),
      isDisposed: () => false,
      getFontSize: () => fontSize,
      getLineHeight: () => lineHeight,
      getModel: () => model,
      getSelection: () => ({
        startLineNumber: selection.anchor.lineNumber,
        startColumn: selection.anchor.column,
        endLineNumber: selection.active.lineNumber,
        endColumn: selection.active.column,
      }),
      getLanguageIdAtPosition: () => 'typescript',
      getMarkers: () => [],
      modelAsFeatureLike: () => ({}),
      initialOptions: { lightbulb: { enabled: 'on' } },
      focus() {},
      applyWorkspaceEdit: () => true,
      executeCommand: async () => undefined,
    } as unknown as IEditorContributionHost;

    const reg = languageFeatures.registerCodeActionProvider('typescript', {
      provideCodeActions: () => ({ actions: [{ title: 'Extract constant', kind: 'refactor' }] }),
    });
    const ctrl = new CodeActionController(host);
    try {
      ctrl.onPointerInteract('tap');
      await new Promise((r) => setTimeout(r, 260));

      const initialBulb = root.querySelectorAll('.mono-code-action-bulb').at(-1)!;
      assert.equal(initialBulb.style.width, '20px');

      fontSize = 28;
      lineHeight = 41;
      contentLeft = 64;
      ctrl.onOptionsChange({ fontSize: 28, lineHeight: 41 });

      const scaledBulb = root.querySelectorAll('.mono-code-action-bulb').at(-1)!;
      assert.equal(scaledBulb.style.width, '40px');
      assert.equal(scaledBulb.style.height, '40px');
    } finally {
      ctrl.dispose();
      reg.dispose();
    }
  });
});
