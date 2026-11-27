import assert from 'node:assert/strict';
import {
  KeybindingService,
  MonoCommands,
} from '../src/platform/keybindings/KeybindingService';
import { SuggestController } from '../src/contrib/suggest/SuggestController';
import { TextModel } from '../src/common/model/TextModel';
import { SelectionState } from '../src/common/core/SelectionState';

function makeKeyEvent(init: Partial<KeyboardEvent> & { key: string }): KeyboardEvent {
  let prevented = false;
  return {
    key: init.key,
    code: init.code ?? '',
    altKey: init.altKey ?? false,
    ctrlKey: init.ctrlKey ?? false,
    metaKey: init.metaKey ?? false,
    shiftKey: init.shiftKey ?? false,
    repeat: false,
    preventDefault() { prevented = true; },
    stopPropagation() {},
    get defaultPrevented() { return prevented; },
  } as unknown as KeyboardEvent;
}

// 1. KeybindingService resolves Alt+ArrowDown/Up even when Android/mobile keyboards send code === ''
{
  const kb = new KeybindingService();
  const fired: string[] = [];
  kb.add({ id: MonoCommands.MoveLinesDown, primary: 'alt+down', handler: () => fired.push(MonoCommands.MoveLinesDown) });
  kb.add({ id: MonoCommands.MoveLinesUp, primary: 'alt+up', handler: () => fired.push(MonoCommands.MoveLinesUp) });
  kb.add({ id: MonoCommands.CopyLinesDown, primary: 'shift+alt+down', handler: () => fired.push(MonoCommands.CopyLinesDown) });
  kb.add({ id: MonoCommands.DeleteLines, primary: 'ctrl+shift+k', handler: () => fired.push(MonoCommands.DeleteLines) });
  kb.add({ id: MonoCommands.Paste, primary: 'ctrl+v', handler: () => fired.push(MonoCommands.Paste) });

  const altDownEmptyCode = makeKeyEvent({ key: 'ArrowDown', code: '', altKey: true });
  const altUpEmptyCode = makeKeyEvent({ key: 'ArrowUp', code: '', altKey: true });
  const shiftAltDown = makeKeyEvent({ key: 'ArrowDown', code: '', altKey: true, shiftKey: true });
  const ctrlShiftK = makeKeyEvent({ key: 'K', code: '', ctrlKey: true, shiftKey: true });
  const ctrlV = makeKeyEvent({ key: 'v', code: '', ctrlKey: true });

  assert.equal(kb.chordOf(altDownEmptyCode), 'alt+down');
  assert.equal(kb.dispatch(altDownEmptyCode), true, 'Alt+ArrowDown dispatches with empty e.code');
  assert.equal(kb.dispatch(altUpEmptyCode), true, 'Alt+ArrowUp dispatches with empty e.code');
  assert.equal(kb.dispatch(shiftAltDown), true, 'Shift+Alt+ArrowDown dispatches with empty e.code');
  assert.equal(kb.dispatch(ctrlShiftK), true, 'Ctrl+Shift+K dispatches with empty e.code');
  assert.equal(kb.dispatch(ctrlV), true, 'Ctrl+V dispatches with empty e.code');
  assert.deepEqual(fired, [
    MonoCommands.MoveLinesDown,
    MonoCommands.MoveLinesUp,
    MonoCommands.CopyLinesDown,
    MonoCommands.DeleteLines,
    MonoCommands.Paste,
  ]);

  // Legacy 'Down' / 'Up' key names also normalize
  assert.equal(kb.chordOf(makeKeyEvent({ key: 'Down', code: '', altKey: true })), 'alt+down');
  assert.equal(kb.chordOf(makeKeyEvent({ key: 'Up', code: '', altKey: true })), 'alt+up');
}

// 2. SuggestController must NOT swallow Alt+ArrowDown/Up or Shift+Alt+ArrowDown when open
{
  const stubEl = () => {
    const children: unknown[] = [];
    const el = {
      style: {} as Record<string, string>,
      className: '',
      textContent: '',
      clientWidth: 600,
      clientHeight: 400,
      offsetWidth: 200,
      offsetHeight: 100,
      offsetTop: 0,
      scrollTop: 0,
      scrollWidth: 200,
      scrollHeight: 100,
      children,
      appendChild(c: unknown) { children.push(c); return c; },
      remove() {},
      setAttribute() {},
      addEventListener() {},
      querySelector() { return null; },
      querySelectorAll() { return []; },
      getBoundingClientRect() { return { left: 0, top: 0, width: 200, height: 100, right: 200, bottom: 100 }; },
    };
    return el;
  };
  const prevDoc = (globalThis as { document?: unknown }).document;
  (globalThis as { document: unknown }).document = {
    createElement: () => stubEl(),
    createTextNode: (t: string) => ({ textContent: t }),
    getElementById: () => ({ id: 'mono-suggest-style' }),
    querySelector: () => ({ id: 'mono-codicon' }),
    head: stubEl(),
  };

  try {
    const model = new TextModel('const foo = 1;\nconst bar = 2;', 'javascript');
    const sel = new SelectionState();
    sel.setCaret(1, 10);
    const fakeView = {
      isLineInView: () => true,
      screenPosOf: () => ({ x: 40, y: 20, h: 20 }),
    };
    const ctrl = new SuggestController(
      stubEl() as unknown as HTMLElement,
      model,
      sel,
      fakeView as never,
      () => {},
    );
    // Simulate open state via internal state for deterministic unit test
    (ctrl as unknown as { open: boolean }).open = true;
    const widget = (ctrl as unknown as { widget: { show: Function } }).widget;
    widget.show(
      [{ label: 'foobar', insertText: 'foobar' }, { label: 'foobaz', insertText: 'foobaz' }],
      { x: 40, y: 40, top: 20 },
      'foo',
    );

    // Unmodified ArrowDown IS handled by suggest
    const plainDown = makeKeyEvent({ key: 'ArrowDown', code: 'ArrowDown' });
    assert.equal(ctrl.handleKey(plainDown), true, 'plain ArrowDown navigates suggest list');
    assert.equal(plainDown.defaultPrevented, true);

    // Alt+ArrowDown MUST NOT be swallowed by suggest
    const altDown = makeKeyEvent({ key: 'ArrowDown', code: '', altKey: true });
    assert.equal(ctrl.handleKey(altDown), false, 'Alt+ArrowDown passes through suggest to move line');
    assert.equal(altDown.defaultPrevented, false);

    // Alt+ArrowUp MUST NOT be swallowed by suggest
    const altUp = makeKeyEvent({ key: 'ArrowUp', code: '', altKey: true });
    assert.equal(ctrl.handleKey(altUp), false, 'Alt+ArrowUp passes through suggest to move line');

    // Shift+Alt+ArrowDown MUST NOT be swallowed by suggest
    const shiftAltDown = makeKeyEvent({ key: 'ArrowDown', code: '', altKey: true, shiftKey: true });
    assert.equal(ctrl.handleKey(shiftAltDown), false, 'Shift+Alt+ArrowDown passes through suggest');

    // Ctrl+Enter MUST NOT be swallowed by suggest
    const ctrlEnter = makeKeyEvent({ key: 'Enter', code: 'Enter', ctrlKey: true });
    assert.equal(ctrl.handleKey(ctrlEnter), false, 'Ctrl+Enter passes through suggest');

    ctrl.dispose();
  } finally {
    if (prevDoc === undefined) delete (globalThis as { document?: unknown }).document;
    else (globalThis as { document?: unknown }).document = prevDoc;
  }
}

console.log('line-commands tests passed');
