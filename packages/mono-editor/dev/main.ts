import {
  editor,
  languages,
  analyzeCallContext,
  CompletionItemKind,
  CompletionItemInsertTextRule,
  DocumentHighlightKind,
  EndOfLineSequence,
  InlayHintKind,
  InlineCompletionTriggerKind,
  MarkerSeverity,
  MonoCommands,
  MouseTargetType,
  SymbolKind,
  Uri,
  BUILTIN_THEME_IDS,
  type CursorStyleMode,
  type DocumentSymbol,
  type IMonoDiffEditor,
  type IStandaloneTextModel,
  type MonoLineNumbers,
  type RenderWhitespaceMode,
  type WordWrapMode,
  type WrappingIndentMode,
  type ScrollbarVisibility,
} from '../src/index';

// ── Phase 3 & 4 IntelliSense & LSP Demo Providers ────────────────────────────
const JS_TS_LANGS = ['javascript', 'typescript'];
const REF_LANGS = ['javascript', 'typescript', 'html', 'css'];

function findIdentifierWord(line: string, col: number): string | null {
  let idx = Math.max(0, Math.min(line.length, col - 1));
  const isId = (c: string) => /[A-Za-z0-9_$]/.test(c);
  if (idx > 0 && (idx === line.length || !isId(line[idx]!)) && isId(line[idx - 1]!)) idx--;
  if (idx >= line.length || !isId(line[idx]!)) return null;
  let s = idx;
  while (s > 0 && isId(line[s - 1]!)) s--;
  let e = idx + 1;
  while (e < line.length && isId(line[e]!)) e++;
  return line.slice(s, e);
}

for (const langId of JS_TS_LANGS) {
  // 1) Rich Completions: Snippets + resolveCompletionItem + commitCharacters
  languages.registerCompletionItemProvider(langId, {
    triggerCharacters: ['.'],
    provideCompletionItems(model, position, context) {
      const line = model.getLineContent(position.lineNumber);
      const before = line.slice(0, Math.max(0, position.column - 1));
      if (context?.triggerCharacter === '.' || /\bconsole\.\w*$/.test(before)) {
        return {
          suggestions: [
            {
              label: 'log',
              kind: CompletionItemKind.Method,
              detail: 'Console.log(...data)',
              insertText: 'log(${1:value})$0',
              insertTextRules: CompletionItemInsertTextRule.InsertAsSnippet,
              commitCharacters: ['('],
            },
            {
              label: 'warn',
              kind: CompletionItemKind.Method,
              detail: 'Console.warn(...data)',
              insertText: 'warn(${1:message})$0',
              insertTextRules: CompletionItemInsertTextRule.InsertAsSnippet,
            },
            {
              label: 'error',
              kind: CompletionItemKind.Method,
              detail: 'Console.error(...data)',
              insertText: 'error(${1:err})$0',
              insertTextRules: CompletionItemInsertTextRule.InsertAsSnippet,
            },
            { label: 'info', kind: CompletionItemKind.Method, detail: 'Console.info(...data)', insertText: 'info' },
            { label: 'table', kind: CompletionItemKind.Method, detail: 'Console.table(data)', insertText: 'table' },
            { label: 'time', kind: CompletionItemKind.Method, detail: 'Console.time(label)', insertText: 'time' },
            { label: 'timeEnd', kind: CompletionItemKind.Method, detail: 'Console.timeEnd(label)', insertText: 'timeEnd' },
          ],
        };
      }
      return {
        suggestions: [
          {
            label: 'fn',
            kind: CompletionItemKind.Snippet,
            detail: 'Function snippet (Tabstops)',
            insertText: 'function ${1:name}(${2:params}) {\n  ${3:// body}\n}$0',
            insertTextRules: CompletionItemInsertTextRule.InsertAsSnippet,
            documentation: {
              value: '**Function Declaration Snippet**\n\nUse `Tab` / `Shift+Tab` to jump across `$1`, `$2`, `$3`, and `$0`.',
            },
          },
          {
            label: 'forof',
            kind: CompletionItemKind.Snippet,
            detail: 'for..of loop snippet',
            insertText: 'for (const ${1:item} of ${2:items}) {\n  ${3:console.log(item);}\n}$0',
            insertTextRules: CompletionItemInsertTextRule.InsertAsSnippet,
            documentation: {
              value: 'Iterates over an iterable collection.\n\n```js\nfor (const item of items) {}\n```',
            },
          },
          {
            label: 'log',
            kind: CompletionItemKind.Snippet,
            detail: 'console.log snippet',
            insertText: 'console.log("${1:label}", ${2:value});$0',
            insertTextRules: CompletionItemInsertTextRule.InsertAsSnippet,
          },
          {
            label: 'greetAll',
            kind: CompletionItemKind.Function,
            detail: '(name: string, locale?: string) => string',
            insertText: 'greetAll(${1:"Mono"}, ${2:"bn"})$0',
            insertTextRules: CompletionItemInsertTextRule.InsertAsSnippet,
            commitCharacters: ['('],
          },
          { label: 'console', kind: CompletionItemKind.Variable, detail: 'Console', insertText: 'console', commitCharacters: ['.'] },
          { label: 'document', kind: CompletionItemKind.Variable, detail: 'Document', insertText: 'document', commitCharacters: ['.'] },
          { label: 'window', kind: CompletionItemKind.Variable, detail: 'Window', insertText: 'window', commitCharacters: ['.'] },
          { label: 'setTimeout', kind: CompletionItemKind.Function, detail: 'timer', insertText: 'setTimeout' },
          { label: 'requestAnimationFrame', kind: CompletionItemKind.Function, detail: 'frame', insertText: 'requestAnimationFrame' },
        ],
      };
    },
    resolveCompletionItem(item) {
      const label = typeof item.label === 'string' ? item.label : item.label.label;
      if (item.documentation) return item;
      const docs: Record<string, string> = {
        log: 'Prints formatted output to the developer console.\n\n```js\nconsole.log("Hello", value);\n```',
        warn: 'Emits a **warning** message to the console.',
        error: 'Emits an **error** message to the console.',
        greetAll: 'Formats a multi-script greeting in **Bengali** and **Hindi**.\n\n```js\ngreetAll("Mono", "bn");\n```',
        console: 'Provides access to the browser debugging console.',
      };
      if (docs[label]) {
        return { ...item, documentation: { value: docs[label]! } };
      }
      return item;
    },
  });

  // 2) Rich Markdown Hover Provider
  languages.registerHoverProvider(langId, {
    provideHover(model, position) {
      const line = model.getLineContent(position.lineNumber);
      const word = findIdentifierWord(line, position.column);
      if (!word) return null;
      const map: Record<string, string[]> = {
        greetAll: [
          '```ts\nfunction greetAll(name: string, locale?: "bn" | "hi"): string\n```',
          'Greets a user in multiple Indic scripts (**বাংলা** & **हिन्दी**) and logs the message.',
        ],
        MonoDemo: [
          '```ts\nclass MonoDemo\n```',
          'Demo runner class showcasing **Code Folding**, **Sticky Scroll**, and **Word Wrap**.',
        ],
        run: [
          '```ts\n(method) MonoDemo.run(repeatCount?: number): void\n```',
          'Executes the greeting demo loop `repeatCount` times.',
        ],
        demo: [
          '```ts\nconst demo: MonoDemo\n```',
          'Active `MonoDemo` instance initialized with title `"Mono"`.',
        ],
        report: [
          '```ts\nconst report: string\n```',
          'Formatted multiline template string containing header, localized greeting, and computed JSON.',
        ],
        greetingBn: [
          '```ts\nconst greetingBn: string\n```',
          'Bengali conjunct cluster sample (`ক্ষ`, `ক্লান্ত`) for grapheme-exact hit testing.',
        ],
        greetingHi: [
          '```ts\nconst greetingHi: string\n```',
          'Devanagari conjunct cluster sample (`प्रकृति`, `संयुक्त`) for grapheme-exact layout.',
        ],
        legacyMode: [
          '```ts\nvar legacyMode: boolean\n```',
          'Click the **lightbulb** or press `Ctrl+.` to convert `var` to `const`.',
        ],
        console: [
          '```ts\nvar console: Console\n```',
          'Standard Web Console debugging interface.',
        ],
        log: [
          '```ts\n(method) Console.log(...data: any[]): void\n```',
          'Outputs a message to the Web Console.',
        ],
        info: [
          '```ts\n(method) Console.info(...data: any[]): void\n```',
          'Outputs an informational message to the Web Console.',
        ],
        toUpperCase: [
          '```ts\n(method) String.toUpperCase(): string\n```',
          'Converts all alphabetic characters in a string to uppercase.',
        ],
        stringify: [
          '```ts\n(method) JSON.stringify(value: any, replacer?: any, space?: string | number): string\n```',
          'Converts a JavaScript value to a JavaScript Object Notation (JSON) string.',
        ],
        createProfile: [
          '```ts\nfunction createProfile(id: string, language: string): EditorProfile\n```',
          'Creates a normalized `EditorProfile` configuration object.',
        ],
      };
      const contents = map[word];
      if (contents) return { contents: contents.map((value) => ({ value })) };
      // Dynamic fallback for any function/class declaration in the current model
      const count = model.getLineCount?.() ?? model.getValue().split('\n').length;
      const escaped = word.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      const declRe = new RegExp(`^\\s*(?:export\\s+)?(?:async\\s+)?(?:function|class|interface|const|let|var)\\s+${escaped}\\b.*$`);
      for (let ln = 1; ln <= count; ln++) {
        const declLine = model.getLineContent(ln);
        if (declRe.test(declLine)) {
          return {
            contents: [
              { value: `\`\`\`${langId}\n${declLine.trim().replace(/\{\s*$/, '').trim()}\n\`\`\`` },
              { value: `Declared on line ${ln}.` },
            ],
          };
        }
      }
      return null;
    },
  });

  // 3) Signature Help Provider (multi-line call tracking + overloads + live active parameter)
  languages.registerSignatureHelpProvider(langId, {
    signatureHelpTriggerCharacters: ['(', ','],
    signatureHelpRetriggerCharacters: [','],
    provideSignatureHelp(model, position) {
      const ctx = analyzeCallContext(model, position);
      if (!ctx) return null;
      const fnName = ctx.calleeName;
      if (fnName !== 'greetAll' && fnName !== 'console.log') return null;
      const activeParameter = ctx.activeParameter;

      if (fnName === 'greetAll') {
        return {
          value: {
            activeSignature: 0,
            activeParameter: Math.min(activeParameter, 1),
            signatures: [
              {
                label: 'greetAll(name: string, locale?: "bn" | "hi"): string',
                documentation: { value: 'Greets the user with multi-script Indic text.' },
                parameters: [
                  { label: 'name: string', documentation: 'Display name of the recipient.' },
                  { label: 'locale?: "bn" | "hi"', documentation: 'Optional preferred script (`"bn"` or `"hi"`).' },
                ],
              },
              {
                label: 'greetAll(options: { name: string; repeat?: number }): string',
                documentation: { value: 'Options object overload for repeated greetings.' },
                parameters: [
                  { label: 'options: { name: string; repeat?: number }', documentation: 'Structured greeting options.' },
                ],
              },
            ],
          },
        };
      }

      return {
        value: {
          activeSignature: 0,
          activeParameter: 0,
          signatures: [
            {
              label: 'console.log(...data: unknown[]): void',
              documentation: { value: 'Outputs a message to the console.' },
              parameters: [{ label: '...data: unknown[]', documentation: 'Values to log.' }],
            },
          ],
        },
      };
    },
  });

  // 4) Document & Range Formatting Provider
  languages.registerDocumentFormattingEditProvider(langId, {
    provideDocumentFormattingEdits(model, options) {
      const indentUnit = ' '.repeat(options.tabSize || 2);
      const count = model.getLineCount?.() ?? model.getValue().split('\n').length;
      const formatted: string[] = [];
      let depth = 0;
      for (let ln = 1; ln <= count; ln++) {
        const raw = model.getLineContent(ln).trimEnd();
        const trimmed = raw.trim();
        if (!trimmed) {
          formatted.push('');
          continue;
        }
        if (/^[}\])]/.test(trimmed)) depth = Math.max(0, depth - 1);
        const prefix = trimmed.startsWith('*') ? `${indentUnit.repeat(depth)} ` : indentUnit.repeat(depth);
        formatted.push(prefix + trimmed);
        if (/[{\[(]\s*$/.test(trimmed) && !trimmed.startsWith('//') && !trimmed.startsWith('*')) {
          depth++;
        }
      }
      const lastLen = model.getLineContent(count).length + 1;
      return [
        {
          range: { startLineNumber: 1, startColumn: 1, endLineNumber: count, endColumn: lastLen },
          text: formatted.join('\n'),
        },
      ];
    },
  });

  languages.registerDocumentRangeFormattingEditProvider(langId, {
    provideDocumentRangeFormattingEdits(model, range) {
      const edits = [];
      for (let ln = range.startLineNumber; ln <= range.endLineNumber; ln++) {
        const line = model.getLineContent(ln);
        const trimmed = line.trimEnd();
        if (trimmed !== line) {
          edits.push({
            range: {
              startLineNumber: ln,
              startColumn: trimmed.length + 1,
              endLineNumber: ln,
              endColumn: line.length + 1,
            },
            text: '',
          });
        }
      }
      return edits;
    },
  });

  // 5) Go to Definition Provider
  languages.registerDefinitionProvider(langId, {
    provideDefinition(model, position) {
      const word = findIdentifierWord(model.getLineContent(position.lineNumber), position.column);
      if (!word) return null;
      const declRe = new RegExp(`\\b(?:function|class|const|let|var|interface)\\s+${word}\\b`);
      const count = model.getLineCount?.() ?? model.getValue().split('\n').length;
      for (let ln = 1; ln <= count; ln++) {
        const line = model.getLineContent(ln);
        const m = declRe.exec(line);
        if (m) {
          const col = line.indexOf(word, m.index) + 1;
          return {
            uri: model.uri ?? Uri.parse('inmemory://playground/app.js'),
            range: {
              startLineNumber: ln,
              startColumn: col,
              endLineNumber: ln,
              endColumn: col + word.length,
            },
          };
        }
      }
      return null;
    },
  });

  // 6) References Provider
  languages.registerReferenceProvider(langId, {
    provideReferences(model, position) {
      const word = findIdentifierWord(model.getLineContent(position.lineNumber), position.column);
      if (!word) return [];
      const re = new RegExp(`\\b${word.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`, 'g');
      const locs = [];
      const uri = model.uri ?? Uri.parse('inmemory://playground/app.js');
      const count = model.getLineCount?.() ?? model.getValue().split('\n').length;
      for (let ln = 1; ln <= count; ln++) {
        const line = model.getLineContent(ln);
        let m: RegExpExecArray | null;
        while ((m = re.exec(line))) {
          locs.push({
            uri,
            range: {
              startLineNumber: ln,
              startColumn: m.index + 1,
              endLineNumber: ln,
              endColumn: m.index + 1 + word.length,
            },
          });
        }
      }
      return locs;
    },
  });

  // 7) Rename Provider
  languages.registerRenameProvider(langId, {
    resolveRenameLocation(model, position) {
      const line = model.getLineContent(position.lineNumber);
      const word = findIdentifierWord(line, position.column);
      if (!word) return { range: { startLineNumber: position.lineNumber, startColumn: position.column, endLineNumber: position.lineNumber, endColumn: position.column }, text: '', rejectReason: 'No identifier at cursor' };
      const col = line.indexOf(word, Math.max(0, position.column - word.length - 1)) + 1;
      return {
        text: word,
        range: {
          startLineNumber: position.lineNumber,
          startColumn: col,
          endLineNumber: position.lineNumber,
          endColumn: col + word.length,
        },
      };
    },
    provideRenameEdits(model, position, newName) {
      const word = findIdentifierWord(model.getLineContent(position.lineNumber), position.column);
      if (!word) return null;
      const re = new RegExp(`\\b${word.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`, 'g');
      const uri = model.uri ?? Uri.parse('inmemory://playground/app.js');
      const edits = [];
      const count = model.getLineCount?.() ?? model.getValue().split('\n').length;
      for (let ln = 1; ln <= count; ln++) {
        const line = model.getLineContent(ln);
        let m: RegExpExecArray | null;
        while ((m = re.exec(line))) {
          edits.push({
            resource: uri,
            textEdit: {
              range: {
                startLineNumber: ln,
                startColumn: m.index + 1,
                endLineNumber: ln,
                endColumn: m.index + 1 + word.length,
              },
              text: newName,
            },
          });
        }
      }
      return { edits };
    },
  });

  // 8) Code Action / Quick Fix Provider
  languages.registerCodeActionProvider(langId, {
    provideCodeActions(model, range, context) {
      const line = model.getLineContent(range.startLineNumber);
      const actions = [];
      const varMatch = /\bvar\b/.exec(line);
      if (varMatch) {
        actions.push({
          title: "Convert 'var' to 'const'",
          kind: 'quickfix',
          isPreferred: true,
          edit: {
            edits: [
              {
                resource: model.uri,
                textEdit: {
                  range: {
                    startLineNumber: range.startLineNumber,
                    startColumn: varMatch.index + 1,
                    endLineNumber: range.startLineNumber,
                    endColumn: varMatch.index + 4,
                  },
                  text: 'const',
                },
              },
            ],
          },
        });
      }
      if (context.markers.length > 0) {
        actions.push({
          title: 'Disable diagnostic on this line (add comment)',
          kind: 'quickfix',
          edit: {
            edits: [
              {
                resource: model.uri,
                textEdit: {
                  range: {
                    startLineNumber: range.startLineNumber,
                    startColumn: line.length + 1,
                    endLineNumber: range.startLineNumber,
                    endColumn: line.length + 1,
                  },
                  text: ' // mono-ignore',
                },
              },
            ],
          },
        });
      }
      return { actions };
    },
  });

  // 9) Phase 6: AI Inline Completions Provider (Copilot-style multiline ghost text)
  languages.registerInlineCompletionsProvider(langId, {
    provideInlineCompletions(model, position, context) {
      const line = model.getLineContent(position.lineNumber);
      const before = line.slice(0, position.column - 1);
      if (/\bgreetAll\(\s*$/.test(before)) {
        return {
          items: [
            { insertText: '"Mono", "bn")' },
            { insertText: '{ name: "Mono", repeat: 2 })' },
          ],
        };
      }
      if (/\breturn\s+$/.test(before)) {
        return {
          items: [
            {
              insertText:
                '{\n    status: "ok",\n    timestamp: Date.now(),\n    summary: "Generated by Mono multiline ghost text",\n  };',
            },
          ],
        };
      }
      if (context.triggerKind === InlineCompletionTriggerKind.Invoke) {
        return {
          items: [
            {
              insertText:
                '// Copilot-style multiline suggestion (wraps cleanly when Word Wrap is ON)\n  const summary = `Processed ${repeatCount} items in Mono Editor`;\n  console.info(summary);',
            },
          ],
        };
      }
      return null;
    },
  });

  // 10) Phase 6: LSP Inlay Hints Provider (parameter & inferred return type hints)
  languages.registerInlayHintsProvider(langId, {
    provideInlayHints(model, range) {
      const hints = [];
      for (let ln = range.startLineNumber; ln <= range.endLineNumber; ln++) {
        const line = model.getLineContent(ln);
        const call = /\bgreetAll\s*\(([^,)]+)(?:,\s*([^)]+))?\)/.exec(line);
        if (call && !line.trimStart().startsWith('function ')) {
          const openIdx = line.indexOf('(', call.index);
          const firstArgCol = openIdx + 2;
          hints.push({
            position: { lineNumber: ln, column: firstArgCol },
            label: 'name:',
            kind: InlayHintKind.Parameter,
            paddingRight: true,
          });
          if (call[2]) {
            const commaIdx = line.indexOf(',', openIdx);
            if (commaIdx >= 0) {
              let c = commaIdx + 1;
              while (c < line.length && line[c] === ' ') c++;
              hints.push({
                position: { lineNumber: ln, column: c + 1 },
                label: 'locale:',
                kind: InlayHintKind.Parameter,
                paddingRight: true,
              });
            }
          }
        }
        const runCall = /\bdemo\.run\s*\(([^)]+)\)/.exec(line);
        if (runCall) {
          const col = line.indexOf('(', runCall.index) + 2;
          hints.push({
            position: { lineNumber: ln, column: col },
            label: 'repeatCount:',
            kind: InlayHintKind.Parameter,
            paddingRight: true,
          });
        }
      }
      return { hints };
    },
  });

  // 11) Phase 6: Semantic Document Highlights Provider (Read vs Write)
  languages.registerDocumentHighlightProvider(langId, {
    provideDocumentHighlights(model, position) {
      const word = findIdentifierWord(model.getLineContent(position.lineNumber), position.column);
      if (!word || word.length < 2) return [];
      const re = new RegExp(`\\b${word.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`, 'g');
      const out = [];
      const count = model.getLineCount?.() ?? model.getValue().split('\n').length;
      for (let ln = 1; ln <= count; ln++) {
        const line = model.getLineContent(ln);
        let m: RegExpExecArray | null;
        while ((m = re.exec(line))) {
          const after = line.slice(m.index + word.length);
          const isWrite = /^\s*=(?!=)/.test(after);
          out.push({
            range: {
              startLineNumber: ln,
              startColumn: m.index + 1,
              endLineNumber: ln,
              endColumn: m.index + 1 + word.length,
            },
            kind: isWrite ? DocumentHighlightKind.Write : DocumentHighlightKind.Read,
          });
        }
      }
      return out;
    },
  });

  // 12) Phase 6: DocumentSymbol Provider (also feeds Sticky Scroll OutlineScopeFinder!)
  languages.registerDocumentSymbolProvider(langId, {
    provideDocumentSymbols(model) {
      const symbols: DocumentSymbol[] = [];
      const count = model.getLineCount?.() ?? model.getValue().split('\n').length;
      const findEndLine = (startLn: number) => {
        let depth = 0;
        let opened = false;
        for (let ln = startLn; ln <= count; ln++) {
          const text = model.getLineContent(ln);
          for (const ch of text) {
            if (ch === '{') { depth++; opened = true; }
            else if (ch === '}') { depth--; if (opened && depth <= 0) return ln; }
          }
        }
        return startLn;
      };
      for (let ln = 1; ln <= count; ln++) {
        const line = model.getLineContent(ln);
        const fn = /^\s*(?:export\s+)?function\s+([A-Za-z_$][\w$]*)/.exec(line);
        if (fn) {
          const endLn = findEndLine(ln);
          symbols.push({
            name: fn[1]!,
            kind: SymbolKind.Function,
            range: { startLineNumber: ln, startColumn: 1, endLineNumber: endLn, endColumn: model.getLineContent(endLn).length + 1 },
            selectionRange: { startLineNumber: ln, startColumn: line.indexOf(fn[1]!) + 1, endLineNumber: ln, endColumn: line.indexOf(fn[1]!) + 1 + fn[1]!.length },
          });
          continue;
        }
        const cls = /^\s*(?:export\s+)?class\s+([A-Za-z_$][\w$]*)/.exec(line);
        if (cls) {
          const endLn = findEndLine(ln);
          const children: DocumentSymbol[] = [];
          for (let cln = ln + 1; cln < endLn; cln++) {
            const cline = model.getLineContent(cln);
            const meth = /^\s{2}([A-Za-z_$][\w$]*)\s*\([^)]*\)\s*\{/.exec(cline);
            if (meth && meth[1] !== 'if' && meth[1] !== 'for' && meth[1] !== 'while') {
              const mEnd = findEndLine(cln);
              children.push({
                name: meth[1]!,
                kind: SymbolKind.Method,
                range: { startLineNumber: cln, startColumn: 1, endLineNumber: mEnd, endColumn: model.getLineContent(mEnd).length + 1 },
                selectionRange: { startLineNumber: cln, startColumn: cline.indexOf(meth[1]!) + 1, endLineNumber: cln, endColumn: cline.indexOf(meth[1]!) + 1 + meth[1]!.length },
              });
            }
          }
          symbols.push({
            name: cls[1]!,
            kind: SymbolKind.Class,
            range: { startLineNumber: ln, startColumn: 1, endLineNumber: endLn, endColumn: model.getLineContent(endLn).length + 1 },
            selectionRange: { startLineNumber: ln, startColumn: line.indexOf(cls[1]!) + 1, endLineNumber: ln, endColumn: line.indexOf(cls[1]!) + 1 + cls[1]!.length },
            children,
          });
        }
      }
      return symbols;
    },
  });

  // 13) Phase 6: Semantic Tokens Provider (highlights readonly constants & deprecated legacyMode)
  const semanticLegend = {
    tokenTypes: ['variable', 'function', 'class'],
    tokenModifiers: ['readonly', 'deprecated', 'declaration'],
  };
  languages.registerDocumentSemanticTokensProvider(langId, {
    getLegend: () => semanticLegend,
    provideDocumentSemanticTokens(model) {
      const data: number[] = [];
      let prevLine = 0;
      let prevChar = 0;
      const pushTok = (ln0: number, ch0: number, len: number, typeIdx: number, modBits: number) => {
        const dLine = ln0 - prevLine;
        const dChar = dLine === 0 ? ch0 - prevChar : ch0;
        data.push(dLine, dChar, len, typeIdx, modBits);
        prevLine = ln0;
        prevChar = ch0;
      };
      const count = model.getLineCount?.() ?? model.getValue().split('\n').length;
      const re = /\b(greetingBn|greetingHi|legacyMode)\b/g;
      for (let ln = 1; ln <= count; ln++) {
        const line = model.getLineContent(ln);
        let m: RegExpExecArray | null;
        while ((m = re.exec(line))) {
          const modBits = m[1] === 'legacyMode' ? (1 << 1) : (1 << 0);
          pushTok(ln - 1, m.index, m[1]!.length, 0, modBits);
        }
      }
      return { data: new Uint32Array(data) };
    },
  });

  // 14) Phase 7: CodeLens Provider (shows reference counts above functions & classes)
  languages.registerCodeLensProvider(langId, {
    provideCodeLenses(model) {
      const lenses = [];
      const count = model.getLineCount?.() ?? model.getValue().split('\n').length;
      for (let ln = 1; ln <= count; ln++) {
        const line = model.getLineContent(ln);
        const m = /^\s*(?:export\s+)?(?:function|class)\s+([A-Za-z_$][\w$]*)/.exec(line);
        if (m) {
          const symName = m[1]!;
          const nameCol = line.indexOf(symName, m.index) + 1;
          lenses.push({
            range: { startLineNumber: ln, startColumn: nameCol, endLineNumber: ln, endColumn: nameCol + symName.length },
            command: {
              id: MonoCommands.ReferenceSearch,
              title: `Find references · ${symName}`,
              tooltip: `Inspect references for ${symName}`,
              arguments: [{ lineNumber: ln, column: nameCol }],
            },
          });
        }
      }
      return { lenses };
    },
  });
}

// Also enable Find References in HTML & CSS tabs for live inline peek testing
for (const langId of REF_LANGS) {
  if (JS_TS_LANGS.includes(langId)) continue;
  languages.registerReferenceProvider(langId, {
    provideReferences(model, position) {
      const word = findIdentifierWord(model.getLineContent(position.lineNumber), position.column);
      if (!word) return [];
      const re = new RegExp(`\\b${word.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`, 'g');
      const locs = [];
      const uri = model.uri ?? Uri.parse(`inmemory://playground/file.${langId}`);
      const count = model.getLineCount?.() ?? model.getValue().split('\n').length;
      for (let ln = 1; ln <= count; ln++) {
        const line = model.getLineContent(ln);
        let m: RegExpExecArray | null;
        while ((m = re.exec(line))) {
          locs.push({
            uri,
            range: {
              startLineNumber: ln,
              startColumn: m.index + 1,
              endLineNumber: ln,
              endColumn: m.index + 1 + word.length,
            },
          });
        }
      }
      return locs;
    },
  });
}

// ── Language Samples ─────────────────────────────────────────────────────────
const LANGUAGE_SAMPLES: Record<string, { label: string; code: string }> = {
  javascript: {
    label: 'JavaScript',
    code: `// Mono Editor — Live Interactive Playground (Docs: https://mono-editor.dev/docs)
// Try: Ghost Preview (Tab to accept), Hover Docs (Ctrl+K), Inlay Hints, Signature Help, Smart Select

const greetingBn = "বাংলাদেশ যুক্তাক্ষর ক্ষ ক্লান্ত";
const greetingHi = "नमस्ते प्रकृति संयुक्त अक्षर";
var legacyMode = true; // Place cursor here & press Ctrl+. (or Ctrl+K Hover) for Quick Fix!

/**
 * Greets a user in multiple scripts using multiline template interpolation.
 */
function greetAll(name, locale = "bn") {
  const report = \`
    Header: \${name.toUpperCase()} [\${locale}]
    Nested: \${locale === "bn" ? \`বাংলা -> \${greetingBn}\` : \`हिन्दी -> \${greetingHi}\`}
    Computed: \${(() => {
      const levels = [({ a: [({ deep: 5 })] })];
      return JSON.stringify(levels);
    })()}
  \`;
  console.log(report);
  return report;
}

//#region Demo Runner
class MonoDemo {
  constructor(title) {
    this.title = title;
    this.summary = "Toggle Rainbow Brackets, Word Wrap, Dynamic Caret Color, or switch to palette.html & notes.md above!";
  }

  run(repeatCount = 3) {
    for (let i = 0; i < repeatCount; i++) {
      if (i % 2 === 0) {
        const result = greetAll(this.title, "bn");
        console.info(result);
      }
    }
  }
}
//#endregion

const demo = new MonoDemo("Mono");
demo.run(4);
`,
  },
  typescript: {
    label: 'TypeScript',
    code: `/**
 * Typed editor workspace service sample.
 */
interface EditorProfile {
  readonly id: string;
  language: string;
  wordWrap: 'off' | 'on';
  tabSize: number;
}

function createProfile(id: string, language: string): EditorProfile {
  const profile: EditorProfile = {
    id,
    language,
    wordWrap: 'off',
    tabSize: 2,
  };
  console.log(profile);
  return profile;
}

const activeProfile = createProfile('mono-ts', 'typescript');
console.info(activeProfile.id, activeProfile.language);
`,
  },
  json: {
    label: 'JSON',
    code: `{
  "name": "@mono/editor",
  "version": "1.0.0",
  "features": {
    "folding": true,
    "wordWrap": "off",
    "dynamicCaretColor": true,
    "hideScrollbarsOnStop": true,
    "snippets": true,
    "lspProviders": true
  },
  "languages": [
    "javascript",
    "typescript",
    "json",
    "css",
    "html",
    "python"
  ]
}
`,
  },
  css: {
    label: 'CSS',
    code: `/*
 * Mono Workbench Surface Tokens
 * Multiline CSS comments preserve state cleanly across indented lines.
 */
.mono-workbench {
  display: flex;
  flex-direction: column;
  background: #18181b;
  color: #e4e4e7;
}

.mono-workbench .editor-pane {
  flex: 1 1 auto;
  border-top: 1px solid #2e2e34;
  font-family: "JetBrains Mono", monospace;
}

.mono-workbench .tab.active {
  border-bottom: 2px solid #0ea5e9;
  color: #ffffff;
}
`,
  },
  html: {
    label: 'HTML',
    code: `<!--
  Mono Editor — Mixed HTML + Embedded <style> (CSS) + <script> (JS / TS)
  Try: Ctrl+Space inside <style> for CSS completions, Ctrl+/ for region-aware comments,
  and click color bullets inside <style> or <script>!
-->
<!doctype html>
<html lang="en">
<head>
  <style>
    /* CSS comment: #ef4444 is ignored unless "Colors in Comments" is enabled */
    :root {
      --surface-bg: #0f172a;
      --accent-sky: #38bdf8;
    }
    .surface-card {
      display: flex;
      background: var(--surface-bg);
      border: 1px solid rgba(56, 189, 248, 0.45);
      color: hsl(210, 40%, 96%);
      accent-color: coral;
      padding: 16px 20px;
    }
    .surface-card:hover {
      border-color: var(--accent-sky);
      box-shadow: 0 8px 24px rgba(14, 165, 233, 0.25);
    }
  </style>
</head>
<body style="background: #18181b; color: #f8fafc;">
  <section class="surface-card">
    <h1>Mono Embedded Languages Demo</h1>
    <button style="background: mediumseagreen; color: white;">Apply Theme</button>
  </section>
  <script type="module">
    // Embedded JavaScript with multiline template interpolation
    const palette = {
      primary: "#0ea5e9",
      success: "rgba(16, 185, 129, 0.9)",
      accent: "hsl(262, 83%, 58%)",
      highlight: "gold",
    };
    function applyPalette(target, name = "Sky") {
      const label = \`Active palette: \${name} (\${palette.primary})\`;
      target.style.borderColor = palette.primary;
      console.log(label);
      return palette.accent;
    }
    applyPalette(document.body);
  </script>
</body>
</html>
`,
  },
  java: {
    label: 'Java',
    code: `/**
 * Folding & bracket matching sample in Java.
 */
public class MonoRunner {
  public static void main(String[] args) {
    String label = "Mono Editor";
    for (int i = 0; i < 3; i++) {
      if (i % 2 == 0) {
        System.out.println(label + " #" + i);
      }
    }
  }
}
`,
  },
  python: {
    label: 'Python',
    code: `# Mono Editor — Python Indentation & Folding Sample

def format_greeting(name: str, count: int = 2) -> list[str]:
    results = []
    for idx in range(count):
        if idx % 2 == 0:
            results.append(f"Hello {name} ({idx})")
    return results


if __name__ == "__main__":
    lines = format_greeting("Mono", 4)
    for line in lines:
        print(line)
`,
  },
  markdown: {
    label: 'Markdown',
    code: `# Mono Editor — Rich Markdown, Math & Mermaid

> Switch between **Code** and **Preview** on mobile, or enjoy the live split pane on desktop.
> \`katex\` and \`mermaid\` live in the optional \`@mono/editor/preview\` entry and lazy-load only when needed.

## 1. LaTeX Math Equations (KaTeX)

Inline physics identity: $E = mc^2$ and Euler's formula $e^{i\\pi} + 1 = 0$.

$$
\\int_{-\\infty}^{\\infty} e^{-x^2}\\,dx = \\sqrt{\\pi}
$$

## 2. Mermaid Architecture Flowchart (\`securityLevel: 'strict'\`)

\`\`\`mermaid
flowchart LR
  A[TextModel] --> B[Monarch Tokenizer]
  B --> C[Interned State IDs]
  B --> D[Language Segments]
  D --> E[Embedded CSS / JS / TS]
  C --> F[5-Level Rainbow Brackets]
\`\`\`

## 3. Syntax-Highlighted Code Fences

\`\`\`ts
export function greet(user: string, score: number): string {
  return \`Welcome \${user} — score: \${score.toFixed(1)}\`;
}
\`\`\`

## 4. Capability Matrix

| Feature | Engine | Bundle Impact |
| :--- | :--- | ---: |
| Multiline \`\${expr}\` & HTML Embed | Stateful Monarch + Interned IDs | Core (0 deps) |
| 5-Level Rainbow Brackets | Incremental Stack + 20k Cutoff | Core (0 deps) |
| KaTeX Math & Mermaid Diagrams | \`@mono/editor/preview\` | Lazy \`import()\` |

- [x] O(1) interned state convergence
- [x] HTML \`<style>\` CSS + \`<script>\` JS/TS embedded features
- [x] Mobile-safe Rename popup with out-of-view draft preservation

## 5. Markdown Sticky Scroll Hierarchy

Scroll down through this section to see \`#\` -> \`##\` -> \`###\` headings pin smoothly at the top of the editor!

### 5.1 Fenced Code Block Guard

\`\`\`bash
# This bash comment starts with '#' and is intentionally IGNORED by Markdown Sticky Scroll!
echo "Sticky scroll stays pinned to 5.1 Fenced Code Block Guard"
\`\`\`

Lorem ipsum dolor sit amet, consectetur adipiscing elit. Keep scrolling to verify that nested headings stay pinned cleanly while code comments inside fenced blocks never hijack the sticky header stack.

### 5.2 Deep Heading Nesting

1. Top-level \`#\` document title stays anchored at slot 0.
2. Parent \`##\` section header stays anchored at slot 1.
3. Active \`###\` subsection header stays anchored at slot 2.
4. Tapping any pinned sticky heading jumps directly to that section.
`,
  },
  yaml: {
    label: 'YAML',
    code: `# Mono Editor Configuration
editor:
  fontFamily: JetBrains Mono
  fontSize: 15
  wordWrap: off
  folding: true
  dynamicCaretColor: true
  scrollbar:
    vertical: auto
    horizontal: auto
    hideVerticalOnScrollEnd: true
    hideHorizontalOnScrollEnd: true
`,
  },
  shell: {
    label: 'Shell',
    code: `#!/usr/bin/env bash
# Mono Editor Shell Script Sample

run_checks() {
  local target="$1"
  if [ -n "$target" ]; then
    echo "Checking $target..."
  fi
}

run_checks "mono-editor"
`,
  },
  sql: {
    label: 'SQL',
    code: `/*
 * Mono Editor SQL Sample
 */
SELECT
  p.id,
  p.title,
  COUNT(e.id) AS event_count
FROM projects p
LEFT JOIN events e
  ON e.project_id = p.id
WHERE p.active = 1
GROUP BY p.id, p.title
ORDER BY event_count DESC;
`,
  },
  c: {
    label: 'C',
    code: `/*
 * Mono Editor C Sample
 */
#include <stdio.h>

int sum_range(int limit) {
  int total = 0;
  for (int i = 1; i <= limit; i++) {
    total += i;
  }
  return total;
}

int main(void) {
  printf("Total: %d\\n", sum_range(10));
  return 0;
}
`,
  },
  cpp: {
    label: 'C++',
    code: `/**
 * Mono Editor C++ Sample
 */
#include <iostream>
#include <vector>

int main() {
  std::vector<int> values = {1, 2, 3, 4};
  int total = 0;
  for (int v : values) {
    total += v;
  }
  std::cout << "Sum = " << total << std::endl;
  return 0;
}
`,
  },
  rust: {
    label: 'Rust',
    code: `// Mono Editor — Rust Sample
#[derive(Debug)]
struct Point { x: f64, y: f64 }

impl Point {
  fn distance(&self) -> f64 {
    (self.x * self.x + self.y * self.y).sqrt()
  }
}

fn main() {
  let origin = Point { x: 3.0, y: 4.0 };
  println!("Distance = {}", origin.distance());
}
`,
  },
  go: {
    label: 'Go',
    code: `// Mono Editor — Go Sample
package main

import "fmt"

type User struct {
  Name string
  Role string
}

func main() {
  u := User{Name: "Mono", Role: "Editor"}
  fmt.Printf("Hello %s (%s)\\n", u.Name, u.Role)
}
`,
  },
  kotlin: {
    label: 'Kotlin',
    code: `// Mono Editor — Kotlin Sample
data class Session(val id: String, val mobile: Boolean = true)

fun main() {
  val s = Session("mono-kt")
  println("Session \${s.id} mobile=\${s.mobile}")
}
`,
  },
  swift: {
    label: 'Swift',
    code: `// Mono Editor — Swift Sample
struct Theme {
  let name: String
  let isHighContrast: Bool
}

let active = Theme(name: "hc-black", isHighContrast: true)
print("Active theme: \\(active.name)")
`,
  },
  php: {
    label: 'PHP',
    code: `<?php
// Mono Editor — PHP Sample
function greet(string $name): string {
  return "Welcome, {$name}!";
}
echo greet("Mono");
`,
  },
  ruby: {
    label: 'Ruby',
    code: `# Mono Editor — Ruby Sample
class Editor
  attr_reader :name
  def initialize(name)
    @name = name
  end
  def hello
    puts "Hello from #{@name}"
  end
end

Editor.new("Mono").hello
`,
  },
  xml: {
    label: 'XML',
    code: `<?xml version="1.0" encoding="UTF-8"?>
<workspace name="mono-editor">
  <feature id="mobile" enabled="true" />
  <feature id="diff" mode="auto" />
</workspace>
`,
  },
  toml: {
    label: 'TOML',
    code: `# Mono Editor — TOML Config
[package]
name = "mono-editor"
version = "1.0.0"

[mobile]
pinch_zoom = true
quick_keys = true
`,
  },
  dockerfile: {
    label: 'Dockerfile',
    code: `# Mono Editor — Dockerfile Sample
FROM node:22-alpine AS builder
WORKDIR /app
COPY package*.json ./
RUN npm ci
COPY . .
RUN npm run build
EXPOSE 3000
CMD ["npm", "run", "preview"]
`,
  },
  plaintext: {
    label: 'Plain Text',
    code: `Mono Editor Plain Text Mode

Try toggling Word Wrap to see how long paragraphs automatically wrap cleanly across the viewport without horizontal scrolling.

বাংলা এবং हिन्दी টেক্সটও সঠিকভাবে র‍্যাপ এবং সিলেক্ট করা যাবে।
`,
  },
};

const LIGHT_THEMES = new Set(['mscode-light', 'solarized-light']);

const appEl = document.getElementById('app')!;
const host = document.getElementById('editor-host')!;

// Create 4 real standalone models backed by TextModel for Multi-Model tab switching
const workspaceModels: Record<string, { model: IStandaloneTextModel; defaultLang: string }> = {
  'app.js': {
    model: editor.createModel(
      LANGUAGE_SAMPLES.javascript!.code,
      'javascript',
      Uri.parse('inmemory://playground/src/app.js'),
    ),
    defaultLang: 'javascript',
  },
  'palette.html': {
    model: editor.createModel(
      LANGUAGE_SAMPLES.html!.code,
      'html',
      Uri.parse('inmemory://playground/web/palette.html'),
    ),
    defaultLang: 'html',
  },
  'styles.css': {
    model: editor.createModel(
      LANGUAGE_SAMPLES.css!.code,
      'css',
      Uri.parse('inmemory://playground/styles/styles.css'),
    ),
    defaultLang: 'css',
  },
  'notes.md': {
    model: editor.createModel(
      LANGUAGE_SAMPLES.markdown!.code,
      'markdown',
      Uri.parse('inmemory://playground/docs/notes.md'),
    ),
    defaultLang: 'markdown',
  },
};

let activeTabKey = 'app.js';

const editorInstance = editor.create(host, {
  model: workspaceModels['app.js']!.model,
  fontFamily: '"JetBrains Mono", ui-monospace, SFMono-Regular, Menlo, Consolas, monospace',
  fontSize: 15,
  lineHeight: 24,
  tabSize: 2,
  lineNumbers: 'on',
  scrollBeyondLastLine: true,
  stickyScroll: { enabled: true },
  quickSuggestions: true,
  suggestOnTriggerCharacters: true,
  autoClosingBrackets: 'languageDefined',
  autoClosingQuotes: 'languageDefined',
  autoSurround: 'languageDefined',
  autoIndent: 'full',
  wordWrap: 'off',
  wrappingIndent: 'same',
  folding: true,
  guides: { indentation: true, highlightActiveIndentation: true },
  matchBrackets: 'always',
  occurrencesHighlight: true,
  dynamicCaretColor: true,
  minimap: { enabled: true, side: 'right', showSlider: 'always' },
  colorDecorators: true,
  glyphMargin: true,
  errorLens: true,
  codeLens: true,
  linkedEditing: true,
  rulers: [80],
  scrollbar: {
    vertical: 'auto',
    horizontal: 'auto',
    hideVerticalOnScrollEnd: true,
    hideHorizontalOnScrollEnd: true,
  },
});

// ── Top Bar, Tabs & Sidebar Elements ─────────────────────────────────────────
const langSelect = document.getElementById('lang-select') as HTMLSelectElement;
const themeSelect = document.getElementById('theme-select') as HTMLSelectElement;
const btnPreview = document.getElementById('btn-preview') as HTMLButtonElement;
const btnFind = document.getElementById('btn-find') as HTMLButtonElement;
const btnFeatures = document.getElementById('btn-features') as HTMLButtonElement;
const btnSidebarClose = document.getElementById('btn-sidebar-close') as HTMLButtonElement;
const sidebar = document.getElementById('sidebar')!;
const backdrop = document.getElementById('drawer-backdrop')!;
const workspaceEl = document.getElementById('workspace')!;
const previewHost = document.getElementById('preview-host')!;
const mdMobileTabs = document.getElementById('md-mobile-tabs')!;
const btnMdCode = document.getElementById('btn-md-code') as HTMLButtonElement;
const btnMdPreview = document.getElementById('btn-md-preview') as HTMLButtonElement;
const modelTabs = Array.from(document.querySelectorAll<HTMLButtonElement>('.model-tab'));

// Feature toggle inputs
const optWordWrap = document.getElementById('opt-word-wrap') as HTMLInputElement;
const optWrapIndent = document.getElementById('opt-wrap-indent') as HTMLSelectElement;
const optFolding = document.getElementById('opt-folding') as HTMLInputElement;
const optGuides = document.getElementById('opt-guides') as HTMLInputElement;
const optActiveGuide = document.getElementById('opt-active-guide') as HTMLInputElement;
const optBrackets = document.getElementById('opt-brackets') as HTMLInputElement;
const optRainbowBrackets = document.getElementById('opt-rainbow-brackets') as HTMLInputElement;
const optRainbowLevels = document.getElementById('opt-rainbow-levels') as HTMLSelectElement;
const optRainbowIndependent = document.getElementById('opt-rainbow-independent') as HTMLInputElement;
const optOccurrences = document.getElementById('opt-occurrences') as HTMLInputElement;
const optScrollbar = document.getElementById('opt-scrollbar') as HTMLSelectElement;
const optHideVScroll = document.getElementById('opt-hide-vscroll') as HTMLInputElement;
const optHideHScroll = document.getElementById('opt-hide-hscroll') as HTMLInputElement;
const optDynamicCaret = document.getElementById('opt-dynamic-caret') as HTMLInputElement;
const optLineNumbersMode = document.getElementById('opt-line-numbers-mode') as HTMLSelectElement;
const optRenderWhitespace = document.getElementById('opt-render-whitespace') as HTMLSelectElement;
const optCursorStyle = document.getElementById('opt-cursor-style') as HTMLSelectElement;
const optGlyphMargin = document.getElementById('opt-glyph-margin') as HTMLInputElement;
const optErrorLens = document.getElementById('opt-error-lens') as HTMLInputElement;
const optCodeLens = document.getElementById('opt-codelens') as HTMLInputElement;
const optMobileKeys = document.getElementById('opt-mobile-keys') as HTMLInputElement;
const btnDiff = document.getElementById('btn-diff') as HTMLButtonElement;
const diffHost = document.getElementById('diff-host')!;
const optStickyScroll = document.getElementById('opt-sticky-scroll') as HTMLInputElement;
const optMinimap = document.getElementById('opt-minimap') as HTMLInputElement;
const optColorBullets = document.getElementById('opt-color-bullets') as HTMLInputElement;
const optColorHover = document.getElementById('opt-color-hover') as HTMLInputElement;
const optColorComments = document.getElementById('opt-color-comments') as HTMLInputElement;
const optColorStyle = document.getElementById('opt-color-style') as HTMLInputElement;
const optColorScript = document.getElementById('opt-color-script') as HTMLInputElement;
const optInlayHints = document.getElementById('opt-inlay-hints') as HTMLInputElement;
const optInlayClick = document.getElementById('opt-inlay-click') as HTMLSelectElement;
const optInlineSuggest = document.getElementById('opt-inline-suggest') as HTMLInputElement;
const optSemanticTokens = document.getElementById('opt-semantic-tokens') as HTMLInputElement;
const optScrollBeyond = document.getElementById('opt-scroll-beyond') as HTMLInputElement;
const optQuickSuggest = document.getElementById('opt-quick-suggest') as HTMLInputElement;
const optSuggestMode = document.getElementById('opt-suggest-mode') as HTMLSelectElement;
const optSuggestDocs = document.getElementById('opt-suggest-docs') as HTMLSelectElement;
const optSigTrigger = document.getElementById('opt-sig-trigger') as HTMLSelectElement;
const optHoverTrigger = document.getElementById('opt-hover-trigger') as HTMLSelectElement;
const optDiagPopup = document.getElementById('opt-diag-popup') as HTMLSelectElement;
const optCtxEnabled = document.getElementById('opt-ctx-enabled') as HTMLInputElement;
const optCtxType = document.getElementById('opt-ctx-type') as HTMLSelectElement;
const optCtxAnim = document.getElementById('opt-ctx-anim') as HTMLSelectElement;
const optAutoBrackets = document.getElementById('opt-auto-brackets') as HTMLInputElement;
const optAutoQuotes = document.getElementById('opt-auto-quotes') as HTMLInputElement;
const optAutoSurround = document.getElementById('opt-auto-surround') as HTMLInputElement;
const optAutoIndent = document.getElementById('opt-auto-indent') as HTMLInputElement;
const optReadOnly = document.getElementById('opt-read-only') as HTMLInputElement;
const optTabSize = document.getElementById('opt-tab-size') as HTMLSelectElement;
const optFontSize = document.getElementById('opt-font-size') as HTMLSelectElement;
const optEol = document.getElementById('opt-eol') as HTMLSelectElement;
const optLineMinChars = document.getElementById('opt-line-min-chars') as HTMLSelectElement;
const optMinimapSide = document.getElementById('opt-minimap-side') as HTMLSelectElement;
const optUndoGroup = document.getElementById('opt-undo-group') as HTMLSelectElement;

// Action buttons
const actCommentLine = document.getElementById('act-comment-line') as HTMLButtonElement;
const actCommentBlock = document.getElementById('act-comment-block') as HTMLButtonElement;
const actFoldAll = document.getElementById('act-fold-all') as HTMLButtonElement;
const actUnfoldAll = document.getElementById('act-unfold-all') as HTMLButtonElement;
const actFormat = document.getElementById('act-format') as HTMLButtonElement;
const actRename = document.getElementById('act-rename') as HTMLButtonElement;
const actReferences = document.getElementById('act-references') as HTMLButtonElement;
const actQuickFix = document.getElementById('act-quickfix') as HTMLButtonElement;
const actNextMatch = document.getElementById('act-next-match') as HTMLButtonElement;
const actCursorBelow = document.getElementById('act-cursor-below') as HTMLButtonElement;
const actSigHelp = document.getElementById('act-sighelp') as HTMLButtonElement;
const actGhostPreview = document.getElementById('act-ghost-preview') as HTMLButtonElement;
const actShowHover = document.getElementById('act-show-hover') as HTMLButtonElement;
const actSmartExpand = document.getElementById('act-smart-expand') as HTMLButtonElement;
const actSmartShrink = document.getElementById('act-smart-shrink') as HTMLButtonElement;
const actDiagnostics = document.getElementById('act-diagnostics') as HTMLButtonElement;
const actReset = document.getElementById('act-reset') as HTMLButtonElement;
const actUndo = document.getElementById('act-undo') as HTMLButtonElement;
const actRedo = document.getElementById('act-redo') as HTMLButtonElement;
const actSuggest = document.getElementById('act-suggest') as HTMLButtonElement;
const actDefinition = document.getElementById('act-definition') as HTMLButtonElement;
const actReplace = document.getElementById('act-replace') as HTMLButtonElement;
const actSelectAllOcc = document.getElementById('act-select-all-occ') as HTMLButtonElement;
const actSample10 = document.getElementById('act-sample-10') as HTMLButtonElement;
const actSample1000 = document.getElementById('act-sample-1000') as HTMLButtonElement;

// Status bar items
const stPos = document.getElementById('st-pos')!;
const stFolded = document.getElementById('st-folded')!;
const stDiag = document.getElementById('st-diag')!;
const stEol = document.getElementById('st-eol')!;
const stSpaces = document.getElementById('st-spaces')!;
const stWrap = document.getElementById('st-wrap')!;
const stLang = document.getElementById('st-lang')!;

let diagnosticsActive = false;

function refreshStatus(): void {
  const pos = editorInstance.getPosition();
  const sel = editorInstance.getSelection();
  const allSels = editorInstance.getSelections();
  const model = editorInstance.getModel();
  const hasSel =
    sel.startLineNumber !== sel.endLineNumber || sel.startColumn !== sel.endColumn;
  const cursorSuffix = allSels.length > 1 ? ` · ${allSels.length} cursors` : '';
  if (hasSel) {
    const len =
      model.getOffsetAt({ lineNumber: sel.endLineNumber, column: sel.endColumn }) -
      model.getOffsetAt({ lineNumber: sel.startLineNumber, column: sel.startColumn });
    stPos.innerHTML = `Ln <strong>${pos.lineNumber}</strong>, Col <strong>${pos.column}</strong> (${Math.max(0, len)} sel${cursorSuffix})`;
  } else {
    stPos.innerHTML = `Ln <strong>${pos.lineNumber}</strong>, Col <strong>${pos.column}</strong>${cursorSuffix}`;
  }
  const folded = editorInstance.getFoldedCount?.() ?? 0;
  stFolded.innerHTML = `Folded: <strong>${folded}</strong>`;
  const markerCount = editorInstance.getModelMarkers().length;
  stDiag.innerHTML = `Markers: <strong>${markerCount}</strong>`;

  const eol = model.getEOL?.() === '\r\n' ? 'CRLF' : 'LF';
  stEol.innerHTML = `<strong>${eol}</strong>`;
  optEol.value = eol;

  const langId = editorInstance.getLanguageId();
  const sample = LANGUAGE_SAMPLES[langId];
  stLang.innerHTML = `<strong>${sample?.label ?? langId}</strong>`;
  if ([...langSelect.options].some((o) => o.value === langId)) {
    langSelect.value = langId;
  }
}

// ── Lazy-Loaded Markdown Preview (@mono/editor/preview) ──────────────────────
type PreviewHandle = {
  setMarkdown(md: string): void;
  setTheme(theme: Record<string, unknown>): void;
  dispose(): void;
};
let mdPreview: PreviewHandle | null = null;
let mdPreviewLoading = false;
let desktopPreviewOpen = true;
let mobileMdView: 'code' | 'preview' = 'code';

async function ensurePreviewMounted(): Promise<PreviewHandle | null> {
  if (mdPreview) return mdPreview;
  if (mdPreviewLoading) return null;
  mdPreviewLoading = true;
  try {
    const mod = await import('../src/preview');
    const { monoThemeService } = await import('../src/index');
    mdPreview = mod.createMarkdownPreview(previewHost, {
      theme: monoThemeService.toPartialEditorTheme(),
      debounceMs: 120,
    });
    mdPreview.setMarkdown(editorInstance.getValue());
    return mdPreview;
  } finally {
    mdPreviewLoading = false;
  }
}

function syncMarkdownPreviewLayout(): void {
  const isMd = editorInstance.getLanguageId() === 'markdown';
  const isMobile = window.innerWidth <= 840;
  btnPreview.style.display = isMd && !isMobile ? 'inline-flex' : 'none';
  mdMobileTabs.classList.toggle('visible', isMd && isMobile);

  if (!isMd) {
    workspaceEl.classList.remove('preview-split', 'mobile-view-code', 'mobile-view-preview');
    btnPreview.classList.remove('active');
    requestAnimationFrame(() => editorInstance.layout());
    return;
  }

  if (isMobile) {
    workspaceEl.classList.remove('preview-split');
    workspaceEl.classList.toggle('mobile-view-code', mobileMdView === 'code');
    workspaceEl.classList.toggle('mobile-view-preview', mobileMdView === 'preview');
    btnMdCode.classList.toggle('active', mobileMdView === 'code');
    btnMdPreview.classList.toggle('active', mobileMdView === 'preview');
    if (mobileMdView === 'preview') {
      void ensurePreviewMounted().then((p) => p?.setMarkdown(editorInstance.getValue()));
    }
  } else {
    workspaceEl.classList.remove('mobile-view-code', 'mobile-view-preview');
    workspaceEl.classList.toggle('preview-split', desktopPreviewOpen);
    btnPreview.classList.toggle('active', desktopPreviewOpen);
    if (desktopPreviewOpen) {
      void ensurePreviewMounted().then((p) => p?.setMarkdown(editorInstance.getValue()));
    }
  }
  requestAnimationFrame(() => editorInstance.layout());
}

btnPreview.addEventListener('click', () => {
  desktopPreviewOpen = !desktopPreviewOpen;
  syncMarkdownPreviewLayout();
});
btnMdCode.addEventListener('click', () => {
  mobileMdView = 'code';
  syncMarkdownPreviewLayout();
});
btnMdPreview.addEventListener('click', () => {
  mobileMdView = 'preview';
  syncMarkdownPreviewLayout();
});
window.addEventListener('resize', () => syncMarkdownPreviewLayout());

// Multi-Model Tab Switcher
for (const tab of modelTabs) {
  tab.addEventListener('click', () => {
    const key = tab.dataset.modelKey;
    if (!key || !workspaceModels[key] || key === activeTabKey) return;
    activeTabKey = key;
    for (const t of modelTabs) t.classList.toggle('active', t.dataset.modelKey === key);
    editorInstance.setModel?.(workspaceModels[key]!.model);
    refreshStatus();
    syncMarkdownPreviewLayout();
  });
}

// Collapse sidebar by default on narrow mobile screens
let sidebarOpen = window.innerWidth > 840;
function syncSidebar(): void {
  sidebar.classList.toggle('collapsed', !sidebarOpen);
  btnFeatures.classList.toggle('active', sidebarOpen);
  backdrop.classList.toggle('hidden', !sidebarOpen);
  requestAnimationFrame(() => editorInstance.layout());
}
syncSidebar();

btnFeatures.addEventListener('click', () => {
  sidebarOpen = !sidebarOpen;
  syncSidebar();
});
btnSidebarClose.addEventListener('click', () => {
  sidebarOpen = false;
  syncSidebar();
});
backdrop.addEventListener('click', () => {
  sidebarOpen = false;
  syncSidebar();
});

btnFind.addEventListener('click', () => {
  editorInstance.revealFind?.();
});

// Language & Theme selectors
langSelect.addEventListener('change', () => {
  const id = langSelect.value;
  const sample = LANGUAGE_SAMPLES[id] ?? LANGUAGE_SAMPLES.plaintext!;
  diagnosticsActive = false;
  actDiagnostics.classList.remove('active');
  editorInstance.setModelMarkers('playground', []);
  editorInstance.setLanguageId(id);
  editorInstance.setValue(sample.code);
  refreshStatus();
  syncMarkdownPreviewLayout();
});

themeSelect.addEventListener('change', () => {
  const id = themeSelect.value;
  if ((BUILTIN_THEME_IDS as readonly string[]).includes(id)) {
    editorInstance.setTheme(id);
    appEl.setAttribute('data-theme-mode', LIGHT_THEMES.has(id) ? 'light' : 'dark');
    if (mdPreview) {
      void import('../src/index').then(({ monoThemeService }) => {
        mdPreview?.setTheme(monoThemeService.toPartialEditorTheme(id) as Record<string, unknown>);
      });
    }
  }
});

// Feature Toggle Handlers
optWordWrap.addEventListener('change', () => {
  const mode: WordWrapMode = optWordWrap.checked ? 'on' : 'off';
  editorInstance.updateOptions({ wordWrap: mode });
  stWrap.innerHTML = `Wrap: <strong>${mode === 'on' ? 'On' : 'Off'}</strong>`;
});

optWrapIndent.addEventListener('change', () => {
  editorInstance.updateOptions({ wrappingIndent: optWrapIndent.value as WrappingIndentMode });
});

optFolding.addEventListener('change', () => {
  editorInstance.updateOptions({ folding: optFolding.checked });
  refreshStatus();
});

const syncGuides = () => {
  editorInstance.updateOptions({
    guides: {
      indentation: optGuides.checked,
      highlightActiveIndentation: optActiveGuide.checked,
    },
  });
};
optGuides.addEventListener('change', syncGuides);
optActiveGuide.addEventListener('change', syncGuides);

optBrackets.addEventListener('change', () => {
  editorInstance.updateOptions({ matchBrackets: optBrackets.checked ? 'always' : 'never' });
});

const syncRainbowBrackets = () => {
  editorInstance.updateOptions({
    bracketPairColorization: {
      enabled: optRainbowBrackets.checked,
      maxLevels: Number(optRainbowLevels.value) || 5,
      independentColorPoolPerBracketType: optRainbowIndependent.checked,
    },
  });
};
optRainbowBrackets.addEventListener('change', syncRainbowBrackets);
optRainbowLevels.addEventListener('change', syncRainbowBrackets);
optRainbowIndependent.addEventListener('change', syncRainbowBrackets);

optOccurrences.addEventListener('change', () => {
  editorInstance.updateOptions({ occurrencesHighlight: optOccurrences.checked });
});

const syncScrollbarOptions = () => {
  const vis = optScrollbar.value as ScrollbarVisibility;
  editorInstance.updateOptions({
    scrollbar: {
      vertical: vis,
      horizontal: vis,
      hideVerticalOnScrollEnd: optHideVScroll.checked,
      hideHorizontalOnScrollEnd: optHideHScroll.checked,
    },
  });
};
optScrollbar.addEventListener('change', syncScrollbarOptions);
optHideVScroll.addEventListener('change', syncScrollbarOptions);
optHideHScroll.addEventListener('change', syncScrollbarOptions);

optDynamicCaret.addEventListener('change', () => {
  editorInstance.updateOptions({ dynamicCaretColor: optDynamicCaret.checked });
});

optLineNumbersMode.addEventListener('change', () => {
  editorInstance.updateOptions({ lineNumbers: optLineNumbersMode.value as MonoLineNumbers });
});

optRenderWhitespace.addEventListener('change', () => {
  editorInstance.updateOptions({ renderWhitespace: optRenderWhitespace.value as RenderWhitespaceMode });
});

optCursorStyle.addEventListener('change', () => {
  editorInstance.updateOptions({ cursorStyle: optCursorStyle.value as CursorStyleMode });
});

optGlyphMargin.addEventListener('change', () => {
  editorInstance.updateOptions({ glyphMargin: optGlyphMargin.checked });
});

optErrorLens.addEventListener('change', () => {
  editorInstance.updateOptions({ errorLens: optErrorLens.checked });
});

optCodeLens.addEventListener('change', () => {
  editorInstance.updateOptions({ codeLens: optCodeLens.checked });
});

optMobileKeys.addEventListener('change', () => {
  editorInstance.updateOptions({ mobileQuickKeys: optMobileKeys.checked });
});

// Click left glyph margin to toggle red breakpoint circles
const breakpoints = new Set<number>([10]);
const bpCollection = editorInstance.createDecorationsCollection();
const syncBreakpoints = () => {
  bpCollection.set(
    [...breakpoints].map((ln) => ({
      range: { startLineNumber: ln, startColumn: 1, endLineNumber: ln, endColumn: 1 },
      options: { glyphMarginColor: '#ef4444', isWholeLine: true },
    })),
  );
};
syncBreakpoints();
editorInstance.onMouseDown((ev) => {
  if (ev.target.type === MouseTargetType.GUTTER_GLYPH_MARGIN && ev.target.position) {
    const ln = ev.target.position.lineNumber;
    if (breakpoints.has(ln)) breakpoints.delete(ln);
    else breakpoints.add(ln);
    syncBreakpoints();
  }
});

// Dual-MonoEditor Diff Editor toggle (auto inline < 900px, side-by-side >= 900px, editable modified pane)
let diffOpen = false;
let diffEditor: IMonoDiffEditor | null = null;
btnDiff.addEventListener('click', () => {
  diffOpen = !diffOpen;
  btnDiff.classList.toggle('active', diffOpen);
  workspaceEl.classList.toggle('diff-mode', diffOpen);
  if (diffOpen) {
    if (!diffEditor) diffEditor = editor.createDiffEditor(diffHost, { readOnly: false });
    const langId = editorInstance.getLanguageId();
    const currentText = editorInstance.getValue();
    let baseText = (LANGUAGE_SAMPLES[langId] ?? LANGUAGE_SAMPLES.javascript!).code;
    if (baseText === currentText) {
      const lines = currentText.split('\n');
      const longOrig =
        '// Long single-line benchmark for independent horizontal scrolling across split diff panes without text overlap: ' +
        'const pipelineConfig = { renderer: "canvas2d", syncVerticalScroll: true, independentHorizontalScroll: true, tokenDiff: "advanced", editableModifiedPane: true };';
      const origLines = lines.map((line, i) => (i === 0 ? `${line} (baseline)` : line));
      origLines.splice(Math.min(3, origLines.length), 0, longOrig);
      baseText = origLines.join('\n');
    }
    const origModel = editor.createModel(baseText, langId);
    diffEditor.setModel({ original: origModel, modified: editorInstance.getModel() });
    requestAnimationFrame(() => diffEditor?.layout());
  } else {
    requestAnimationFrame(() => editorInstance.layout());
  }
});

optStickyScroll.addEventListener('change', () => {
  editorInstance.updateOptions({ stickyScroll: { enabled: optStickyScroll.checked } });
});

optMinimap.addEventListener('change', () => {
  editorInstance.updateOptions({
    minimap: { enabled: optMinimap.checked, side: optMinimapSide.value === 'left' ? 'left' : 'right', showSlider: 'always' },
  });
});

const syncColorRules = () => {
  editorInstance.updateOptions({
    colorDecorators: optColorBullets.checked,
    colorDecoratorsOpenOnHover: optColorHover.checked,
    colorDecoratorsRules: {
      allowInComments: optColorComments.checked,
      embeddedScopes: {
        styleTag: {
          enabled: optColorStyle.checked,
          context: 'all',
          allowInComments: optColorComments.checked,
        },
        scriptTag: {
          enabled: optColorScript.checked,
          context: 'stringsOnly',
          allowInComments: optColorComments.checked,
        },
      },
    },
  });
};
optColorBullets.addEventListener('change', syncColorRules);
optColorHover.addEventListener('change', syncColorRules);
optColorComments.addEventListener('change', syncColorRules);
optColorStyle.addEventListener('change', syncColorRules);
optColorScript.addEventListener('change', syncColorRules);

const syncInlayHints = () => {
  editorInstance.updateOptions({
    inlayHints: {
      enabled: optInlayHints.checked,
      onClick: optInlayClick.value as 'placeCursor' | 'bubble' | 'none',
    },
  });
};
optInlayHints.addEventListener('change', syncInlayHints);
optInlayClick.addEventListener('change', syncInlayHints);

optInlineSuggest.addEventListener('change', () => {
  editorInstance.updateOptions({ inlineSuggest: { enabled: optInlineSuggest.checked } });
});

optSemanticTokens.addEventListener('change', () => {
  editorInstance.updateOptions({ semanticHighlighting: { enabled: optSemanticTokens.checked } });
});

optScrollBeyond.addEventListener('change', () => {
  editorInstance.updateOptions({ scrollBeyondLastLine: optScrollBeyond.checked });
});

const syncSuggestOptions = () => {
  editorInstance.updateOptions({
    quickSuggestions: optQuickSuggest.checked,
    suggest: {
      mode: optSuggestMode.value as 'palette' | 'ghost',
      docs: optSuggestDocs.value as 'off' | 'auto' | 'side' | 'below',
    },
  });
};
optQuickSuggest.addEventListener('change', syncSuggestOptions);
optSuggestMode.addEventListener('change', syncSuggestOptions);
optSuggestDocs.addEventListener('change', syncSuggestOptions);

optSigTrigger.addEventListener('change', () => {
  const v = optSigTrigger.value;
  editorInstance.updateOptions({
    signatureHelp:
      v === 'off'
        ? { enabled: false, trigger: 'manual' }
        : { enabled: true, trigger: v as 'auto' | 'manual' },
  });
});

optHoverTrigger.addEventListener('change', () => {
  const v = optHoverTrigger.value;
  editorInstance.updateOptions({
    hover: {
      enabled: v !== 'off',
      trigger: v === 'auto' ? undefined : (v as 'click' | 'hover' | 'off'),
    },
  });
});

optDiagPopup.addEventListener('change', () => {
  const v = optDiagPopup.value;
  editorInstance.updateOptions({
    diagnostics: {
      popup: v === 'auto' ? undefined : (v as 'click' | 'hover' | 'off'),
    },
  });
});

const syncContextMenuOptions = () => {
  editorInstance.updateOptions({
    contextMenu: {
      enabled: optCtxEnabled.checked,
      type: optCtxType.value as 'horizontal' | 'vertical',
      animation: optCtxAnim.value as 'cascade' | 'smooth' | 'none',
    },
  });
};
optCtxEnabled.addEventListener('change', syncContextMenuOptions);
optCtxType.addEventListener('change', syncContextMenuOptions);
optCtxAnim.addEventListener('change', syncContextMenuOptions);

optAutoBrackets.addEventListener('change', () => {
  editorInstance.updateOptions({
    autoClosingBrackets: optAutoBrackets.checked ? 'languageDefined' : 'never',
  });
});

optAutoQuotes.addEventListener('change', () => {
  editorInstance.updateOptions({
    autoClosingQuotes: optAutoQuotes.checked ? 'languageDefined' : 'never',
  });
});

optAutoSurround.addEventListener('change', () => {
  editorInstance.updateOptions({
    autoSurround: optAutoSurround.checked ? 'languageDefined' : 'never',
  });
});

optAutoIndent.addEventListener('change', () => {
  editorInstance.updateOptions({ autoIndent: optAutoIndent.checked ? 'full' : 'none' });
});

optReadOnly.addEventListener('change', () => {
  editorInstance.updateOptions({ readOnly: optReadOnly.checked });
});

optTabSize.addEventListener('change', () => {
  const size = Number(optTabSize.value) || 2;
  editorInstance.updateOptions({ tabSize: size });
  stSpaces.innerHTML = `Spaces: <strong>${size}</strong>`;
});

optFontSize.addEventListener('change', () => {
  const size = Number(optFontSize.value) || 15;
  editorInstance.updateOptions({ fontSize: size, lineHeight: Math.round(size * 1.55) });
});

optEol.addEventListener('change', () => {
  const model = editorInstance.getModel();
  model.setEOL?.(optEol.value === 'CRLF' ? EndOfLineSequence.CRLF : EndOfLineSequence.LF);
  refreshStatus();
});

// Quick Action & LSP Buttons
actCommentLine.addEventListener('click', () => {
  void editorInstance.executeCommand?.(MonoCommands.CommentLine);
  editorInstance.focus();
});

actCommentBlock.addEventListener('click', () => {
  void editorInstance.executeCommand?.(MonoCommands.BlockComment);
  editorInstance.focus();
});

actFoldAll.addEventListener('click', () => {
  editorInstance.foldAll?.();
  refreshStatus();
});

actUnfoldAll.addEventListener('click', () => {
  editorInstance.unfoldAll?.();
  refreshStatus();
});

actFormat.addEventListener('click', () => {
  void editorInstance.executeCommand?.(MonoCommands.FormatDocument);
  editorInstance.focus();
});

actRename.addEventListener('click', () => {
  void editorInstance.executeCommand?.(MonoCommands.Rename);
});

actReferences.addEventListener('click', () => {
  void editorInstance.executeCommand?.(MonoCommands.ReferenceSearch);
});

actQuickFix.addEventListener('click', () => {
  void editorInstance.executeCommand?.(MonoCommands.QuickFix);
});

actNextMatch.addEventListener('click', () => {
  void editorInstance.executeCommand?.(MonoCommands.AddSelectionToNextFindMatch);
  editorInstance.focus();
});

actCursorBelow.addEventListener('click', () => {
  void editorInstance.executeCommand?.(MonoCommands.InsertCursorBelow);
  editorInstance.focus();
});

actSigHelp.addEventListener('click', () => {
  void editorInstance.executeCommand?.(MonoCommands.TriggerParameterHints);
});

actGhostPreview.addEventListener('click', () => {
  const existing = editorInstance.getGhostTexts('playground-demo');
  if (existing.length > 0) {
    editorInstance.clearGhostTexts('playground-demo');
    actGhostPreview.classList.remove('active');
    return;
  }
  const pos = editorInstance.getPosition();
  editorInstance.setGhostTexts([
    {
      id: 'demo-ghost-1',
      owner: 'playground-demo',
      lineNumber: pos.lineNumber,
      column: pos.column,
      text:
        ' // AI multiline ghost preview (Tab to accept, Ctrl+Right word, Esc dismiss)\n' +
        '  const telemetry = { editor: "Mono", wrapAware: true, multiAnchor: "Copilot/Codex ready" };\n' +
        '  console.info("Ghost accepted:", telemetry);',
      autoClearOnEdit: false,
    },
  ]);
  actGhostPreview.classList.add('active');
  editorInstance.focus();
});

actShowHover.addEventListener('click', () => {
  void editorInstance.executeCommand?.(MonoCommands.ShowHover);
});

actSmartExpand.addEventListener('click', () => {
  void editorInstance.executeCommand?.(MonoCommands.SmartSelectExpand);
  editorInstance.focus();
});

actSmartShrink.addEventListener('click', () => {
  void editorInstance.executeCommand?.(MonoCommands.SmartSelectShrink);
  editorInstance.focus();
});

actDiagnostics.addEventListener('click', () => {
  diagnosticsActive = !diagnosticsActive;
  actDiagnostics.classList.toggle('active', diagnosticsActive);
  if (!diagnosticsActive) {
    editorInstance.setModelMarkers('playground', []);
  } else {
    const model = editorInstance.getModel();
    const total = model.getLineCount();
    const l1 = Math.min(6, total);
    const l2 = Math.min(Math.max(2, Math.floor(total * 0.45)), total);
    const l3 = Math.min(Math.max(3, total - 2), total);
    const lineLen = (ln: number) => Math.max(2, model.getLineContent(ln).length + 1);
    editorInstance.setModelMarkers('playground', [
      {
        startLineNumber: l1,
        startColumn: 1,
        endLineNumber: l1,
        endColumn: Math.min(22, lineLen(l1)),
        message: "Prefer 'const' over 'var' — press Ctrl+. for Quick Fix",
        severity: MarkerSeverity.Warning,
      },
      {
        startLineNumber: l2,
        startColumn: 1,
        endLineNumber: l2,
        endColumn: Math.min(24, lineLen(l2)),
        message: 'Sample Info diagnostic — visible in editor & scrollbar overview',
        severity: MarkerSeverity.Info,
      },
      {
        startLineNumber: l3,
        startColumn: 1,
        endLineNumber: l3,
        endColumn: Math.min(20, lineLen(l3)),
        message: 'Sample Error diagnostic — red squiggle + scrollbar overview tick',
        severity: MarkerSeverity.Error,
      },
    ]);
  }
  refreshStatus();
});

actReset.addEventListener('click', () => {
  const id = langSelect.value;
  const sample = LANGUAGE_SAMPLES[id] ?? LANGUAGE_SAMPLES.javascript!;
  diagnosticsActive = false;
  actDiagnostics.classList.remove('active');
  editorInstance.setModelMarkers('playground', []);
  editorInstance.setValue(sample.code);
  refreshStatus();
});

// ── Recent features: gutter width, minimap side, undo grouping, sticky + Find demos ──
optLineMinChars.addEventListener('change', () => {
  editorInstance.updateOptions({ lineNumbersMinChars: Number(optLineMinChars.value) || 2 });
});

optMinimapSide.addEventListener('change', () => {
  editorInstance.updateOptions({
    minimap: {
      enabled: optMinimap.checked,
      side: optMinimapSide.value === 'left' ? 'left' : 'right',
      showSlider: 'always',
    },
  });
});

optUndoGroup.addEventListener('change', () => {
  editorInstance.updateOptions({ undoGroupIdleMs: Number(optUndoGroup.value) });
});

const runCommand = (id: string) => {
  void editorInstance.executeCommand?.(id);
  editorInstance.focus();
};
actUndo.addEventListener('click', () => runCommand(MonoCommands.Undo));
actRedo.addEventListener('click', () => runCommand(MonoCommands.Redo));
actSuggest.addEventListener('click', () => runCommand('editor.action.triggerSuggest'));
actDefinition.addEventListener('click', () => runCommand(MonoCommands.RevealDefinition));
actSelectAllOcc.addEventListener('click', () => runCommand(MonoCommands.SelectHighlights));
actReplace.addEventListener('click', () => {
  editorInstance.revealReplace?.();
});
document.getElementById('act-goto-line')?.addEventListener('click', () => runCommand(MonoCommands.GoToLine));
document.getElementById('act-goto-symbol')?.addEventListener('click', () => runCommand(MonoCommands.GoToSymbol));
document.getElementById('act-peek-def')?.addEventListener('click', () => runCommand(MonoCommands.PeekDefinition));
document.getElementById('act-sort-lines')?.addEventListener('click', () => runCommand(MonoCommands.SortLinesAscending));
document.getElementById('act-join-lines')?.addEventListener('click', () => runCommand(MonoCommands.JoinLines));
document.getElementById('act-trim-ws')?.addEventListener('click', () => runCommand(MonoCommands.TrimTrailingWhitespace));

/** 1000 lines of nested classes/functions: exercises Sticky Scroll headers while Find is open. */
function buildLongSample(): string {
  const out: string[] = ['// 1000-line sample — scroll down, then open Find (Ctrl+F) to check Sticky Scroll'];
  let n = 0;
  while (out.length < 1000) {
    n++;
    out.push(`class Service${n} {`);
    for (let m = 1; m <= 4; m++) {
      out.push(`  method${m}(input) {`);
      out.push(`    if (input > ${n * m}) {`);
      out.push(`      for (let i = 0; i < input; i++) {`);
      out.push(`        console.log("Service${n}.method${m}", i);`);
      out.push('      }');
      out.push('    }');
      out.push('    return input;');
      out.push('  }');
    }
    out.push('}');
    out.push('');
  }
  return out.slice(0, 1000).join('\n');
}

function loadSample(code: string): void {
  if (langSelect.value !== 'javascript') {
    langSelect.value = 'javascript';
    langSelect.dispatchEvent(new Event('change'));
  }
  editorInstance.setValue(code);
  editorInstance.setScrollTop?.(0);
  editorInstance.focus();
  refreshStatus();
}
actSample10.addEventListener('click', () =>
  loadSample(Array.from({ length: 10 }, (_, i) => `const line${i + 1} = ${i + 1};`).join('\n')),
);
actSample1000.addEventListener('click', () => loadSample(buildLongSample()));

editorInstance.onDidChangeModelContent(({ value }) => {
  if (editorInstance.getLanguageId() === 'markdown' && mdPreview) {
    mdPreview.setMarkdown(value);
  }
});
editorInstance.onDidChangeCursorPosition(() => refreshStatus());
editorInstance.onDidChangeCursorSelection(() => refreshStatus());
editorInstance.onDidChangeModel?.(() => {
  refreshStatus();
  syncMarkdownPreviewLayout();
});
refreshStatus();
syncMarkdownPreviewLayout();

// Expose pure Mono globals for console inspection
(window as any).monoEditor = editorInstance;
(window as any).mono = { editor, languages };
