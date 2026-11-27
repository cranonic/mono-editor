import assert from 'node:assert/strict';
import { registerDefaultLanguages } from '../src/common/languages/defaults/registerDefaults';
import { languageFeatures } from '../src/common/languages/languageFeaturesService';
import { TextModel } from '../src/common/model/TextModel';
import {
  buildStructureTree,
  structureTreeToFoldingRanges,
} from '../src/common/structure/StructureBuilder';
import { FoldingModel } from '../src/common/viewModel/FoldingModel';

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

console.log('Running Structure Folding (S0-S4) tests...');

await test('S1: JS/TS brackets ignore strings, comments, template literals, and regexes; folds #region, imports, block comments', () => {
  const code = [
    'import a from "a";',
    'import b from "b";',
    'import c from "c";',
    '/* multi',
    ' * line comment',
    ' */',
    '//#region demo',
    'function parse(str) {',
    '  const fake1 = "{ not a block";',
    '  const fake2 = /\\{regex\\}/;',
    '  const tpl = `hello',
    '    world`;',
    '  if (str) {',
    '    return 1;',
    '  }',
    '}',
    '//#endregion',
  ].join('\n');

  const model = new TextModel(code, 'javascript');
  const tree = buildStructureTree(model);
  const ranges = structureTreeToFoldingRanges(tree);
  const byStart = new Map(ranges.map((r) => [r.start, r]));

  assert.deepEqual(byStart.get(1), { start: 1, end: 3, kind: 'imports' });
  assert.deepEqual(byStart.get(4), { start: 4, end: 6, kind: 'comment' });
  assert.deepEqual(byStart.get(7), { start: 7, end: 17, kind: 'region' });
  assert.equal(byStart.get(8)?.end, 15, 'function folds up to line before closing brace');
  assert.equal(byStart.get(13)?.end, 14, 'inner if folds cleanly');
  assert.equal(byStart.has(9), false, 'brace in string literal must not create fold');
  assert.equal(byStart.has(10), false, 'brace in regex literal must not create fold');
});

await test('S2: Python offside handles classes, defs, multi-line parens, docstrings, and blank-line trimming', () => {
  const code = [
    'class Service:',
    '    """Multi-line',
    '    docstring',
    '    """',
    '    def run(',
    '        self,',
    '        x: int,',
    '    ):',
    '        if x > 0:',
    '            return x',
    '',
    '        return 0',
    '',
    'def top():',
    '    pass',
  ].join('\n');

  const model = new TextModel(code, 'python');
  const ranges = structureTreeToFoldingRanges(buildStructureTree(model));
  const byStart = new Map(ranges.map((r) => [r.start, r]));

  assert.equal(byStart.get(1)?.end, 12, 'class ends at last indented body line, trimming trailing blank');
  assert.equal(byStart.get(2)?.kind, 'comment', 'triple-quoted docstring folded as comment');
  assert.equal(byStart.get(5)?.end, 12, 'def with multi-line parens folds entire body');
  assert.equal(byStart.get(9)?.end, 10, 'nested if folds its body');
  assert.equal(byStart.get(14)?.end, 15, 'top-level def folds');
});

await test('S2: YAML offside folds nested mappings', () => {
  const code = [
    'services:',
    '  web:',
    '    image: nginx',
    '    ports:',
    '      - "80:80"',
    '  db:',
    '    image: postgres',
  ].join('\n');

  const model = new TextModel(code, 'yaml');
  const ranges = structureTreeToFoldingRanges(buildStructureTree(model));
  const byStart = new Map(ranges.map((r) => [r.start, r]));

  assert.equal(byStart.get(1)?.end, 7);
  assert.equal(byStart.get(2)?.end, 5);
  assert.equal(byStart.get(4)?.end, 5);
  assert.equal(byStart.get(6)?.end, 7);
});

await test('S3: HTML tags handle void elements, self-closing, optional-end tags, comments, and embedded script/style', () => {
  const code = [
    '<html>',
    '  <body>',
    '    <img src="x.png">',
    '    <ul>',
    '      <li>',
    '        First item',
    '      <li>',
    '        Second item',
    '    </ul>',
    '    <style>',
    '      .card {',
    '        color: red;',
    '      }',
    '    </style>',
    '    <script>',
    '      function boot() {',
    '        return 42;',
    '      }',
    '    </script>',
    '  </body>',
    '</html>',
  ].join('\n');

  const model = new TextModel(code, 'html');
  const ranges = structureTreeToFoldingRanges(buildStructureTree(model));
  const byStart = new Map(ranges.map((r) => [r.start, r]));

  assert.equal(byStart.has(3), false, 'void <img> does not swallow following elements');
  assert.equal(byStart.get(4)?.end, 8, '<ul> folds until line before </ul>');
  assert.equal(byStart.get(5)?.end, 6, 'optional-end <li> auto-closes before sibling <li>');
  assert.equal(byStart.get(7)?.end, 8, 'second optional-end <li> closes before </ul>');
  assert.equal(byStart.get(10)?.end, 13, '<style> folds');
  assert.equal(byStart.get(11)?.end, 12, 'embedded CSS rule inside <style> folds');
  assert.equal(byStart.get(15)?.end, 18, '<script> folds');
  assert.equal(byStart.get(16)?.end, 17, 'embedded JS function inside <script> folds');
  assert.equal(byStart.get(1)?.end, 20, '<html> folds');
});

await test('S4: Markdown headings + fenced code blocks and Shell/SQL keyword pairs', () => {
  const md = [
    '# Intro',
    'Hello',
    '## Details',
    '```ts',
    'const x = 1;',
    '```',
    '# Next',
    'End',
  ].join('\n');
  const mdRanges = structureTreeToFoldingRanges(buildStructureTree(new TextModel(md, 'markdown')));
  const mdByStart = new Map(mdRanges.map((r) => [r.start, r]));
  assert.equal(mdByStart.get(1)?.end, 6);
  assert.equal(mdByStart.get(3)?.end, 6);
  assert.equal(mdByStart.get(4)?.end, 6);
  assert.equal(mdByStart.get(7)?.end, 8);

  const sh = [
    'if [ -f foo ]; then',
    '  echo hi',
    'fi',
    'for i in 1 2; do',
    '  echo $i',
    'done',
  ].join('\n');
  const shRanges = structureTreeToFoldingRanges(buildStructureTree(new TextModel(sh, 'shell')));
  const shByStart = new Map(shRanges.map((r) => [r.start, r]));
  assert.equal(shByStart.get(1)?.end, 2);
  assert.equal(shByStart.get(4)?.end, 5);
});

await test('S0/LSP precedence: non-empty provider replaces built-in; empty/error/stale keeps built-in; strategy option works', async () => {
  const code = [
    'function a() {',
    '  const x = 1;',
    '  return x;',
    '}',
  ].join('\n');
  const model = new TextModel(code, 'javascript');
  const folding = new FoldingModel(model);
  assert.equal(folding.getRangeAt(1)?.end, 3);

  // 1. Non-empty LSP provider replaces built-in ranges
  let reg = languageFeatures.registerFoldingRangeProvider('javascript', {
    provideFoldingRanges: async () => [{ start: 1, end: 4, kind: { value: 'region' } as unknown as string }],
  });
  try {
    const changed = await folding.update();
    assert.equal(changed, true);
    assert.deepEqual(folding.getRangeAt(1), { start: 1, end: 4, kind: 'region' });
  } finally {
    reg.dispose();
  }

  // Reset to built-in
  folding.updateSync();
  assert.equal(folding.getRangeAt(1)?.end, 3);

  // 2. Empty provider keeps built-in set
  reg = languageFeatures.registerFoldingRangeProvider('javascript', {
    provideFoldingRanges: async () => [],
  });
  try {
    await folding.update();
    assert.equal(folding.getRangeAt(1)?.end, 3, 'empty provider keeps built-in range');
  } finally {
    reg.dispose();
  }

  // 3. Throwing provider keeps built-in set
  reg = languageFeatures.registerFoldingRangeProvider('javascript', {
    provideFoldingRanges: async () => { throw new Error('LSP failed'); },
  });
  try {
    await folding.update();
    assert.equal(folding.getRangeAt(1)?.end, 3, 'error provider keeps built-in range');
  } finally {
    reg.dispose();
  }

  // 4. Stale provider (model edited before provider resolves) is ignored
  reg = languageFeatures.registerFoldingRangeProvider('javascript', {
    provideFoldingRanges: async () => {
      model.setValue('function b() {\n  return 2;\n}\n');
      return [{ start: 1, end: 4 }];
    },
  });
  try {
    const changed = await folding.update();
    assert.equal(changed, false, 'stale provider result must be discarded');
  } finally {
    reg.dispose();
  }

  // 5. strategy === 'syntax' skips LSP provider
  folding.setStrategy('syntax');
  reg = languageFeatures.registerFoldingRangeProvider('javascript', {
    provideFoldingRanges: async () => [{ start: 1, end: 3, kind: 'region' }],
  });
  try {
    await folding.update();
    assert.equal(folding.getRangeAt(1)?.kind, undefined, 'syntax strategy ignores external provider');
  } finally {
    reg.dispose();
  }
});

console.log('All Structure Folding tests passed!');
