import assert from 'node:assert/strict';
import test from 'node:test';
import { SelectionState } from '../src/common/core/SelectionState.ts';
import { hasUnmatchedClosingBracket } from '../src/common/editOperations/bracketBalance.ts';
import {
  tryOvertypeOrAutoCloseChar,
  type TypingPolicy,
} from '../src/common/editOperations/typeOperations.ts';
import { registerDefaultLanguageConfigurations } from '../src/common/languages/index.ts';
import { languageFeatures } from '../src/common/languages/languageFeaturesService.ts';
import { CompletionItemKind } from '../src/common/languages/providers/types.ts';
import { TextModel } from '../src/common/model/TextModel.ts';
import {
  colorAdvanceBefore,
  COLOR_SWATCH_ADVANCE,
  getColorSwatchMetrics,
} from '../src/browser/render/frameContext.ts';
import { applyCompletionToModel } from '../src/contrib/suggest/suggestApply.ts';
import {
  ensureDefaultCompletionProviders,
  isBuiltinCompletionProvider,
  isMemberAccessContext,
  isSnippetCompletionItem,
  isSuppressedSuggestOpenBracket,
  orderCompletionProviders,
} from '../src/contrib/suggest/suggestFilter.ts';
import { hasItemDocumentation } from '../src/contrib/suggest/widget/suggestRowDom.ts';

registerDefaultLanguageConfigurations();

const DEFAULT_POLICY: TypingPolicy = {
  autoClosingBrackets: 'languageDefined',
  autoClosingQuotes: 'languageDefined',
  autoSurround: 'languageDefined',
};

test('smart auto-close: suppresses {} when re-typing deleted { in function apple () { // hello }', () => {
  const model = new TextModel('function apple () \n  // hello\n}', 'javascript');
  const sel = new SelectionState();
  sel.setCaret(1, 19);

  assert.equal(hasUnmatchedClosingBracket(model, 1, 19, '{', '}'), true);
  const res = tryOvertypeOrAutoCloseChar(model, sel, '{', DEFAULT_POLICY);
  assert.equal(res, null, 'should not auto-close when unmatched } exists ahead');
});

test('smart auto-close: suppresses {} on single line with unmatched } ahead', () => {
  const model = new TextModel('function apple ()  return 1; }', 'typescript');
  const sel = new SelectionState();
  sel.setCaret(1, 19);

  assert.equal(tryOvertypeOrAutoCloseChar(model, sel, '{', DEFAULT_POLICY), null);
});

test('smart auto-close: still auto-closes {} inside a balanced outer block', () => {
  const model = new TextModel('function outer() {\n  function inner() \n}', 'typescript');
  const sel = new SelectionState();
  sel.setCaret(2, 20);

  assert.equal(hasUnmatchedClosingBracket(model, 2, 20, '{', '}'), false);
  const res = tryOvertypeOrAutoCloseChar(model, sel, '{', DEFAULT_POLICY);
  assert.equal(res, 'autoclose');
  assert.equal(model.getLineContent(2), '  function inner() {}');
});

test('smart auto-close: suppresses {} in nested block when inner { was deleted', () => {
  const model = new TextModel('function outer() {\n  function inner() \n    return 1;\n  }\n}', 'typescript');
  const sel = new SelectionState();
  sel.setCaret(2, 20);

  assert.equal(hasUnmatchedClosingBracket(model, 2, 20, '{', '}'), true);
  assert.equal(tryOvertypeOrAutoCloseChar(model, sel, '{', DEFAULT_POLICY), null);
});

test('smart auto-close: ignores } inside strings and comments', () => {
  const model = new TextModel('const s = "}";\n// }\nfunction f() ', 'typescript');
  const sel = new SelectionState();
  sel.setCaret(3, 14);

  assert.equal(hasUnmatchedClosingBracket(model, 3, 14, '{', '}'), false);
  assert.equal(tryOvertypeOrAutoCloseChar(model, sel, '{', DEFAULT_POLICY), 'autoclose');
  assert.equal(model.getLineContent(3), 'function f() {}');
});

test('smart auto-close: still auto-closes {} when extra } is before cursor, not after', () => {
  const model = new TextModel('}\nfunction f() ', 'typescript');
  const sel = new SelectionState();
  sel.setCaret(2, 14);

  assert.equal(hasUnmatchedClosingBracket(model, 2, 14, '{', '}'), false);
  assert.equal(tryOvertypeOrAutoCloseChar(model, sel, '{', DEFAULT_POLICY), 'autoclose');
});

test('smart auto-close: suppresses () and [] when unmatched ) or ] exists ahead', () => {
  const mParen = new TextModel('foo a, b)', 'typescript');
  const sParen = new SelectionState();
  sParen.setCaret(1, 4);
  assert.equal(tryOvertypeOrAutoCloseChar(mParen, sParen, '(', DEFAULT_POLICY), null);

  const mBracket = new TextModel('const x = 1, 2]', 'typescript');
  const sBracket = new SelectionState();
  sBracket.setCaret(1, 11);
  assert.equal(tryOvertypeOrAutoCloseChar(mBracket, sBracket, '[', DEFAULT_POLICY), null);
});

test('suggestFilter: detects member access after dot and suppresses built-in JS/TS keyword fallback', () => {
  assert.equal(isMemberAccessContext('document.', 10, '.'), true);
  assert.equal(isMemberAccessContext('document.qu', 12, undefined), true);
  assert.equal(isMemberAccessContext('obj?.prop', 10, undefined), true);
  assert.equal(isMemberAccessContext('...args', 8, undefined), false);
  assert.equal(isMemberAccessContext('document', 9, undefined), false);

  ensureDefaultCompletionProviders();
  const tsProviders = languageFeatures.getCompletionProviders('typescript');
  const builtin = tsProviders.find((p) => isBuiltinCompletionProvider(p));
  assert.ok(builtin, 'built-in TS fallback provider should be tagged');

  const dotModel = new TextModel('document.', 'typescript');
  const dotRes = builtin.provideCompletionItems(
    {
      getValue: () => dotModel.getValue(),
      getLineContent: (n) => dotModel.getLineContent(n),
      getLineCount: () => dotModel.getLineCount(),
      getOffsetAt: (l, c) => dotModel.getOffsetAt(l, c),
      getPositionAt: (o) => dotModel.getPositionAt(o),
      getLanguageId: () => 'typescript',
    },
    { lineNumber: 1, column: 10 },
    { triggerKind: 1, triggerCharacter: '.' },
    { isCancellationRequested: false },
  );
  const dotItems = Array.isArray(dotRes) ? dotRes : (dotRes as { suggestions: unknown[] })?.suggestions ?? [];
  assert.equal(dotItems.length, 0, 'built-in JS/TS keyword provider must return [] after dot');

  // External providers must be ordered before built-in fallback providers
  const fakeExternal = { provideCompletionItems: () => ({ suggestions: [] }) };
  const ordered = orderCompletionProviders([builtin, fakeExternal]);
  assert.equal(ordered[0], fakeExternal);
  assert.equal(ordered[1], builtin);
});

test('suggestApply: inserts completion items with Monaco CompletionItemRanges ({ insert, replace }) and flat IRange', () => {
  // Monaco-style { insert, replace } range (used by snippetRegistry.ts)
  const model1 = new TextModel('doc', 'javascript');
  const sel1 = new SelectionState();
  sel1.setCaret(1, 4);
  applyCompletionToModel(
    model1,
    sel1,
    null,
    {
      label: 'document',
      kind: CompletionItemKind.Variable,
      insertText: 'document',
      range: {
        insert: { startLineNumber: 1, startColumn: 1, endLineNumber: 1, endColumn: 4 },
        replace: { startLineNumber: 1, startColumn: 1, endLineNumber: 1, endColumn: 4 },
      } as never,
    },
    { prefix: 'doc', insertMode: 'insert' },
  );
  assert.equal(model1.getValue(), 'document');
  assert.equal(sel1.primary.activeCol, 9);

  // Flat IRange
  const model2 = new TextModel('con', 'javascript');
  const sel2 = new SelectionState();
  sel2.setCaret(1, 4);
  applyCompletionToModel(
    model2,
    sel2,
    null,
    {
      label: 'console',
      kind: CompletionItemKind.Variable,
      insertText: 'console',
      range: { startLineNumber: 1, startColumn: 1, endLineNumber: 1, endColumn: 4 },
    },
    { prefix: 'con', insertMode: 'insert' },
  );
  assert.equal(model2.getValue(), 'console');
  assert.equal(sel2.primary.activeCol, 8);
});

test('suggestFilter: suppresses completion trigger on (, {, [ and identifies snippet items', () => {
  for (const ch of ['(', '{', '[', '()', '{}', '[]']) {
    assert.equal(isSuppressedSuggestOpenBracket(ch), true, `should suppress "${ch}"`);
  }
  for (const ch of ['a', '.', ')', '}', ']', '']) {
    assert.equal(isSuppressedSuggestOpenBracket(ch), false, `should not suppress "${ch}"`);
  }

  assert.equal(
    isSnippetCompletionItem({ label: 'log', kind: CompletionItemKind.Snippet, insertText: 'console.log($1)' }),
    true,
  );
  assert.equal(
    isSnippetCompletionItem({ label: 'document', kind: CompletionItemKind.Variable, insertText: 'document' }),
    false,
  );
});

test('suggestRowDom: hides documentation for Keyword and Text completion items', () => {
  assert.equal(
    hasItemDocumentation({ label: 'const', kind: CompletionItemKind.Keyword, detail: 'keyword', documentation: 'decl' }),
    false,
  );
  assert.equal(
    hasItemDocumentation({ label: 'hello', kind: CompletionItemKind.Text, detail: 'word', documentation: 'text' }),
    false,
  );
  assert.equal(
    hasItemDocumentation({ label: 'document', kind: CompletionItemKind.Variable, documentation: 'DOM' }),
    true,
  );
});

test('color swatch metrics scale proportionally with editor font zoom', () => {
  const base = getColorSwatchMetrics(14);
  assert.equal(base.size, 11);
  assert.equal(base.gap, 5);
  assert.equal(base.advance, COLOR_SWATCH_ADVANCE);

  const zoomedIn = getColorSwatchMetrics(28);
  assert.ok(zoomedIn.size > base.size, 'swatch size grows on zoom in');
  assert.equal(zoomedIn.size, 22);
  assert.equal(zoomedIn.advance, zoomedIn.size + zoomedIn.gap);

  const zoomedOut = getColorSwatchMetrics(10);
  assert.ok(zoomedOut.size < base.size, 'swatch size shrinks on zoom out');
  assert.ok(zoomedOut.size >= 8, 'swatch size keeps readable floor');

  const colors = [{ startColumn: 5, endColumn: 12, color: { r: 1, g: 0, b: 0, a: 1 }, raw: '#ff0000' }];
  assert.equal(colorAdvanceBefore(colors as never, 5, 28), zoomedIn.advance);
});
