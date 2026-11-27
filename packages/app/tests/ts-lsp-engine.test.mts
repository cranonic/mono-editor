import { describe, it, expect } from 'bun:test';
import ts from 'typescript';
import { TsLspEngine } from '../src/features/lsp/workers/tsLspEngine';
import { DOM_MINIMAL_DTS, MINIMAL_ES_FALLBACK_DTS } from '../src/features/lsp/workers/libDts';

function createHarness() {
  const notifications: Array<{ method: string; params: any }> = [];
  const responses = new Map<number, any>();
  let nextId = 1;

  const engine = new TsLspEngine({
    ts,
    libs: {
      'lib.es.d.ts': MINIMAL_ES_FALLBACK_DTS,
      'lib.dom.d.ts': DOM_MINIMAL_DTS,
    },
    send: (msg: any) => {
      if (msg.id != null) {
        responses.set(msg.id, msg);
      } else if (msg.method) {
        notifications.push({ method: msg.method, params: msg.params });
      }
    },
  });

  function request(method: string, params?: any): any {
    const id = nextId++;
    engine.handleMessage({ jsonrpc: '2.0', id, method, params });
    const res = responses.get(id);
    if (!res) throw new Error(`No response for ${method} (id=${id})`);
    if (res.error) throw new Error(`LSP error for ${method}: ${res.error.message}`);
    return res.result;
  }

  function notify(method: string, params?: any): void {
    engine.handleMessage({ jsonrpc: '2.0', method, params });
  }

  return { engine, request, notify, notifications };
}

describe('TsLspEngine — Full TypeScript LanguageService JSON-RPC 2.0', () => {
  it('completes initialize handshake with full LSP capabilities', () => {
    const { request, notify } = createHarness();
    const init = request('initialize', {
      rootUri: 'file:///workspace',
      initializationOptions: {
        preferences: {
          includeInlayParameterNameHints: 'all',
          includeInlayVariableTypeHints: true,
          includeInlayFunctionLikeReturnTypeHints: true,
        },
      },
    });
    notify('initialized', {});

    const caps = init.capabilities;
    expect(caps.completionProvider.resolveProvider).toBe(true);
    expect(caps.hoverProvider).toBe(true);
    expect(caps.signatureHelpProvider).toBeTruthy();
    expect(caps.definitionProvider).toBe(true);
    expect(caps.typeDefinitionProvider).toBe(true);
    expect(caps.implementationProvider).toBe(true);
    expect(caps.referencesProvider).toBe(true);
    expect(caps.renameProvider.prepareProvider).toBe(true);
    expect(caps.documentSymbolProvider).toBe(true);
    expect(caps.documentHighlightProvider).toBe(true);
    expect(caps.codeActionProvider).toBeTruthy();
    expect(caps.foldingRangeProvider).toBe(true);
    expect(caps.selectionRangeProvider).toBe(true);
    expect(caps.documentFormattingProvider).toBe(true);
    expect(caps.documentRangeFormattingProvider).toBe(true);
    expect(caps.documentOnTypeFormattingProvider).toBeTruthy();
    expect(caps.inlayHintProvider).toBe(true);
    expect(caps.semanticTokensProvider.legend.tokenTypes.length).toBeGreaterThan(5);
  });

  it('supports multi-file workspace sync, cross-file navigation, hover, completion, diagnostics, rename, inlay hints, semantic tokens, and formatting', () => {
    const { request, notify, notifications } = createHarness();
    request('initialize', {
      rootUri: 'file:///workspace',
      initializationOptions: {
        preferences: {
          includeInlayParameterNameHints: 'all',
          includeInlayVariableTypeHints: true,
          includeInlayFunctionLikeReturnTypeHints: true,
          includeCompletionsForModuleExports: true,
        },
      },
    });
    notify('initialized', {});

    const mathUri = 'file:///workspace/src/math.ts';
    const appUri = 'file:///workspace/src/app.ts';

    const mathCode = [
      'export interface Calculator {',
      '  compute(a: number, b: number): number;',
      '}',
      '',
      'export class Adder implements Calculator {',
      '  compute(a: number, b: number): number {',
      '    return a + b;',
      '  }',
      '}',
      '',
      '/** Adds two numbers together. */',
      'export function addNumbers(left: number, right: number): number {',
      '  return left + right;',
      '}',
      '',
      'export function multiplyNumbers(x: number, y: number): number {',
      '  return x * y;',
      '}',
    ].join('\n');

    const appCode = [
      'import { Adder, addNumbers, type Calculator } from "./math";',
      '',
      'export function runDemo(calc: Calculator) {',
      '  const sum = addNumbers(10, 20);',
      '  const inst = new Adder();',
      '  return calc.compute(sum, inst.compute(1, 2));',
      '}',
    ].join('\n');

    notify('mscode/syncFiles', {
      files: [
        {
          uri: 'file:///workspace/tsconfig.json',
          text: JSON.stringify({ compilerOptions: { strict: true, target: 'ES2022', module: 'ESNext' } }),
        },
        { uri: mathUri, text: mathCode },
        { uri: appUri, text: appCode },
      ],
    });

    notify('textDocument/didOpen', {
      textDocument: { uri: appUri, languageId: 'typescript', version: 1, text: appCode },
    });

    // 1. Diagnostics: clean file has 0 errors
    const cleanDiag = notifications.filter((n) => n.method === 'textDocument/publishDiagnostics').pop();
    expect(cleanDiag?.params.uri).toBe(appUri);
    expect(cleanDiag?.params.diagnostics).toEqual([]);

    // 2. Hover on addNumbers (line 3, col 16)
    const hover = request('textDocument/hover', {
      textDocument: { uri: appUri },
      position: { line: 3, character: 16 },
    });
    expect(hover?.contents?.value).toContain('addNumbers');
    expect(hover?.contents?.value).toContain('Adds two numbers together');

    // 3. Cross-file Definition: addNumbers → math.ts
    const defs = request('textDocument/definition', {
      textDocument: { uri: appUri },
      position: { line: 3, character: 16 },
    });
    expect(Array.isArray(defs)).toBe(true);
    expect(defs[0].uri).toBe(mathUri);
    expect(defs[0].range.start.line).toBe(11);

    // 4. Cross-file Type Definition: calc → Calculator interface in math.ts
    const typeDefs = request('textDocument/typeDefinition', {
      textDocument: { uri: appUri },
      position: { line: 5, character: 10 },
    });
    expect(Array.isArray(typeDefs)).toBe(true);
    expect(typeDefs[0].uri).toBe(mathUri);
    expect(typeDefs[0].range.start.line).toBe(0);

    // 5. Cross-file Implementation: Calculator → Adder in math.ts
    const impls = request('textDocument/implementation', {
      textDocument: { uri: mathUri },
      position: { line: 0, character: 18 },
    });
    expect(Array.isArray(impls)).toBe(true);
    expect(impls.some((l: any) => l.uri === mathUri && l.range.start.line === 4)).toBe(true);

    // 6. Signature Help inside addNumbers(10, 20)
    const sig = request('textDocument/signatureHelp', {
      textDocument: { uri: appUri },
      position: { line: 3, character: 26 },
    });
    expect(sig?.signatures?.length).toBeGreaterThan(0);
    expect(sig.signatures[0].label).toContain('left: number');

    // 7. Cross-file References on addNumbers
    const refs = request('textDocument/references', {
      textDocument: { uri: mathUri },
      position: { line: 11, character: 18 },
      context: { includeDeclaration: true },
    });
    expect(refs.some((r: any) => r.uri === appUri)).toBe(true);
    expect(refs.some((r: any) => r.uri === mathUri)).toBe(true);

    // 8. Document Symbols (hierarchical)
    const syms = request('textDocument/documentSymbol', {
      textDocument: { uri: mathUri },
    });
    const names = syms.map((s: any) => s.name);
    expect(names).toContain('Calculator');
    expect(names).toContain('Adder');
    expect(names).toContain('addNumbers');

    // 9. Document Highlights
    const highlights = request('textDocument/documentHighlight', {
      textDocument: { uri: appUri },
      position: { line: 3, character: 9 }, // `sum`
    });
    expect(highlights.length).toBeGreaterThanOrEqual(2);

    // 10. Prepare Rename & Cross-file Rename
    const prep = request('textDocument/prepareRename', {
      textDocument: { uri: appUri },
      position: { line: 3, character: 16 },
    });
    expect(prep?.placeholder).toBe('addNumbers');

    const renameEdit = request('textDocument/rename', {
      textDocument: { uri: mathUri },
      position: { line: 11, character: 18 },
      newName: 'sumPair',
    });
    expect(Object.keys(renameEdit.changes)).toContain(appUri);
    expect(Object.keys(renameEdit.changes)).toContain(mathUri);

    // 11. Inlay Hints (parameter names & variable types)
    const hints = request('textDocument/inlayHint', {
      textDocument: { uri: appUri },
      range: { start: { line: 0, character: 0 }, end: { line: 6, character: 0 } },
    });
    expect(Array.isArray(hints)).toBe(true);
    expect(hints.length).toBeGreaterThan(0);

    // 12. Semantic Tokens
    const tokens = request('textDocument/semanticTokens/full', {
      textDocument: { uri: appUri },
    });
    expect(Array.isArray(tokens.data)).toBe(true);
    expect(tokens.data.length).toBeGreaterThan(0);
    expect(tokens.data.length % 5).toBe(0);

    // 13. Folding Range & Selection Range
    const folds = request('textDocument/foldingRange', { textDocument: { uri: mathUri } });
    expect(folds.length).toBeGreaterThan(0);

    const selRanges = request('textDocument/selectionRange', {
      textDocument: { uri: appUri },
      positions: [{ line: 3, character: 16 }],
    });
    expect(selRanges.length).toBe(1);
    expect(selRanges[0].parent).toBeTruthy();

    // 14. Formatting
    const messyUri = 'file:///workspace/src/messy.ts';
    notify('textDocument/didOpen', {
      textDocument: {
        uri: messyUri,
        languageId: 'typescript',
        version: 1,
        text: 'function foo(a:number,b:number){return a+b;}',
      },
    });
    const fmtEdits = request('textDocument/formatting', {
      textDocument: { uri: messyUri },
      options: { tabSize: 2, insertSpaces: true },
    });
    expect(fmtEdits.length).toBeGreaterThan(0);

    // 15. Completion + resolve with cross-file auto-import additionalTextEdits
    const autoImportUri = 'file:///workspace/src/auto.ts';
    const autoCode = 'const res = multiplyNum';
    notify('textDocument/didOpen', {
      textDocument: { uri: autoImportUri, languageId: 'typescript', version: 1, text: autoCode },
    });
    const comp = request('textDocument/completion', {
      textDocument: { uri: autoImportUri },
      position: { line: 0, character: autoCode.length },
    });
    const mulItem = comp.items.find((i: any) => i.label === 'multiplyNumbers');
    expect(mulItem).toBeTruthy();
    const resolved = request('completionItem/resolve', mulItem);
    expect(resolved.detail).toContain('multiplyNumbers');
    expect(Array.isArray(resolved.additionalTextEdits)).toBe(true);
    expect(resolved.additionalTextEdits[0].newText).toContain('multiplyNumbers');

    // 16. Diagnostics + Quick Fix code action for type error / missing import
    const brokenUri = 'file:///workspace/src/broken.ts';
    const brokenCode = 'export const n: number = "oops";\nexport const m = multiplyNumbers(2, 3);\n';
    notify('textDocument/didOpen', {
      textDocument: { uri: brokenUri, languageId: 'typescript', version: 1, text: brokenCode },
    });
    const errDiag = notifications.filter((n) => n.method === 'textDocument/publishDiagnostics').pop();
    expect(errDiag?.params.uri).toBe(brokenUri);
    expect(errDiag?.params.diagnostics.length).toBeGreaterThanOrEqual(2);

    const actions = request('textDocument/codeAction', {
      textDocument: { uri: brokenUri },
      range: { start: { line: 1, character: 17 }, end: { line: 1, character: 32 } },
      context: { diagnostics: errDiag?.params.diagnostics ?? [] },
    });
    expect(actions.some((a: any) => /import/i.test(a.title))).toBe(true);
  });

  it('provides hover docs at trailing edge (document|), object member completions after dot (document.), and signature help on DOM & user functions', () => {
    const { request, notify } = createHarness();
    request('initialize', { rootUri: 'file:///workspace' });
    notify('initialized', {});

    const uri = 'file:///workspace/src/dom.ts';

    // 1. Trailing-edge hover on `document|`
    notify('textDocument/didOpen', {
      textDocument: { uri, languageId: 'typescript', version: 1, text: 'document' },
    });
    const docHover = request('textDocument/hover', {
      textDocument: { uri },
      position: { line: 0, character: 8 }, // right at `document|`
    });
    expect(docHover?.contents?.value).toContain('var document: Document');
    expect(docHover?.contents?.value).toContain('DOM tree');

    // 2. Member completions after `document.`
    notify('textDocument/didChange', {
      textDocument: { uri, version: 2 },
      contentChanges: [{ text: 'document.' }],
    });
    const dotComp = request('textDocument/completion', {
      textDocument: { uri },
      position: { line: 0, character: 9 },
      context: { triggerKind: 2, triggerCharacter: '.' },
    });
    const labels = dotComp.items.map((i: any) => i.label);
    expect(labels).toContain('getElementById');
    expect(labels).toContain('querySelector');
    expect(labels).toContain('createElement');
    expect(labels).toContain('body');
    expect(labels).toContain('title');
    expect(labels).toContain('addEventListener');
    expect(labels).not.toContain('function');
    expect(labels).not.toContain('const');

    const qsItem = dotComp.items.find((i: any) => i.label === 'querySelector');
    expect(qsItem.kind).toBe(2); // LSP Method
    const qsResolved = request('completionItem/resolve', qsItem);
    expect(qsResolved.documentation?.value).toContain('CSS selector');

    // 3. Signature help for `document.querySelector(` and user-written function
    const sigCode = [
      '/** Greets a user by name. */',
      'function greetUser(name: string, times: number): string { return name; }',
      'document.querySelector(',
      'greetUser(',
      'greet',
    ].join('\n');
    notify('textDocument/didChange', {
      textDocument: { uri, version: 3 },
      contentChanges: [{ text: sigCode }],
    });

    const domSig = request('textDocument/signatureHelp', {
      textDocument: { uri },
      position: { line: 2, character: 'document.querySelector('.length },
    });
    expect(domSig?.signatures?.length).toBeGreaterThan(0);
    expect(domSig.signatures[0].label).toContain('selectors: string');

    const userSig = request('textDocument/signatureHelp', {
      textDocument: { uri },
      position: { line: 3, character: 'greetUser('.length },
    });
    expect(userSig?.signatures?.length).toBeGreaterThan(0);
    expect(userSig.signatures[0].label).toContain('name: string');
    expect(userSig.signatures[0].documentation?.value).toContain('Greets a user by name');

    // 4. User function completion returns Function kind (3), not Keyword (14)
    const userComp = request('textDocument/completion', {
      textDocument: { uri },
      position: { line: 4, character: 5 },
    });
    const greetItem = userComp.items.find((i: any) => i.label === 'greetUser');
    expect(greetItem).toBeTruthy();
    expect(greetItem.kind).toBe(3); // LSP Function

    // 5. Document hover includes clickable MDN Reference markdown link
    expect(docHover?.contents?.kind).toBe('markdown');
    expect(docHover?.contents?.value).toContain('[MDN Reference](https://developer.mozilla.org/');

    // 6. Hovering keywords (const / function / return) returns null
    const kwHover = request('textDocument/hover', {
      textDocument: { uri },
      position: { line: 1, character: 3 }, // inside `function`
    });
    expect(kwHover).toBeNull();
  });
});
