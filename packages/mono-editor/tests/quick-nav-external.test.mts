import assert from 'node:assert/strict';
import { QuickNavController } from '../src/contrib/quickNav/QuickNavController';

class MiniStubNode {
  tagName: string;
  className = '';
  style: Record<string, any> = {
    setProperty(k: string, v: string) { (this as any)[k] = v; },
    removeProperty(k: string) { delete (this as any)[k]; },
  };
  dataset: Record<string, string> = {};
  children: MiniStubNode[] = [];
  parentNode: MiniStubNode | null = null;
  textContent = '';
  value = '';
  type = '';
  placeholder = '';
  autocomplete = '';
  autocapitalize = '';
  spellcheck = false;
  tabIndex = 0;
  private attrs = new Map<string, string>();
  private listeners = new Map<string, Array<(ev: any) => void>>();

  constructor(tag: string) {
    this.tagName = tag.toUpperCase();
  }
  appendChild(child: MiniStubNode): MiniStubNode {
    child.parentNode = this;
    this.children.push(child);
    return child;
  }
  append(...nodes: Array<MiniStubNode | string>): void {
    for (const node of nodes) {
      if (typeof node !== 'string') {
        this.appendChild(node);
      }
    }
  }
  replaceChildren(...nodes: Array<MiniStubNode | string>): void {
    this.children = [];
    this.append(...nodes);
  }
  contains(target: MiniStubNode | null): boolean {
    if (!target) return false;
    if (target === this) return true;
    return this.children.some((c) => c.contains(target));
  }
  removeChild(child: MiniStubNode): MiniStubNode {
    const idx = this.children.indexOf(child);
    if (idx >= 0) this.children.splice(idx, 1);
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
    const list = this.listeners.get(type) ?? [];
    list.push(fn);
    this.listeners.set(type, list);
  }
  removeEventListener(type: string, fn: (ev: any) => void): void {
    const list = this.listeners.get(type);
    if (!list) return;
    const idx = list.indexOf(fn);
    if (idx >= 0) list.splice(idx, 1);
  }
  focus(): void {}
  select(): void {}
  scrollIntoView(): void {}
  get firstChild(): MiniStubNode | null {
    return this.children[0] ?? null;
  }
  set innerHTML(_v: string) {
    this.children = [];
  }
}

(globalThis as any).document = {
  createElement: (tag: string) => new MiniStubNode(tag),
  body: new MiniStubNode('body'),
};

async function test(name: string, fn: () => void | Promise<void>) {
  try {
    await fn();
    console.log(`  PASS  ${name}`);
  } catch (err) {
    console.error(`  FAIL  ${name}`);
    throw err;
  }
}

console.log('Running QuickNav external delegation tests...');

function makeFakeHost(opts: {
  quickNav?: { gotoLine?: 'builtin' | 'external'; gotoSymbol?: 'builtin' | 'external' };
  onGoToLine: (ev: { lineNumber: number; column: number; lineCount: number }) => void;
  onGoToSymbol: () => void;
}) {
  const root = new MiniStubNode('div');
  const registeredCommands = new Map<string, () => unknown>();
  const keybindings: Array<{ id: string; primary: string; handler: () => unknown }> = [];
  return {
    root,
    registeredCommands,
    keybindings,
    host: {
      root,
      initialOptions: { quickNav: opts.quickNav },
      keybindings: {
        addMany: (items: Array<{ id: string; primary: string; handler: () => unknown }>) => {
          keybindings.push(...items);
        },
      },
      commands: {
        registerCommand: (id: string, fn: () => unknown) => {
          registeredCommands.set(id, fn);
        },
      },
      emitRequestGoToLine: opts.onGoToLine,
      emitRequestGoToSymbol: opts.onGoToSymbol,
      getPosition: () => ({ lineNumber: 12, column: 5 }),
      getModel: () => ({
        getLineCount: () => 50,
        getLineContent: () => '',
      }),
      setPosition: () => {},
      revealLine: () => {},
      focus: () => {},
      getDocumentSymbols: async () => [],
    } as any,
  };
}

await test('quickNav.gotoLine="external" emits onDidRequestGoToLine without opening built-in widget', async () => {
  const received: Array<{ lineNumber: number; column: number; lineCount: number }> = [];
  let gotoSymbolCalled = 0;

  const { root, registeredCommands, host } = makeFakeHost({
    quickNav: { gotoLine: 'external', gotoSymbol: 'external' },
    onGoToLine: (ev) => received.push(ev),
    onGoToSymbol: () => { gotoSymbolCalled++; },
  });

  const ctrl = new QuickNavController(host);
  // Trigger via registered command (same path as Ctrl+G and mobile GoTo button)
  registeredCommands.get('editor.action.gotoLine')?.();
  assert.equal(received.length, 1);
  assert.deepEqual(received[0], { lineNumber: 12, column: 5, lineCount: 50 });
  assert.equal(ctrl.isOpen(), false, 'Built-in Go to Line widget must stay closed in external mode');
  assert.equal(
    root.children.some((c) => c.style.display && c.style.display !== 'none'),
    false,
    'Built-in Go to Line overlay must remain hidden in external mode',
  );

  await ctrl.openGoToSymbol();
  assert.equal(gotoSymbolCalled, 1);
  assert.equal(ctrl.isOpen(), false, 'Built-in Go to Symbol widget must stay closed in external mode');

  ctrl.dispose();
});

await test('quickNav defaults to builtin and supports switching to external via onOptionsChange', () => {
  const received: Array<{ lineNumber: number; column: number; lineCount: number }> = [];
  const { host } = makeFakeHost({
    onGoToLine: (ev) => received.push(ev),
    onGoToSymbol: () => {},
  });

  const ctrl = new QuickNavController(host);
  ctrl.openGoToLine();
  assert.equal(received.length, 0);
  assert.equal(ctrl.isOpen(), true);

  ctrl.onOptionsChange({ quickNav: { gotoLine: 'external' } });
  ctrl.openGoToLine();
  assert.equal(received.length, 1);
  assert.equal(ctrl.isOpen(), false);
  ctrl.dispose();
});

console.log('All QuickNav external delegation tests passed!');
