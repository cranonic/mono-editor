import type {
  GhostTextItem,
  GhostTextKind,
  InlayHint,
  InlayHintKind,
  InlayHintLabelPart,
} from '../languages/providers/extendedTypes';

export type { GhostTextItem, GhostTextKind, InlayHint, InlayHintKind, InlayHintLabelPart };

export interface NormalizedGhostText extends GhostTextItem {
  readonly id: string;
  readonly owner: string;
  readonly firstLine: string;
  readonly extraLines: readonly string[];
  readonly kind: GhostTextKind;
  readonly priority: number;
  readonly autoClearOnEdit: boolean;
}

export interface InlineGhostRun {
  readonly id: string;
  /** 1-based column where ghost text starts on this line */
  readonly column: number;
  readonly text: string;
  readonly italic?: boolean;
  readonly kind: GhostTextKind;
}

export interface VirtualGhostRow {
  readonly itemId: string;
  readonly text: string;
  readonly indentPx: number;
  readonly italic?: boolean;
  readonly kind: GhostTextKind;
}

export interface ResolvedInlayHint {
  readonly lineNumber: number;
  /** 1-based column before which this hint is rendered */
  readonly column: number;
  readonly text: string;
  readonly parts: readonly InlayHintLabelPart[];
  readonly kind?: InlayHintKind;
  readonly tooltip?: string;
  readonly paddingLeft: boolean;
  readonly paddingRight: boolean;
  /** Precomputed pixel width of the rendered chip (excluding outer margins) */
  readonly chipWidthPx: number;
  /** Total horizontal pixel advance including outer padding margins */
  readonly totalAdvancePx: number;
  readonly marginLeftPx: number;
}

/** Splits ghost text into its inline first-line part and virtual continuation lines. */
export function splitGhostText(text: string): { firstLine: string; extraLines: string[] } {
  const norm = text.replace(/\r\n/g, '\n').replace(/\r/g, '\n');
  const idx = norm.indexOf('\n');
  if (idx < 0) return { firstLine: norm, extraLines: [] };
  return {
    firstLine: norm.slice(0, idx),
    extraLines: norm.slice(idx + 1).split('\n'),
  };
}

/** Returns the next word chunk (including leading spaces/punctuation) for partial Ctrl+Right accept. */
export function extractNextGhostWord(text: string): { accepted: string; remaining: string } {
  if (!text) return { accepted: '', remaining: '' };
  const norm = text.replace(/\r\n/g, '\n');
  if (norm[0] === '\n') {
    const leadWs = /^\n[ \t]*/.exec(norm)?.[0] ?? '\n';
    return { accepted: leadWs, remaining: norm.slice(leadWs.length) };
  }
  const m = /^[ \t]*(?:[A-Za-z0-9_$]+|[^\sA-Za-z0-9_$\n]+)/.exec(norm);
  if (!m || m[0].length === 0) {
    return { accepted: norm[0]!, remaining: norm.slice(1) };
  }
  return { accepted: m[0], remaining: norm.slice(m[0].length) };
}

/** Returns the first line (including trailing newline if present) for partial line accept. */
export function extractNextGhostLine(text: string): { accepted: string; remaining: string } {
  if (!text) return { accepted: '', remaining: '' };
  const norm = text.replace(/\r\n/g, '\n');
  const nl = norm.indexOf('\n');
  if (nl < 0) return { accepted: norm, remaining: '' };
  if (nl === 0) {
    // Leading newline: accept newline + first non-empty line
    const nextNl = norm.indexOf('\n', 1);
    if (nextNl < 0) return { accepted: norm, remaining: '' };
    return { accepted: norm.slice(0, nextNl), remaining: norm.slice(nextNl) };
  }
  return { accepted: norm.slice(0, nl), remaining: norm.slice(nl) };
}
