import assert from 'node:assert/strict';
import { registerDefaultLanguages } from '../src/common/languages/defaults/registerDefaults';
import { SymbolKind } from '../src/common/languages/providers/types';
import { TextModel } from '../src/common/model/TextModel';
import { DocumentStructureService } from '../src/common/structure/StructureBuilder';
import { BreadcrumbsModel } from '../src/contrib/breadcrumbs/BreadcrumbsModel';

registerDefaultLanguages();

async function test(name: string, fn: () => void | Promise<void>) {
  try {
    await fn();
    console.log(`  PASS  ${name}`);
  } catch (err) {
    console.error(`  FAIL  ${name}`);
    throw err;
  }
}

console.log('Running Breadcrumbs model tests...');

await test('Combines file path + symbol trail, supports filePath/symbolPath modes and Copy Breadcrumbs Path', async () => {
  const code = [
    'export class Cart {',
    '  addItem(id: string) {',
    '    const qty = 1;',
    '    return qty;',
    '  }',
    '  clear() {',
    '    return true;',
    '  }',
    '}',
  ].join('\n');
  const model = new TextModel(code, 'typescript');
  const structure = new DocumentStructureService(model);
  let pos = { lineNumber: 3, column: 6 };
  const contexts = new Map<string, boolean | string | number>();
  let revealed: string | null = null;
  let editorFocused = 0;

  const bc = new BreadcrumbsModel({
    getUri: () => 'file:///src/features/cart/Cart.ts',
    getPosition: () => pos,
    getOutline: () => structure.getOutline(),
    setContext: (k, v) => contexts.set(k, v),
    revealSymbol: (item) => { revealed = item.label; },
    focusEditor: () => { editorFocused++; },
  });

  // Default: full path + full symbol trail
  assert.deepEqual(
    bc.getItems().map((i) => i.label),
    ['src', 'features', 'cart', 'Cart.ts', 'Cart', 'addItem', 'qty'],
  );
  assert.equal(contexts.get('breadcrumbsPossible'), true);
  assert.equal(contexts.get('breadcrumbsVisible'), true);
  assert.equal(contexts.get('breadcrumbsActive'), false);
  assert.equal(bc.getCopyPath(), 'src/features/cart/Cart.ts › Cart › addItem › qty');

  // filePath: 'last', symbolPath: 'last'
  bc.updateOptions({ filePath: 'last', symbolPath: 'last' });
  assert.deepEqual(bc.getItems().map((i) => i.label), ['Cart.ts', 'qty']);

  // showConstants: false filters out const `qty`
  bc.updateOptions({ filePath: 'on', symbolPath: 'on', showConstants: false });
  assert.deepEqual(
    bc.getItems().map((i) => i.label),
    ['src', 'features', 'cart', 'Cart.ts', 'Cart', 'addItem'],
  );

  // Siblings sorted by name vs position
  bc.updateOptions({ symbolSortOrder: 'name' });
  const addItemBc = bc.getItems().find((i) => i.label === 'addItem')!;
  const siblings = await bc.getSiblings(addItemBc);
  assert.deepEqual(siblings.map((s) => s.label), ['addItem', 'clear']);

  // Focus, navigate, select, reveal, selectEditor
  bc.focus();
  assert.equal(contexts.get('breadcrumbsActive'), true);
  assert.equal(bc.getFocusedIndex(), bc.getItems().length - 1);
  assert.equal(bc.isPickerOpen(), false);

  bc.focusPrevious(true);
  assert.equal(bc.getFocusedIndex(), bc.getItems().length - 2);
  assert.equal(bc.isPickerOpen(), true);

  bc.revealFocused();
  assert.equal(revealed, 'Cart');
  assert.equal(editorFocused, 1);
  assert.equal(bc.getFocusedIndex(), -1);
  assert.equal(contexts.get('breadcrumbsActive'), false);

  // Toggle off hides breadcrumbs and clears active state
  bc.toggle();
  assert.equal(bc.getOptions().enabled, false);
  assert.equal(contexts.get('breadcrumbsVisible'), false);

  // Move cursor to clear() and toggle back on
  pos = { lineNumber: 7, column: 5 };
  bc.toggle();
  bc.refreshSymbols();
  assert.equal(bc.getItems()[bc.getItems().length - 1]?.label, 'clear');

  // External path provider overrides file segments & provides folder siblings
  bc.setPathProvider({
    getPath: () => [
      { id: 'p1', kind: 'folder', label: 'workspace', path: '/workspace', isDirectory: true },
      { id: 'p2', kind: 'file', label: 'Cart.ts', path: '/workspace/Cart.ts', isDirectory: false },
    ],
    getSiblings: () => [
      { id: 'p2', kind: 'file', label: 'Cart.ts', path: '/workspace/Cart.ts', isDirectory: false },
      { id: 'p3', kind: 'file', label: 'Checkout.ts', path: '/workspace/Checkout.ts', isDirectory: false },
    ],
  });
  const fileSiblings = await bc.getSiblings(bc.getItems()[1]!);
  assert.deepEqual(fileSiblings.map((s) => s.label), ['Cart.ts', 'Checkout.ts']);

  // Kind filter covers SymbolKind.Method
  bc.updateOptions({ showMethods: false });
  assert.equal(
    bc.getOutlineForPicker().some((s) => s.children?.some((c) => c.kind === SymbolKind.Method)),
    false,
  );
});

console.log('All Breadcrumbs tests passed!');
