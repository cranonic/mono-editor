import assert from 'node:assert/strict';
import test from 'node:test';
import { registerCoreKeybindingsAndActions } from '../src/browser/editor/defaultKeybindings';
import type { IEditorContributionHost } from '../src/browser/editor/editorTypes';
import type { ViewController } from '../src/browser/view/ViewController';
import { SelectionState } from '../src/common/core/SelectionState';
import { registerDefaultLanguages } from '../src/common/languages/defaults/registerDefaults';
import { languageFeatures } from '../src/common/languages/languageFeaturesService';
import { CompletionItemKind } from '../src/common/languages/providers/types';
import { TextModel } from '../src/common/model/TextModel';
import { SuggestContribution } from '../src/contrib/suggest/SuggestContribution';
import { SuggestWidget } from '../src/contrib/suggest/SuggestWidget';
import { isDetailDuplicatedInDoc } from '../src/contrib/suggest/widget/suggestDetailsPane';
import { CommandService } from '../src/platform/commands/CommandService';
import { KeybindingService, MonoCommands } from '../src/platform/keybindings/KeybindingService';

registerDefaultLanguages();

type Listener = (ev: Record<string, unknown>) => void;

class StubEl {
  tagName: string;
  id = '';
  className = '';
  style: Record<string, string> = {};
  parent: StubEl | null = null;
  children: StubEl[] = [];
  attrs = new Map<string, string>();
  listeners = new Map<string, Listener[]>();
  clientWidth = 800;
  clientHeight = 500;
  offsetWidth = 240;
  offsetHeight = 96;
  scrollWidth = 240;
  scrollHeight = 96;
  scrollTop = 0;
  private _text = '';

  constructor(tag: string) {
    this.tagName = tag.toUpperCase();
  }

  get textContent(): string {
    if (this.children.length === 0) return this._text;
    return this._text + this.children.map((c) => c.textContent).join('');
  }
  set textContent(v: string) {
    this._text = v;
    this.children = [];
  }
  get offsetTop(): number {
    return 0;
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
  contains(node: unknown): boolean {
    if (node === this) return true;
    return this.children.some((c) => c.contains(node));
  }
  setAttribute(k: string, v: string): void {
    this.attrs.set(k, v);
  }
  addEventListener(type: string, fn: Listener): void {
    const list = this.listeners.get(type) ?? [];
    list.push(fn);
    this.listeners.set(type, list);
  }
  removeEventListener(type: string, fn: Listener): void {
    const list = this.listeners.get(type);
    if (list) this.listeners.set(type, list.filter((x) => x !== fn));
  }
  querySelectorAll(sel: string): StubEl[] {
    const out: StubEl[] = [];
    const cls = sel.startsWith('.') ? sel.slice(1) : null;
    const tag = !cls ? sel.toUpperCase() : null;
    const walk = (n: StubEl) => {
      for (const c of n.children) {
        if (cls && c.className.split(/\s+/).includes(cls)) out.push(c);
        else if (tag && c.tagName === tag) out.push(c);
        walk(c);
      }
    };
    walk(this);
    return out;
  }
  getBoundingClientRect() {
    return {
      left: 0,
      top: 0,
      right: this.clientWidth,
      bottom: this.clientHeight,
      width: this.clientWidth,
      height: this.clientHeight,
    };
  }
}

async function withStubDom<T>(fn: (root: StubEl) => T | Promise<T>): Promise<T> {
  const head = new StubEl('head');
  const prevDoc = (globalThis as Record<string, unknown>).document;
  const prevKb = (globalThis as Record<string, unknown>).KeyboardEvent;
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
  if (!prevKb) {
    (globalThis as Record<string, unknown>).KeyboardEvent = class StubKeyboardEvent {
      type: string;
      constructor(type: string) {
        this.type = type;
      }
    };
  }
  try {
    return await fn(new StubEl('div'));
  } finally {
    if (prevDoc === undefined) delete (globalThis as Record<string, unknown>).document;
    else (globalThis as Record<string, unknown>).document = prevDoc;
    if (prevKb === undefined) delete (globalThis as Record<string, unknown>).KeyboardEvent;
    else (globalThis as Record<string, unknown>).KeyboardEvent = prevKb;
  }
}

test('isDetailDuplicatedInDoc detects fenced signature duplicates and preserves distinct details', () => {
  assert.equal(
    isDetailDuplicatedInDoc(
      'var document: Document',
      '```ts\nvar document: Document\n```\n\nDOM document object.',
    ),
    true,
  );
  assert.equal(
    isDetailDuplicatedInDoc(
      '(method) Array<number>.push(...items: number[]): number',
      '```ts\n(method) Array<number>.push(...items: number[]): number\n```',
    ),
    true,
  );
  assert.equal(
    isDetailDuplicatedInDoc('Emmet Abbreviation', '```html\n<div></div>\n```'),
    false,
  );
  assert.equal(
    isDetailDuplicatedInDoc('(name: string) => string', 'Greets a user.'),
    false,
  );
});

test('SuggestWidget docs pane omits duplicate un-highlighted detail header when documentation already contains fenced signature', async () => {
  await withStubDom((root) => {
    const sg = new SuggestWidget(
      root as unknown as HTMLElement,
      { onAccept: () => {}, onDismiss: () => {} },
      { fontSize: 14, docsMode: 'auto' },
    );

    const sig = 'function addNumbers(left: number, right: number): number';
    sg.show(
      [
        {
          label: 'addNumbers',
          kind: CompletionItemKind.Function,
          detail: sig,
          documentation: { value: `\`\`\`ts\n${sig}\n\`\`\`\n\nAdds two numbers.` },
          insertText: 'addNumbers',
        },
      ],
      { x: 40, y: 120, top: 96 },
      'add',
    );

    const docsPanes = root.querySelectorAll('.mono-suggest-docs');
    assert.equal(docsPanes.length, 1, 'renders exactly one .mono-suggest-docs popup');
    const docsEl = docsPanes[0]!;

    // Must not render the signature twice (no plain-text header above the syntax-colored <pre>)
    const occurrences = docsEl.textContent.split('addNumbers').length - 1;
    assert.equal(occurrences, 1, 'signature must appear only once inside completion docs');

    // First child should be the markdown <pre>, with syntax-highlighted <span> tokens inside <code>
    assert.equal(docsEl.children[0]?.tagName, 'PRE', 'first block in docs is syntax-highlighted <pre>');
    const colorSpans = docsEl.querySelectorAll('span').filter((s) => Boolean(s.style.color));
    assert.ok(colorSpans.length > 0, 'fenced code signature has syntax highlighting spans');

    // Distinct detail (not duplicated in documentation) still renders its header above docs
    sg.show(
      [
        {
          label: 'div',
          kind: CompletionItemKind.Property,
          detail: 'Emmet Abbreviation',
          documentation: { value: '```html\n<div></div>\n```' },
          insertText: 'div',
        },
      ],
      { x: 40, y: 120, top: 96 },
      'div',
    );
    assert.ok(
      docsEl.textContent.includes('Emmet Abbreviation'),
      'non-duplicate detail header still renders when distinct from markdown documentation',
    );

    sg.dispose();
  });
});

test('SuggestContribution closes completion palette on Undo (via keybinding command or model undo) and stays closed until typing', async () => {
  await withStubDom(async (root) => {
    const model = new TextModel('', 'typescript');
    const selection = new SelectionState();
    model.setSelectionCapture(() => ({
      aLine: selection.anchor.lineNumber,
      aCol: selection.anchor.column,
      bLine: selection.active.lineNumber,
      bCol: selection.active.column,
    }));

    const providerReg = languageFeatures.registerCompletionItemProvider('typescript', {
      provideCompletionItems: () => ({
        suggestions: [
          { label: 'apple', kind: CompletionItemKind.Variable, insertText: 'apple' },
          { label: 'alert', kind: CompletionItemKind.Function, insertText: 'alert' },
        ],
      }),
    });

    const keybindings = new KeybindingService();
    const commands = new CommandService(keybindings);
    const cursorSources: string[] = [];

    const view = {
      isLineInView: () => true,
      screenPosOf: () => ({ x: 40, y: 120, h: 22 }),
      ensureCaretVisible: () => {},
      paint: () => {},
      notifyCaretActivity: () => {},
    } as unknown as ViewController;

    let contrib!: SuggestContribution;
    const emitCursor = (src: string, keepSuggest = false) => {
      cursorSources.push(src);
      contrib.onCursorChange(src, keepSuggest);
    };

    const host = {
      root: root as unknown as HTMLDivElement,
      view,
      input: {
        setPreKeyHandler: () => {},
        focus: () => {},
      },
      selection,
      commands,
      keybindings,
      initialOptions: { quickSuggestions: true, quickSuggestionsDelay: 0 },
      isReadOnly: () => false,
      getTabSize: () => 2,
      getFontFamily: () => 'monospace',
      getFontSize: () => 14,
      getModel: () => model,
      getTokenTypeAt: () => null,
      getLanguageIdAtPosition: () => 'typescript',
      setSuggestWidgetRect: () => {},
      setContext: () => {},
      setGhostTexts: () => {},
      clearGhostTexts: () => {},
      getGhostTexts: () => [],
      syncTextarea: () => {},
      emitContent: () => {},
      emitCursorEvents: emitCursor,
      executeEdits: () => true,
      getTheme: () => ({ background: '#1e1e1e' }),
    } as unknown as IEditorContributionHost;

    registerCoreKeybindingsAndActions({
      getModel: () => model,
      selection,
      view,
      keybindings,
      commands,
      isReadOnly: () => false,
      getTabSize: () => 2,
      syncTextarea: () => {},
      emitContent: () => {},
      emitCursorEvents: (src) => emitCursor(src),
      applyStackSelection: (entry, mode) => {
        if (!entry) return;
        const sel = mode === 'undo' ? entry.beforeSel : entry.afterSel;
        if (sel) {
          selection.anchor = { lineNumber: sel.aLine, column: sel.aCol };
          selection.active = { lineNumber: sel.bLine, column: sel.bCol };
        }
      },
    });

    contrib = new SuggestContribution(host);
    const unsubModel = model.onDidChange((versionId, change) => {
      contrib.onModelContentChange(versionId, change);
    });

    try {
      // 1. User types `a` -> completion palette opens
      selection.setCaret(1, 1);
      model.insert(0, 'a', 'typing');
      selection.setCaret(1, 2);
      contrib.onInputChange({ kind: 'type', text: 'a' });
      await new Promise((r) => setTimeout(r, 20));
      assert.ok(root.querySelectorAll('.mono-suggest-widget').length === 1, 'completion palette opens after typing a');

      // 2. User runs Undo -> completion palette must close and emit 'undo' cursor source
      await commands.executeCommand(MonoCommands.Undo);
      await new Promise((r) => setTimeout(r, 20));
      assert.equal(model.getValue(), '', 'undo reverted typed character');
      assert.ok(cursorSources.includes('undo'), 'Undo command emits undo cursor event');
      assert.equal(root.querySelectorAll('.mono-suggest-widget').length, 0, 'completion palette closes on undo');

      // 3. Even if undo restores same caret coords, isUndoing model change closes completion palette
      selection.setCaret(1, 1);
      model.replaceRange(0, 0, 'al', { aLine: 1, aCol: 3, bLine: 1, bCol: 3 }, 'typing');
      selection.setCaret(1, 3);
      contrib.onInputChange({ kind: 'type', text: 'al' });
      await new Promise((r) => setTimeout(r, 20));
      assert.equal(root.querySelectorAll('.mono-suggest-widget').length, 1, 'completion palette open before model.undo');
      model.undo();
      await new Promise((r) => setTimeout(r, 20));
      assert.equal(root.querySelectorAll('.mono-suggest-widget').length, 0, 'direct model.undo closes completion palette');

      // 4. Stays closed until user types again, then opens normally on typing
      assert.equal(root.querySelectorAll('.mono-suggest-widget').length, 0, 'stays closed after undo');
      selection.setCaret(1, 1);
      model.insert(0, 'a', 'typing');
      selection.setCaret(1, 2);
      contrib.onInputChange({ kind: 'type', text: 'a' });
      await new Promise((r) => setTimeout(r, 20));
      assert.equal(root.querySelectorAll('.mono-suggest-widget').length, 1, 'completion palette opens again when typing resumes');
    } finally {
      unsubModel();
      contrib.dispose();
      providerReg.dispose();
    }
  });
});
