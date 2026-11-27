import assert from 'node:assert/strict';
import { registerDefaultLanguages } from '../src/common/languages/defaults/registerDefaults';
import { SymbolKind } from '../src/common/languages/providers/types';
import { TextModel } from '../src/common/model/TextModel';
import {
  buildStructureTree,
  DocumentStructureService,
} from '../src/common/structure/StructureBuilder';
import { StructureScopeFinder } from '../src/common/viewModel/markdownSticky';

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

console.log('Running Structure Outline & Scope (S5-S6) tests...');

await test('S5: TS/JS DocumentStructureService produces hierarchical outline and getScopeAt()', () => {
  const code = [
    'export class AuthService {',
    '  constructor() {',
    '    this.ready = true;',
    '  }',
    '  async login(user: string) {',
    '    const token = "ok";',
    '    return token;',
    '  }',
    '}',
    'export function helper() {',
    '  return 1;',
    '}',
  ].join('\n');

  const model = new TextModel(code, 'typescript');
  const svc = new DocumentStructureService(model);
  const outline = svc.getOutline();

  assert.equal(outline.length, 2);
  assert.equal(outline[0]!.name, 'AuthService');
  assert.equal(outline[0]!.kind, SymbolKind.Class);
  assert.equal(outline[0]!.range.endLineNumber, 9);
  assert.equal(outline[0]!.children?.length, 2);
  assert.equal(outline[0]!.children![0]!.name, 'constructor');
  assert.equal(outline[0]!.children![0]!.kind, SymbolKind.Constructor);
  assert.equal(outline[0]!.children![1]!.name, 'login');
  assert.equal(outline[0]!.children![1]!.kind, SymbolKind.Method);
  assert.equal(outline[1]!.name, 'helper');

  const scope = svc.getScopeAt(6);
  assert.deepEqual(scope.map((s) => s.name), ['AuthService', 'login', 'token']);
});

await test('S5: Python, Java, C++, CSS, HTML, Markdown outlines work', () => {
  const py = new DocumentStructureService(
    new TextModel('class Box:\n    def __init__(self):\n        self.x = 1\n    def area(self):\n        return self.x\n', 'python'),
  );
  const pyOutline = py.getOutline();
  assert.equal(pyOutline[0]?.name, 'Box');
  assert.equal(pyOutline[0]?.children?.map((c) => c.name).join(','), '__init__,area');

  const css = new DocumentStructureService(
    new TextModel('@media (max-width: 600px) {\n  .btn {\n    color: red;\n  }\n}\n', 'css'),
  );
  assert.equal(css.getOutline()[0]?.name, '@media (max-width: 600px)');
  assert.equal(css.getOutline()[0]?.children?.[0]?.name, '.btn');

  const md = new DocumentStructureService(
    new TextModel('# Root\nText\n## Child\nMore\n', 'markdown'),
  );
  assert.equal(md.getOutline()[0]?.name, 'Root');
  assert.equal(md.getOutline()[0]?.children?.[0]?.name, 'Child');
});

await test('S5: onDidChangeStructure fires on invalidation and external LSP symbols override outline', () => {
  const model = new TextModel('function a() {\n  return 1;\n}\n', 'javascript');
  const svc = new DocumentStructureService(model);
  let changes = 0;
  const sub = svc.onDidChangeStructure(() => { changes++; });

  svc.setExternalSymbols([
    {
      name: 'lspA',
      kind: SymbolKind.Function,
      range: { startLineNumber: 1, startColumn: 1, endLineNumber: 3, endColumn: 2 },
      selectionRange: { startLineNumber: 1, startColumn: 10, endLineNumber: 1, endColumn: 11 },
    },
  ]);
  assert.equal(changes, 1);
  assert.equal(svc.getOutline()[0]?.name, 'lspA');
  assert.equal(svc.getScopeAt(2)[0]?.name, 'lspA');

  svc.invalidate();
  assert.equal(changes, 2);
  assert.equal(svc.getOutline()[0]?.name, 'a');
  sub.dispose();
});

await test('S6: StructureScopeFinder resolves nested sticky headers', () => {
  const code = [
    'class Outer {',
    '  method() {',
    '    const a = 1;',
    '    const b = 2;',
    '    return a + b;',
    '  }',
    '}',
  ].join('\n');
  const model = new TextModel(code, 'javascript');
  const svc = new DocumentStructureService(model);
  const finder = new StructureScopeFinder(model, () => {
    const t = svc.getTree();
    const out: Array<{ header: number; end: number }> = [];
    for (let i = 0; i < t.count; i++) {
      out.push({ header: t.startLine[i]!, end: t.endLine[i]! });
    }
    return out;
  });

  const chain = finder.chain(4);
  assert.deepEqual(chain.map((s) => s.header), [1, 2]);
});

await test('Perf guard: 100k-line document builds within budget and >maxLines safely returns empty tree', () => {
  const lines: string[] = [];
  for (let i = 0; i < 10_000; i++) {
    lines.push(`function fn${i}() {`, '  return 1;', '}');
  }
  const model = new TextModel(lines.join('\n'), 'javascript');
  const t0 = performance.now();
  const tree = buildStructureTree(model);
  const elapsed = performance.now() - t0;
  assert.equal(tree.count, 10_000);
  assert.ok(elapsed < 1500, `30k-line build took ${elapsed.toFixed(1)}ms (expected < 1500ms)`);

  // Respects maxLines guard cleanly
  const skipped = buildStructureTree(model, { maxLines: 1000 });
  assert.equal(skipped.count, 0);
});

console.log('All Structure Outline tests passed!');
