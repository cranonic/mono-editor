// On-Type Formatting – textDocument/onTypeFormatting
import * as monaco from '@/core/mono';
import type { LspState } from '../types';
import { sendRequest, sendNotify } from '../LspTransport';
import { getDocUri } from '../utils/uriHelpers';
import { toMonacoRange, toLspPosition } from './helpers';

export function registerOnTypeFormatting(state: LspState): void {
  state.disposables.push(
    monaco.languages.registerOnTypeFormattingEditProvider(state.languageId, {
      autoFormatTriggerCharacters: ['}', ';', '\n'],
      provideOnTypeFormattingEdits: async (model, position, ch, options) => {
        if (!state.initialized) return [];
        try {
          // JIT sync: the debounced didChange (400 ms) has not delivered the Enter/char just typed yet,
          // and the server must format the text the user sees, not a stale copy (stale edits
          // were applied at wrong offsets: duplicated lines, caret jumping back).
          sendNotify(state, 'textDocument/didChange', {
            textDocument:   { uri: getDocUri(model, state), version: model.getVersionId() },
            contentChanges: [{ text: model.getValue() }],
          });

          const result: any = await sendRequest(state, 'textDocument/onTypeFormatting', {
            textDocument: { uri: getDocUri(model, state) },
            position: toLspPosition(position),
            ch,
            options: {
              tabSize: options.tabSize,
              insertSpaces: options.insertSpaces,
            },
          });
          if (!Array.isArray(result)) return [];
          return result.map((e: any) => ({
            range: toMonacoRange(e.range),
            text: e.newText ?? '',
          }));
        } catch {
          return [];
        }
      },
    }),
  );
}
