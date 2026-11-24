import type { LineBracketColor } from '../../common/brackets/bracketColorizerTypes';
import type { ColorMatch } from '../../common/color/colorTypes';
import type { IRange } from '../../common/core/types';
import type { DecorationRenderItem } from '../../common/decorations/types';
import type { DocumentHighlight, ILink } from '../../common/languages/providers/extendedTypes';
import type { SemanticTokenSpan } from '../../common/languages/semanticTokens';
import type { InlineGhostRun, ResolvedInlayHint, VirtualGhostRow } from '../../common/virtualText';

export interface ViewDataProviders {
  getTokenTypeAt: ((lineNumber: number, column: number) => string | null) | null;
  getLineColors: ((lineNumber: number) => readonly ColorMatch[]) | null;
  getLineBrackets: ((lineNumber: number) => readonly LineBracketColor[]) | null;
  resolveBracketColor: ((entry: LineBracketColor) => string) | null;
  getDecorationRender: (() => DecorationRenderItem[]) | null;
  getFindDecorations:
    | (() => {
        matches: { startLineNumber: number; startColumn: number; endLineNumber: number; endColumn: number }[];
        currentIndex: number;
      })
    | null;
  getLineInlayHints: ((lineNumber: number) => readonly ResolvedInlayHint[]) | null;
  getLineGhostInline: ((lineNumber: number) => readonly InlineGhostRun[]) | null;
  getGhostVersion: (() => number) | null;
  hasGhostRows: (() => boolean) | null;
  getLineGhostRows:
    | ((lineNumber: number, wrapWidthPx: number, effectiveWrap: boolean) => readonly VirtualGhostRow[])
    | null;
  getGhostTextItalic: (() => boolean) | null;
  getLineSemanticTokens: ((lineNumber: number) => readonly SemanticTokenSpan[]) | null;
  getLineLinks: ((lineNumber: number) => readonly ILink[]) | null;
  getHoverRange: (() => IRange | null) | null;
  getDocumentHighlights: (() => readonly DocumentHighlight[]) | null;
}

export function createEmptyViewProviders(): ViewDataProviders {
  return {
    getTokenTypeAt: null,
    getLineColors: null,
    getLineBrackets: null,
    resolveBracketColor: null,
    getDecorationRender: null,
    getFindDecorations: null,
    getLineInlayHints: null,
    getLineGhostInline: null,
    getGhostVersion: null,
    hasGhostRows: null,
    getLineGhostRows: null,
    getGhostTextItalic: null,
    getLineSemanticTokens: null,
    getLineLinks: null,
    getHoverRange: null,
    getDocumentHighlights: null,
  };
}
