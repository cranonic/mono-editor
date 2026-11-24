import assert from 'node:assert/strict';
import {
  editor,
  languages,
  Position,
  Range,
  Selection,
  Uri,
  SelectionDirection,
  EndOfLineSequence,
  CompletionTriggerKind,
  IndentAction,
  KeyMod,
  KeyCode,
  CompletionItemKind,
  MarkerSeverity,
  MonoCommands,
  createMonoEditor,
  evaluateOnEnter,
  getLanguageConfiguration,
  registerDefaultLanguageConfigurations,
  toggleLineComment,
  toggleBlockComment,
  moveLines,
  duplicateLines,
  deleteLines,
  insertLine,
} from '../src/index';
import { TextModel } from '../src/common/model/TextModel';
import { SelectionState } from '../src/common/core/SelectionState';
import { InputController, type CompositionRange } from '../src/browser/input/InputController';
import { SuggestWidget } from '../src/contrib/suggest/SuggestWidget';
import { SuggestController } from '../src/contrib/suggest/SuggestController';

let passed = 0;
function test(name: string, fn: () => void | Promise<void>) {
  return Promise.resolve()
    .then(fn)
    .then(() => {
      passed++;
      console.log(`  ok  ${name}`);
    });
}

// ── Minimal Node DOM stub for InputController & SuggestWidget tests ──────────

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
    const event = {
      type,
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
  (globalThis as any).document = doc;
  (globalThis as any).window = {
    devicePixelRatio: 1,
    addEventListener: () => {},
    removeEventListener: () => {},
    setTimeout,
    clearTimeout,
  };
  (globalThis as any).requestAnimationFrame = (cb: FrameRequestCallback) => {
    cb(0);
    return 1;
  };
  (globalThis as any).cancelAnimationFrame = () => {};
  return doc;
}

async function run() {
  console.log('Phase 1 — Mono API & Daily Coding Engine Tests');
  installDomStub();

  // ── 1. Monaco Core Types ───────────────────────────────────────────────────
  await test('Position, Range, Selection, Uri & erasable constants match Monaco semantics', () => {
    const p1 = new Position(2, 5);
    const p2 = p1.delta(1, -2);
    assert.equal(p2.lineNumber, 3);
    assert.equal(p2.column, 3);
    assert.equal(p1.isBefore(p2), true);
    assert.equal(Position.compare(p1, p2) < 0, true);

    // Reversed range normalizes start/end
    const r = new Range(4, 10, 2, 3);
    assert.equal(r.startLineNumber, 2);
    assert.equal(r.startColumn, 3);
    assert.equal(r.endLineNumber, 4);
    assert.equal(r.endColumn, 10);
    assert.equal(r.containsPosition(new Position(3, 1)), true);
    assert.equal(r.containsPosition(new Position(1, 1)), false);
    assert.equal(r.intersectRanges(new Range(3, 1, 5, 1))?.toString(), '[3,1 -> 4,10]');

    // RTL Selection preserves direction while normalizing Range bounds
    const sel = new Selection(5, 8, 2, 1);
    assert.equal(sel.startLineNumber, 2);
    assert.equal(sel.endLineNumber, 5);
    assert.equal(sel.getDirection(), SelectionDirection.RTL);
    assert.equal(sel.getPosition().equals(new Position(2, 1)), true);
    assert.equal(sel.getSelectionStart().equals(new Position(5, 8)), true);

    // Uri parse & file
    const u = Uri.file('/workspace/app/index.ts');
    assert.equal(u.scheme, 'file');
    assert.equal(u.path, '/workspace/app/index.ts');
    assert.equal(u.toString(), 'file:///workspace/app/index.ts');
    const u2 = Uri.parse('inmemory://model/42?v=1#top');
    assert.equal(u2.scheme, 'inmemory');
    assert.equal(u2.authority, 'model');
    assert.equal(u2.path, '/42');
    assert.equal(u2.query, 'v=1');
    assert.equal(u2.fragment, 'top');

    // Erasable enum constants
    assert.equal(IndentAction.IndentOutdent, 2);
    assert.equal(EndOfLineSequence.CRLF, 1);
    assert.equal(CompletionTriggerKind.TriggerCharacter, 1);
    assert.equal(KeyMod.CtrlCmd | KeyCode.Slash, 2048 | 85);
    assert.equal(typeof createMonoEditor, 'function');
  });

  // ── 2. Monaco editor.* & languages.* namespaces ────────────────────────────
  await test('editor.* and languages.* namespaces expose Monaco API cleanly', () => {
    const model = editor.createModel('const x = 1;\nconst y = 2;', 'typescript');
    assert.equal(model.getLineCount(), 2);
    assert.equal(model.getLanguageId(), 'typescript');
    assert.ok(editor.getModel(model.uri) === model);

    editor.setModelMarkers(model, 'ts', [
      {
        startLineNumber: 1,
        startColumn: 7,
        endLineNumber: 1,
        endColumn: 8,
        message: 'Unused variable x',
        severity: MarkerSeverity.Warning,
      },
    ]);
    const markers = editor.getModelMarkers({ resource: model.uri, owner: 'ts' });
    assert.equal(markers.length, 1);
    assert.equal(markers[0]!.message, 'Unused variable x');
    model.dispose();
    assert.equal(editor.getModel(model.uri), null);

    // Unified languages namespace
    assert.equal(languages.CompletionItemKind.Method, CompletionItemKind.Method);
    assert.equal(languages.IndentAction.Indent, IndentAction.Indent);
    assert.ok(languages.getLanguages().length >= 12);
  });

  // ── 3. All 11 built-in LanguageConfigurations ──────────────────────────────
  await test('All 11 built-in language families + aliases ship full LanguageConfigurations', () => {
    registerDefaultLanguageConfigurations();
    const expected: Array<[string, string | undefined, [string, string] | undefined]> = [
      ['javascript', '//', ['/*', '*/']],
      ['js', '//', ['/*', '*/']],
      ['jsx', '//', ['/*', '*/']],
      ['typescript', '//', ['/*', '*/']],
      ['ts', '//', ['/*', '*/']],
      ['tsx', '//', ['/*', '*/']],
      ['json', '//', ['/*', '*/']],
      ['css', undefined, ['/*', '*/']],
      ['html', undefined, ['<!--', '-->']],
      ['java', '//', ['/*', '*/']],
      ['python', '#', undefined],
      ['py', '#', undefined],
      ['markdown', undefined, ['<!--', '-->']],
      ['md', undefined, ['<!--', '-->']],
      ['yaml', '#', undefined],
      ['yml', '#', undefined],
      ['shell', '#', undefined],
      ['bash', '#', undefined],
      ['sh', '#', undefined],
      ['sql', '--', ['/*', '*/']],
      ['c', '//', ['/*', '*/']],
      ['cpp', '//', ['/*', '*/']],
    ];

    for (const [id, lineComment, blockComment] of expected) {
      const cfg = languages.getLanguageConfiguration(id);
      assert.ok(cfg, `Missing LanguageConfiguration for ${id}`);
      assert.equal(cfg.comments?.lineComment ?? undefined, lineComment, `lineComment mismatch for ${id}`);
      assert.deepEqual(cfg.comments?.blockComment ?? undefined, blockComment, `blockComment mismatch for ${id}`);
    }

    // Custom override works & disposes cleanly
    const sub = languages.setLanguageConfiguration('rust', {
      comments: { lineComment: '//', blockComment: ['/*', '*/'] },
      brackets: [['{', '}']],
    });
    assert.equal(languages.getLanguageConfiguration('rust')?.comments?.lineComment, '//');
    sub.dispose();
    assert.equal(languages.getLanguageConfiguration('rust'), undefined);
  });

  // ── 4. Data-driven OnEnterEngine ───────────────────────────────────────────
  await test('evaluateOnEnter handles JS {|}\/JSDoc, Python :, YAML :, HTML tags, Markdown list, Plaintext', () => {
    const js = getLanguageConfiguration('javascript');
    const jsBrace = evaluateOnEnter(js, '  function a() {}', 17, '', 2, 'full');
    assert.equal(jsBrace.indentAction, IndentAction.IndentOutdent);
    assert.equal(jsBrace.insertText, '\n    \n  ');
    assert.equal(jsBrace.caretColumn, 5);

    const jsDoc = evaluateOnEnter(js, '  /** */', 6, '', 2, 'full');
    assert.equal(jsDoc.indentAction, IndentAction.IndentOutdent);
    assert.equal(jsDoc.insertText, '\n   * \n   ');

    const py = getLanguageConfiguration('python');
    const pyDef = evaluateOnEnter(py, '  def greet(name):', 19, '', 4, 'full');
    assert.equal(pyDef.indentAction, IndentAction.Indent);
    assert.equal(pyDef.insertText, '\n      ');

    const yaml = getLanguageConfiguration('yaml');
    const ymlRes = evaluateOnEnter(yaml, 'services:', 10, '', 2, 'full');
    assert.equal(ymlRes.indentAction, IndentAction.Indent);
    assert.equal(ymlRes.insertText, '\n  ');

    const html = getLanguageConfiguration('html');
    const htmlTag = evaluateOnEnter(html, '  <div></div>', 8, '', 2, 'full');
    assert.equal(htmlTag.indentAction, IndentAction.IndentOutdent);
    assert.equal(htmlTag.insertText, '\n    \n  ');

    const md = getLanguageConfiguration('markdown');
    const mdList = evaluateOnEnter(md, '- first item', 13, '', 2, 'full');
    assert.equal(mdList.insertText, '\n- ');

    const plain = getLanguageConfiguration('plaintext');
    const plainRes = evaluateOnEnter(plain, '  hello {}', 10, '', 2, 'full');
    assert.equal(plainRes.indentAction, IndentAction.None);
    assert.equal(plainRes.insertText, '\n  ');
  });

  // ── 5. Auto-Close, Overtype, Auto-Surround, Pair Backspace, notIn ──────────
  await test('InputController auto-close, overtype, auto-surround, pair backspace, and notIn guard', () => {
    const host = new StubElement('div');
    const model = new TextModel('', 'javascript');
    const sel = new SelectionState();
    let tokenOverride: string | null = null;

    const input = new InputController(
      host as any,
      model,
      sel,
      () => {},
      {
        tabSize: 2,
        getTokenTypeAt: () => tokenOverride,
      },
    );
    const ta = input.textarea as unknown as StubElement;

    const typeChar = (ch: string) => {
      ta.value = ch;
      ta.dispatch('input', { isComposing: false });
    };
    const pressKey = (key: string) => {
      ta.dispatch('keydown', { key, code: key, shiftKey: false, ctrlKey: false, metaKey: false, altKey: false });
    };

    // Auto-close '(' -> '(|)'
    typeChar('(');
    assert.equal(model.getValue(), '()');
    assert.deepEqual(sel.active, { lineNumber: 1, column: 2 });

    // Overtype ')' -> '()|'
    typeChar(')');
    assert.equal(model.getValue(), '()');
    assert.deepEqual(sel.active, { lineNumber: 1, column: 3 });

    // Pair backspace on empty '(|)'
    sel.setCaret(1, 2);
    pressKey('Backspace');
    assert.equal(model.getValue(), '');
    assert.deepEqual(sel.active, { lineNumber: 1, column: 1 });

    // Auto-surround selected word with quotes -> '"hello"' keeping 'hello' selected
    model.setValue('hello');
    sel.anchor = { lineNumber: 1, column: 1 };
    sel.active = { lineNumber: 1, column: 6 };
    typeChar('"');
    assert.equal(model.getValue(), '"hello"');
    assert.deepEqual(sel.anchor, { lineNumber: 1, column: 2 });
    assert.deepEqual(sel.active, { lineNumber: 1, column: 7 });

    // Single undo reverts auto-surround cleanly
    assert.equal(model.undo(), true);
    assert.equal(model.getValue(), 'hello');

    // notIn: ['comment'] prevents auto-closing quotes inside a comment
    model.setValue('// ');
    sel.setCaret(1, 4);
    tokenOverride = 'comment';
    typeChar('"');
    assert.equal(model.getValue(), '// "');
    tokenOverride = null;

    // Smart Enter on Python line ending with ':'
    model.setLanguageId('python');
    model.setValue('def run():');
    sel.setCaret(1, 11);
    pressKey('Enter');
    assert.equal(model.getValue(), 'def run():\n  ');
    assert.deepEqual(sel.active, { lineNumber: 2, column: 3 });

    input.dispose();
  });

  // ── 6. Comments & Line Operations (single undo step) ───────────────────────
  await test('Toggle line/block comments and move/duplicate/delete/insert line ops with 1-step undo', () => {
    const model = new TextModel('  const a = 1;\n    const b = 2;\n\n  const c = 3;', 'javascript');
    const sel = new SelectionState();
    model.setSelectionCapture(() => ({
      aLine: sel.anchor.lineNumber,
      aCol: sel.anchor.column,
      bLine: sel.active.lineNumber,
      bCol: sel.active.column,
    }));
    const jsCfg = getLanguageConfiguration('javascript');

    // Multi-line comment preserves shared min indent (2 spaces) and skips blank line
    sel.anchor = { lineNumber: 1, column: 3 };
    sel.active = { lineNumber: 4, column: 5 };
    assert.equal(toggleLineComment(model, sel, jsCfg), true);
    assert.equal(
      model.getValue(),
      '  // const a = 1;\n  //   const b = 2;\n\n  // const c = 3;',
    );

    // Toggle again uncomments cleanly
    assert.equal(toggleLineComment(model, sel, jsCfg), true);
    assert.equal(model.getValue(), '  const a = 1;\n    const b = 2;\n\n  const c = 3;');

    // Undo once restores commented state in 1 step
    assert.equal(model.undo(), true);
    assert.equal(
      model.getValue(),
      '  // const a = 1;\n  //   const b = 2;\n\n  // const c = 3;',
    );

    // CSS falls back to block comment on toggleLineComment
    const cssModel = new TextModel('  color: red;', 'css');
    const cssSel = new SelectionState();
    cssSel.setCaret(1, 4);
    assert.equal(toggleLineComment(cssModel, cssSel, getLanguageConfiguration('css')), true);
    assert.equal(cssModel.getValue(), '  /* color: red; */');
    assert.equal(toggleLineComment(cssModel, cssSel, getLanguageConfiguration('css')), true);
    assert.equal(cssModel.getValue(), '  color: red;');

    // Block comment wrap & unwrap on selection
    const blkModel = new TextModel('const x = foo + bar;', 'javascript');
    const blkSel = new SelectionState();
    blkSel.anchor = { lineNumber: 1, column: 11 };
    blkSel.active = { lineNumber: 1, column: 14 };
    assert.equal(toggleBlockComment(blkModel, blkSel, jsCfg), true);
    assert.equal(blkModel.getValue(), 'const x = /* foo */ + bar;');
    assert.equal(toggleBlockComment(blkModel, blkSel, jsCfg), true);
    assert.equal(blkModel.getValue(), 'const x = foo + bar;');

    // Move line up / down
    const lnModel = new TextModel('alpha\nbeta\ngamma', 'javascript');
    const lnSel = new SelectionState();
    lnSel.setCaret(2, 3);
    assert.equal(moveLines(lnModel, lnSel, 'up'), true);
    assert.equal(lnModel.getValue(), 'beta\nalpha\ngamma');
    assert.deepEqual(lnSel.active, { lineNumber: 1, column: 3 });
    assert.equal(moveLines(lnModel, lnSel, 'up'), false); // already top

    assert.equal(moveLines(lnModel, lnSel, 'down'), true);
    assert.equal(lnModel.getValue(), 'alpha\nbeta\ngamma');
    assert.deepEqual(lnSel.active, { lineNumber: 2, column: 3 });

    // Duplicate line down & undo in 1 step
    assert.equal(duplicateLines(lnModel, lnSel, 'down'), true);
    assert.equal(lnModel.getValue(), 'alpha\nbeta\nbeta\ngamma');
    assert.deepEqual(lnSel.active, { lineNumber: 3, column: 3 });
    assert.equal(lnModel.undo(), true);
    assert.equal(lnModel.getValue(), 'alpha\nbeta\ngamma');

    // Delete line
    lnSel.setCaret(2, 2);
    assert.equal(deleteLines(lnModel, lnSel), true);
    assert.equal(lnModel.getValue(), 'alpha\ngamma');
    assert.deepEqual(lnSel.active, { lineNumber: 2, column: 2 });

    // Insert line below (with auto-indent after '{') and above
    const insModel = new TextModel('  if (ok) {', 'javascript');
    const insSel = new SelectionState();
    insSel.setCaret(1, 4); // mid-line
    assert.equal(insertLine(insModel, insSel, 'below', jsCfg, 2), true);
    assert.equal(insModel.getValue(), '  if (ok) {\n    ');
    assert.deepEqual(insSel.active, { lineNumber: 2, column: 5 });

    insSel.setCaret(1, 5);
    assert.equal(insertLine(insModel, insSel, 'above', jsCfg, 2), true);
    assert.equal(insModel.getValue(), '  \n  if (ok) {\n    ');
    assert.deepEqual(insSel.active, { lineNumber: 1, column: 3 });
  });

  // ── 7. IME Composition Lifecycle ───────────────────────────────────────────
  await test('IME composition previews live range with underline and commits as 1 clean undo step', () => {
    const host = new StubElement('div');
    const model = new TextModel('const s = "";', 'javascript');
    const sel = new SelectionState();
    sel.setCaret(1, 12);
    model.setSelectionCapture(() => ({
      aLine: sel.anchor.lineNumber,
      aCol: sel.anchor.column,
      bLine: sel.active.lineNumber,
      bCol: sel.active.column,
    }));

    const ranges: Array<CompositionRange | null> = [];
    const events: string[] = [];

    const input = new InputController(
      host as any,
      model,
      sel,
      (ev) => events.push(ev.kind),
      {
        onCompositionChange: (r) => ranges.push(r),
      },
    );
    const ta = input.textarea as unknown as StubElement;

    ta.dispatch('compositionstart');
    assert.equal(input.isComposing(), true);

    ta.dispatch('compositionupdate', { data: 'ব' });
    assert.equal(model.getValue(), 'const s = "ব";');
    assert.deepEqual(ranges[ranges.length - 1], {
      startLineNumber: 1,
      startColumn: 12,
      endLineNumber: 1,
      endColumn: 13,
    });

    // Browser firing `input` while composing must NOT double-insert
    ta.value = 'বাং';
    ta.dispatch('input', { isComposing: true });
    assert.equal(model.getValue(), 'const s = "ব";');

    ta.dispatch('compositionupdate', { data: 'বাংলা' });
    assert.equal(model.getValue(), 'const s = "বাংলা";');

    ta.dispatch('compositionend', { data: 'বাংলাদেশ' });
    assert.equal(input.isComposing(), false);
    assert.equal(ranges[ranges.length - 1], null);
    assert.equal(model.getValue(), 'const s = "বাংলাদেশ";');
    assert.deepEqual(sel.active, { lineNumber: 1, column: 20 });
    assert.equal(events[events.length - 1], 'type');

    // ONE undo restores the exact pre-composition state!
    const undone = model.undoEntry();
    assert.ok(undone);
    assert.equal(model.getValue(), 'const s = "";');
    assert.equal(model.undoEntry(), null); // no intermediate composition steps on stack

    input.dispose();
  });

  // ── 8. Completion Tap Keeps Soft Keyboard Open (Synchronous Refocus) ──────
  await test('Tapping a SuggestWidget row accepts completion and keeps textarea synchronously focused', async () => {
    const doc = installDomStub();
    const host = new StubElement('div');
    const model = new TextModel('conso', 'javascript');
    const sel = new SelectionState();
    sel.setCaret(1, 6);

    const input = new InputController(host as any, model, sel, () => {});
    const ta = input.textarea as unknown as StubElement;
    input.focus();
    const focusBefore = ta.focusCalls;
    assert.equal(doc.activeElement, ta);

    let acceptedEdit = false;
    const viewStub: any = {
      screenPosOf: () => ({ x: 40, y: 20, h: 22 }),
      isLineInView: () => true,
      ensureCaretVisible: () => {},
      paint: () => {},
    };

    const controller = new SuggestController(
      host as any,
      model,
      sel,
      viewStub,
      () => {
        acceptedEdit = true;
        // Mirrors MonoEditor's synchronous refocus inside SuggestController's onEdit
        input.focus();
      },
    );

    const disp = languages.registerCompletionItemProvider('javascript', {
      provideCompletionItems() {
        return {
          suggestions: [
            { label: 'console', kind: CompletionItemKind.Variable, insertText: 'console' },
          ],
        };
      },
    });

    await controller.trigger();
    assert.equal(controller.isOpen(), true);

    // Find the rendered SuggestWidget row and simulate a mobile touch tap
    const widgetEl = host.children.find((c) => c.className.includes('mono-suggest-widget'));
    assert.ok(widgetEl, 'SuggestWidget should be mounted');
    const listEl = widgetEl.children[0]!;
    const rowEl = listEl.children[0]!;
    assert.ok(rowEl, 'Suggestion row should be rendered');

    // Simulate mobile touch where browser blurs activeElement during touch gesture
    doc.activeElement = doc.body;
    rowEl.dispatch('pointerdown', { pointerType: 'touch', clientX: 50, clientY: 30 });
    const upEv = rowEl.dispatch('pointerup', { pointerType: 'touch', clientX: 51, clientY: 31 });

    assert.equal(upEv.defaultPrevented, true);
    assert.equal(acceptedEdit, true);
    assert.equal(model.getValue(), 'console');
    assert.equal(controller.isOpen(), false);
    // Focus MUST be restored synchronously inside pointerup (before any timers) so soft keyboard stays open
    assert.equal(doc.activeElement, ta);
    assert.ok(ta.focusCalls > focusBefore);

    // Also verify synthetic click on widget root is suppressed
    const clickEv = widgetEl.dispatch('click');
    assert.equal(clickEv.defaultPrevented, true);

    // Verify MonoCommands IDs match standard Monaco command IDs
    assert.equal(MonoCommands.CommentLine, 'editor.action.commentLine');
    assert.equal(MonoCommands.BlockComment, 'editor.action.blockComment');
    assert.equal(MonoCommands.MoveLinesUp, 'editor.action.moveLinesUpAction');
    assert.equal(MonoCommands.MoveLinesDown, 'editor.action.moveLinesDownAction');
    assert.equal(MonoCommands.CopyLinesUp, 'editor.action.copyLinesUpAction');
    assert.equal(MonoCommands.CopyLinesDown, 'editor.action.copyLinesDownAction');
    assert.equal(MonoCommands.DeleteLines, 'editor.action.deleteLines');
    assert.equal(MonoCommands.InsertLineAfter, 'editor.action.insertLineAfter');
    assert.equal(MonoCommands.InsertLineBefore, 'editor.action.insertLineBefore');

    disp.dispose();
    controller.dispose();
    input.dispose();
  });

  // Ensure SuggestWidget export directly works with drag-scroll cancellation
  await test('SuggestWidget ignores pointerup after >6px touch scroll drag', () => {
    const host = new StubElement('div');
    let accepted = 0;
    const w = new SuggestWidget(host as any, {
      onAccept: () => accepted++,
      onDismiss: () => {},
    });
    w.show(
      [{ label: 'alpha', kind: CompletionItemKind.Text }],
      { x: 10, y: 30, top: 10 },
      '',
    );
    const widgetEl = host.children[0]!;
    const rowEl = widgetEl.children[0]!.children[0]!;
    rowEl.dispatch('pointerdown', { pointerType: 'touch', clientX: 10, clientY: 10 });
    rowEl.dispatch('pointermove', { pointerType: 'touch', clientX: 10, clientY: 30 });
    rowEl.dispatch('pointerup', { pointerType: 'touch', clientX: 10, clientY: 30 });
    assert.equal(accepted, 0);
    assert.equal(w.isVisible(), true);
    w.dispose();
  });

  console.log(`\nPASS: ${passed} phase1-mono tests passed.`);
}

run().catch((err) => {
  console.error(err);
  process.exit(1);
});
