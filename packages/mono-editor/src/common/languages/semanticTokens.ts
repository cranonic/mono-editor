import type {
  SemanticTokensEdit,
  SemanticTokensLegend,
} from './providers/extendedTypes';
import type { MonoTokenType } from './tokenization/tokenTypes';

export interface SemanticTokenSpan {
  /** 1-based inclusive start column */
  readonly startColumn: number;
  /** 1-based exclusive end column */
  readonly endColumn: number;
  /** Mapped Mono token type used to resolve theme foreground color */
  readonly tokenType: MonoTokenType;
  /** Original LSP semantic token type name */
  readonly rawType: string;
  readonly italic?: boolean;
  readonly bold?: boolean;
  readonly strikethrough?: boolean;
  readonly underline?: boolean;
}

const LSP_TO_MONO_TOKEN: Record<string, MonoTokenType> = {
  namespace: 'namespace',
  type: 'type',
  class: 'class',
  enum: 'enum',
  interface: 'interface',
  struct: 'type',
  typeParameter: 'typeParameter',
  parameter: 'parameter',
  variable: 'variable',
  property: 'property',
  enumMember: 'constant',
  event: 'property',
  function: 'function',
  method: 'method',
  macro: 'decorator',
  keyword: 'keyword',
  modifier: 'keyword',
  comment: 'comment',
  string: 'string',
  number: 'number',
  regexp: 'regexp',
  operator: 'operator',
  decorator: 'decorator',
};

/** Maps a standard LSP semantic token type + modifiers to a MonoTokenType. */
export function mapSemanticTokenType(
  rawType: string,
  modifiers: readonly string[],
): MonoTokenType {
  if (rawType === 'variable' && modifiers.includes('readonly')) {
    return 'constant';
  }
  return LSP_TO_MONO_TOKEN[rawType] ?? 'identifier';
}

/** Extracts active modifier names from an LSP bitmask against `legend.tokenModifiers`. */
export function decodeModifierNames(
  bitmask: number,
  legendModifiers: readonly string[],
): string[] {
  if (!bitmask || !legendModifiers.length) return [];
  const out: string[] = [];
  for (let i = 0; i < legendModifiers.length && i < 31; i++) {
    if ((bitmask & (1 << i)) !== 0) {
      out.push(legendModifiers[i]!);
    }
  }
  return out;
}

/**
 * Applies LSP `SemanticTokensEdits` deltas to a previous encoded Uint32Array buffer.
 */
export function applySemanticTokenEdits(
  previous: Uint32Array | readonly number[],
  edits: readonly SemanticTokensEdit[],
): Uint32Array {
  const arr = Array.from(previous);
  // Apply edits from highest start index to lowest so offsets stay valid
  const sorted = [...edits].sort((a, b) => b.start - a.start);
  for (const edit of sorted) {
    const start = Math.max(0, Math.min(arr.length, edit.start));
    const del = Math.max(0, edit.deleteCount);
    const ins = edit.data ? Array.from(edit.data) : [];
    arr.splice(start, del, ...ins);
  }
  return Uint32Array.from(arr);
}

/**
 * Decodes standard LSP 5-integer relative semantic tokens
 * (`[deltaLine, deltaStartChar, length, tokenTypeIdx, tokenModifiersBitmask]`)
 * into a sparse per-1-based-line map of sorted `SemanticTokenSpan[]`.
 */
export function decodeSemanticTokens(
  data: Uint32Array | readonly number[],
  legend: SemanticTokensLegend,
): Map<number, SemanticTokenSpan[]> {
  const byLine = new Map<number, SemanticTokenSpan[]>();
  const len = data.length;
  let line0 = 0;
  let char0 = 0;

  for (let i = 0; i + 4 < len; i += 5) {
    const deltaLine = data[i]!;
    const deltaStart = data[i + 1]!;
    const length = data[i + 2]!;
    const typeIdx = data[i + 3]!;
    const modBits = data[i + 4]!;

    line0 += deltaLine;
    char0 = deltaLine === 0 ? char0 + deltaStart : deltaStart;
    if (length <= 0) continue;

    const rawType = legend.tokenTypes[typeIdx] ?? 'variable';
    const mods = decodeModifierNames(modBits, legend.tokenModifiers);
    const tokenType = mapSemanticTokenType(rawType, mods);

    const lineNumber = line0 + 1;
    const span: SemanticTokenSpan = {
      startColumn: char0 + 1,
      endColumn: char0 + 1 + length,
      tokenType,
      rawType,
      italic: mods.includes('static') || mods.includes('abstract') || mods.includes('documentation') || undefined,
      bold: mods.includes('declaration') || mods.includes('definition') || undefined,
      strikethrough: mods.includes('deprecated') || undefined,
      underline: mods.includes('modification') || undefined,
    };

    let list = byLine.get(lineNumber);
    if (!list) {
      list = [];
      byLine.set(lineNumber, list);
    }
    list.push(span);
  }

  for (const list of byLine.values()) {
    list.sort((a, b) => a.startColumn - b.startColumn);
  }
  return byLine;
}

/**
 * Sparse per-line semantic token overlay cache supporting full documents,
 * incremental LSP delta edits, and viewport range patches.
 */
export class SemanticTokensCache {
  private resultId: string | null = null;
  private rawData: Uint32Array = new Uint32Array(0);
  private byLine = new Map<number, SemanticTokenSpan[]>();
  private rangeByLine = new Map<number, SemanticTokenSpan[]>();

  getResultId(): string | null {
    return this.resultId;
  }

  setFull(
    data: Uint32Array | readonly number[],
    legend: SemanticTokensLegend,
    resultId?: string,
  ): void {
    this.rawData = data instanceof Uint32Array ? data : Uint32Array.from(data);
    this.resultId = resultId ?? null;
    this.byLine = decodeSemanticTokens(this.rawData, legend);
  }

  applyEdits(
    edits: readonly SemanticTokensEdit[],
    legend: SemanticTokensLegend,
    resultId?: string,
  ): void {
    this.rawData = applySemanticTokenEdits(this.rawData, edits);
    this.resultId = resultId ?? null;
    this.byLine = decodeSemanticTokens(this.rawData, legend);
  }

  setRange(
    startLine: number,
    endLine: number,
    data: Uint32Array | readonly number[],
    legend: SemanticTokensLegend,
  ): void {
    for (let ln = startLine; ln <= endLine; ln++) {
      this.rangeByLine.delete(ln);
    }
    const decoded = decodeSemanticTokens(data, legend);
    for (const [ln, spans] of decoded.entries()) {
      this.rangeByLine.set(ln, spans);
    }
  }

  getLineSpans(lineNumber: number): readonly SemanticTokenSpan[] {
    const full = this.byLine.get(lineNumber);
    const range = this.rangeByLine.get(lineNumber);
    if (!full && !range) return [];
    if (full && !range) return full;
    if (!full && range) return range;
    return [...full!, ...range!].sort((a, b) => a.startColumn - b.startColumn);
  }

  clear(): void {
    this.resultId = null;
    this.rawData = new Uint32Array(0);
    this.byLine.clear();
    this.rangeByLine.clear();
  }
}
