import assert from 'node:assert/strict';
import {
  DEFAULT_BREADCRUMBS_OPTIONS,
  SymbolKind,
  type DocumentSymbol,
  type IBreadcrumbItem,
} from '../../mono-editor/src/index';
import {
  buildPathTreeRows,
  buildSymbolTreeRows,
  computeStickyAncestorIndices,
} from '../src/features/editor/components/BreadCrumb/treeHelpers';

function test(name: string, fn: () => void) {
  try {
    fn();
    console.log(`  PASS  ${name}`);
  } catch (err) {
    console.error(`  FAIL  ${name}`);
    throw err;
  }
}

const mkRange = (s: number, e: number) => ({
  startLineNumber: s,
  startColumn: 1,
  endLineNumber: e,
  endColumn: 1,
});

console.log('Running Breadcrumbs picker tree, sticky rows & options tests...');

test('DEFAULT_BREADCRUMBS_OPTIONS hides symbol details and expands folders inline by default', () => {
  assert.equal(DEFAULT_BREADCRUMBS_OPTIONS.showSymbolDetails, false);
  assert.equal(DEFAULT_BREADCRUMBS_OPTIONS.folderClickBehavior, 'expand');
});

test('buildSymbolTreeRows builds nested tree with ancestorIndices and respects collapsedIds', () => {
  const outline: DocumentSymbol[] = [
    { name: 'MAX', detail: 'const', kind: SymbolKind.Constant, range: mkRange(1, 1), selectionRange: mkRange(1, 1) },
    { name: 'count', detail: 'let', kind: SymbolKind.Variable, range: mkRange(2, 2), selectionRange: mkRange(2, 2) },
    {
      name: 'Editor',
      detail: 'class',
      kind: SymbolKind.Class,
      range: mkRange(4, 30),
      selectionRange: mkRange(4, 4),
      children: [
        { name: 'options', detail: 'field', kind: SymbolKind.Field, range: mkRange(5, 5), selectionRange: mkRange(5, 5) },
        {
          name: 'Inner',
          detail: 'class',
          kind: SymbolKind.Class,
          range: mkRange(7, 25),
          selectionRange: mkRange(7, 7),
          children: [
            { name: 'method0', detail: 'method', kind: SymbolKind.Method, range: mkRange(8, 12), selectionRange: mkRange(8, 8) },
            { name: 'method1', detail: 'method', kind: SymbolKind.Method, range: mkRange(14, 18), selectionRange: mkRange(14, 14) },
          ],
        },
      ],
    },
  ];

  const activeItem: IBreadcrumbItem = {
    id: 'sym:method0:8:0',
    kind: 'symbol',
    label: 'method0',
    range: mkRange(8, 12),
  };

  const rows = buildSymbolTreeRows(outline, activeItem, new Set());
  assert.deepEqual(
    rows.map((r) => [r.label, r.depth, r.ancestorIndices]),
    [
      ['MAX', 0, []],
      ['count', 0, []],
      ['Editor', 0, []],
      ['options', 1, [2]],
      ['Inner', 1, [2]],
      ['method0', 2, [2, 4]],
      ['method1', 2, [2, 4]],
    ],
  );
  assert.equal(rows[5]!.isCurrent, true);
  assert.equal(rows[0]!.isCurrent, false);

  // Collapse Inner -> hides method0 and method1
  const collapsed = new Set([rows[4]!.id]);
  const collapsedRows = buildSymbolTreeRows(outline, activeItem, collapsed);
  assert.deepEqual(
    collapsedRows.map((r) => r.label),
    ['MAX', 'count', 'Editor', 'options', 'Inner'],
  );
});

test('computeStickyAncestorIndices pins scrolled-past parent rows (Editor -> Inner) cleanly', () => {
  const outline: DocumentSymbol[] = [
    { name: 'MAX', kind: SymbolKind.Constant, range: mkRange(1, 1), selectionRange: mkRange(1, 1) },
    { name: 'count', kind: SymbolKind.Variable, range: mkRange(2, 2), selectionRange: mkRange(2, 2) },
    {
      name: 'Editor',
      kind: SymbolKind.Class,
      range: mkRange(4, 50),
      selectionRange: mkRange(4, 4),
      children: [
        { name: 'options', kind: SymbolKind.Field, range: mkRange(5, 5), selectionRange: mkRange(5, 5) },
        {
          name: 'Inner',
          kind: SymbolKind.Class,
          range: mkRange(7, 45),
          selectionRange: mkRange(7, 7),
          children: Array.from({ length: 10 }, (_, i) => ({
            name: `method${i}`,
            kind: SymbolKind.Method,
            range: mkRange(8 + i * 2, 9 + i * 2),
            selectionRange: mkRange(8 + i * 2, 8 + i * 2),
          })),
        },
      ],
    },
  ];
  const rows = buildSymbolTreeRows(outline, { id: '', kind: 'symbol', label: '' }, new Set());

  // At scrollTop = 0, no sticky rows
  assert.deepEqual(computeStickyAncestorIndices(rows, 0, 24, 4), []);

  // Scrolled deep into method3 (index 8 -> y = 192): both Editor (idx 2) and Inner (idx 4) should be sticky
  const sticky = computeStickyAncestorIndices(rows, 150, 24, 4);
  assert.deepEqual(sticky, [2, 4]);
  assert.deepEqual(sticky.map((i) => rows[i]!.label), ['Editor', 'Inner']);
});

test('buildPathTreeRows expands folders inline by default and stays flat in enter mode', () => {
  const root: IBreadcrumbItem[] = [
    { id: 'path:/src', kind: 'folder', label: 'src', path: '/src', isDirectory: true },
    { id: 'path:/index.ts', kind: 'file', label: 'index.ts', path: '/index.ts', isDirectory: false },
  ];
  const cache = new Map<string, readonly IBreadcrumbItem[]>([
    [
      '/src',
      [
        { id: 'path:/src/app.ts', kind: 'file', label: 'app.ts', path: '/src/app.ts', isDirectory: false },
      ],
    ],
  ]);
  const expanded = new Set(['/src']);

  // Expand mode (default)
  const treeRows = buildPathTreeRows(root, { path: '/index.ts' }, expanded, cache, new Set(), true);
  assert.deepEqual(
    treeRows.map((r) => [r.label, r.depth, r.ancestorIndices]),
    [
      ['src', 0, []],
      ['app.ts', 1, [0]],
      ['index.ts', 0, []],
    ],
  );

  // Enter mode (allowInlineExpand = false)
  const enterRows = buildPathTreeRows(root, { path: '/index.ts' }, expanded, cache, new Set(), false);
  assert.deepEqual(
    enterRows.map((r) => [r.label, r.depth]),
    [
      ['src', 0],
      ['index.ts', 0],
    ],
  );
});

console.log('All Breadcrumbs picker tree tests passed!');
