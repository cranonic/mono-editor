// Auto-split from LspProviders.ts
import * as monaco from '@/core/mono';
import type { LspState } from '../types';
import { sendRequest, sendNotify } from '../LspTransport';
import { getDocUri } from '../utils/uriHelpers';
import { completionKind } from './helpers';
import {
  HTML_EMMET_TRIGGER_CHARACTERS,
  HTML_LS_TRIGGER_CHARACTERS,
  htmlEmmetSuggestions,
  htmlLocationAt,
} from './htmlEmmet';

const VOID_TAGS = new Set([
  'area', 'base', 'br', 'col', 'embed', 'hr', 'img', 'input', 'link', 'meta',
  'param', 'source', 'track', 'wbr',
]);

function isHtmlLang(id: string): boolean {
  return id === 'html' || id === 'handlebars' || id === 'razor';
}

/** After `<div` / `<p` — turn bare tag name insert into `<tag>$0</tag>` snippet */
function closeTagSnippet(tagName: string): string {
  const t = tagName.replace(/^<\/?/, '').replace(/>$/, '').trim();
  if (!t || /\s/.test(t)) return tagName;
  const base = t.split(/[\s./]/)[0];
  if (VOID_TAGS.has(base.toLowerCase())) {
    return `${base}>`;
  }
  return `${base}>$0</${base}>`;
}

function serverTriggerCharacters(state: LspState, html: boolean): string[] {
  const caps = state.serverCapabilities as { completionProvider?: { triggerCharacters?: string[] } };
  const fromServer = caps?.completionProvider?.triggerCharacters;
  if (Array.isArray(fromServer) && fromServer.length) return fromServer;
  return html ? [...HTML_LS_TRIGGER_CHARACTERS] : ['.', ':', '/', '<', '"', "'"];
}

/** Offset of (line, column) — `ModelLike.getOffsetAt` is optional, so fall back to counting lines. */
function offsetAt(model: any, text: string, line: number, column: number): number {
  if (typeof model.getOffsetAt === 'function') return model.getOffsetAt(line, column);
  let off = 0;
  for (let l = 1; l < line; l++) off += (model.getLineContent(l) as string).length + 1;
  return Math.min(text.length, off + column - 1);
}

/** Emmet in HTML — independent of the language server, so it works even before/without it. */
function registerHtmlEmmet(state: LspState): void {
  state.disposables.push(
    monaco.languages.registerCompletionItemProvider(state.languageId, {
      triggerCharacters: [...HTML_EMMET_TRIGGER_CHARACTERS],
      provideCompletionItems: (model, position) => {
        try {
          const text = model.getValue() as string;
          const offset = offsetAt(model, text, position.lineNumber, position.column);
          const loc = htmlLocationAt(text, offset);
          const line = model.getLineContent(position.lineNumber);
          const items = htmlEmmetSuggestions(line, position.column, loc);
          return {
            incomplete: false,
            suggestions: items.map((e) => ({
              label: { label: e.label, description: 'Emmet' },
              kind: monaco.languages.CompletionItemKind.Property,
              detail: e.detail,
              documentation: e.documentation ? { value: e.documentation } : undefined,
              insertText: e.insertText,
              insertTextRules: monaco.languages.CompletionItemInsertTextRule.InsertAsSnippet,
              range: {
                startLineNumber: position.lineNumber,
                endLineNumber: position.lineNumber,
                startColumn: e.startColumn,
                endColumn: e.endColumn,
              },
              sortText: e.sortText ?? '0_' + e.label,
              filterText: e.filterText ?? e.label,
            })),
          };
        } catch {
          return { suggestions: [] };
        }
      },
    }),
  );
}

export function registerCompletion(state: LspState): void {
  const langId = state.languageId;
  const html = isHtmlLang(langId);
  if (html) registerHtmlEmmet(state);

  state.disposables.push(
    monaco.languages.registerCompletionItemProvider(langId, {
      // Server-advertised trigger characters (initialize result). HTML falls back to the characters of
      // vscode-html-languageserver. Emmet has its own provider below, so operator characters such as
      // `>` `!` `*` `+` never open the list from here (typing `=>` must not pop a palette).
      triggerCharacters: serverTriggerCharacters(state, html),

      provideCompletionItems: async (model, position, context) => {
        if (!state.initialized) return { suggestions: [] };

        try {
          const line = model.getLineContent(position.lineNumber);
          const textBefore = line.substring(0, position.column - 1);

          // JIT sync
          sendNotify(state, 'textDocument/didChange', {
            textDocument:   { uri: getDocUri(model, state), version: model.getVersionId() },
            contentChanges: [{ text: model.getValue() }],
          });

          let triggerKind = 1;
          if (context.triggerKind === monaco.languages.CompletionTriggerKind.TriggerCharacter)
            triggerKind = 2;
          else if (context.triggerKind === monaco.languages.CompletionTriggerKind.TriggerForIncompleteCompletions)
            triggerKind = 3;

          const result: any = await sendRequest(state, 'textDocument/completion', {
            textDocument: { uri: getDocUri(model, state) },
            position:     { line: position.lineNumber - 1, character: position.column - 1 },
            context:      { triggerKind, triggerCharacter: context.triggerCharacter },
          });

          const items = Array.isArray(result) ? result : result?.items ?? [];
          const inOpenTag = /<[\w:-]*$/.test(textBefore);

          const lspSuggestions: monaco.languages.CompletionItem[] = items.map((item: any) => {
            let range: monaco.IRange | undefined;
            const te = item.textEdit;
            if (te) {
              const r = te.range ?? te.replace;
              if (r) {
                range = {
                  startLineNumber: r.start.line + 1, startColumn: r.start.character + 1,
                  endLineNumber:   r.end.line   + 1, endColumn:   r.end.character   + 1,
                };
              }
            }
            if (!range) {
              const w = model.getWordUntilPosition(position);
              range = {
                startLineNumber: position.lineNumber, endLineNumber: position.lineNumber,
                startColumn:     w.startColumn,       endColumn:     w.endColumn,
              };
            }

            let insertText = item.textEdit?.newText ?? item.insertText ?? item.label;
            let insertTextRules = item.insertTextFormat === 2
              ? monaco.languages.CompletionItemInsertTextRule.InsertAsSnippet
              : undefined;

            // HTML: completing a tag name after `<` → also close the tag
            if (html && inOpenTag && typeof insertText === 'string') {
              const label = String(item.label || '').trim();
              const looksLikeTag =
                item.kind === 7 /* Property */ ||
                item.kind === 14 /* Keyword */ ||
                item.kind === 17 /* Class */ ||
                /^[a-zA-Z][\w:-]*$/.test(label);

              if (looksLikeTag && !insertText.includes('<') && !insertText.includes('</')) {
                const closed = closeTagSnippet(insertText.trim() || label);
                if (closed !== insertText) {
                  insertText = closed;
                  insertTextRules = monaco.languages.CompletionItemInsertTextRule.InsertAsSnippet;
                }
              }
            }

            // Prefer markdown docs (MDN links) when server sends MarkupContent
            let documentation: string | monaco.IMarkdownString | undefined;
            if (item.documentation != null) {
              if (typeof item.documentation === 'string') {
                documentation = { value: item.documentation };
              } else if (typeof item.documentation?.value === 'string') {
                documentation = { value: item.documentation.value, isTrusted: true };
              }
            }

            const mapTextEdits = (edits: any[] | undefined) => {
              if (!Array.isArray(edits) || edits.length === 0) return undefined;
              return edits
                .filter((e) => e && e.range)
                .map((e) => ({
                  range: {
                    startLineNumber: (e.range.start?.line ?? 0) + 1,
                    startColumn: (e.range.start?.character ?? 0) + 1,
                    endLineNumber: (e.range.end?.line ?? 0) + 1,
                    endColumn: (e.range.end?.character ?? 0) + 1,
                  },
                  text: e.newText ?? '',
                }));
            };

            const additionalTextEdits = mapTextEdits(item.additionalTextEdits);

            const suggestion: monaco.languages.CompletionItem & { __lspItem?: any } = {
              label:         String(item.label).trim(),
              kind:          completionKind(item.kind),
              detail:        item.detail ?? '',
              documentation,
              insertText,
              range,
              insertTextRules,
              ...(additionalTextEdits ? { additionalTextEdits } : {}),
              ...(item.filterText ? { filterText: item.filterText } : {}),
              ...(item.preselect ? { preselect: true } : {}),
              sortText: item.sortText ?? ('1_' + String(item.label).trim()),
            };
            // Keep raw LSP item so resolveCompletionItem can fetch docs & auto-import edits
            suggestion.__lspItem = item;
            return suggestion;
          });

          const suggestions = lspSuggestions;
          if (!suggestions.length) return { suggestions: [], incomplete: false };

          return {
            incomplete: result?.isIncomplete === true,
            suggestions,
          };
        } catch {
          return { suggestions: [] };
        }
      },

      // Lazy docs / detail / auto-import additionalTextEdits when user highlights or accepts an item
      resolveCompletionItem: async (item, token) => {
        if (!state.initialized) return item;
        if (token?.isCancellationRequested) return item;

        const raw = (item as any).__lspItem;
        if (!raw) return item;

        try {
          const resolved: any = await sendRequest(state, 'completionItem/resolve', raw);
          if (!resolved) return item;

          if (resolved.documentation != null) {
            if (typeof resolved.documentation === 'string') {
              item.documentation = { value: resolved.documentation };
            } else if (typeof resolved.documentation?.value === 'string') {
              item.documentation = {
                value: resolved.documentation.value,
                isTrusted: true,
              };
            }
          }
          if (resolved.detail != null && resolved.detail !== '') {
            item.detail = resolved.detail;
          }
          if (Array.isArray(resolved.additionalTextEdits) && resolved.additionalTextEdits.length > 0) {
            item.additionalTextEdits = resolved.additionalTextEdits
              .filter((e: any) => e && e.range)
              .map((e: any) => ({
                range: {
                  startLineNumber: (e.range.start?.line ?? 0) + 1,
                  startColumn: (e.range.start?.character ?? 0) + 1,
                  endLineNumber: (e.range.end?.line ?? 0) + 1,
                  endColumn: (e.range.end?.character ?? 0) + 1,
                },
                text: e.newText ?? '',
              }));
          }
          // Keep data for further resolves
          if (resolved.data != null) raw.data = resolved.data;
        } catch {
          /* resolve optional */
        }
        return item;
      },
    })
  );
}
