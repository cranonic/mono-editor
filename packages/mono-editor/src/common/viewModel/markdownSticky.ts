import type { DocumentSymbol } from '../languages/providers/extendedTypes';
import type { TextModel } from '../model/TextModel';
import type { IScopeFinder, Scope, StickyHeaders } from './StickyScroll';

interface HeadingEntry {
  readonly line: number;
  readonly level: number;
}

/**
 * Shared slot algorithm over any scope chain resolver (VS Code / Acode sticky scroll rule).
 */
export function computeStickyHeadersFromChain(
  probeRow: number,
  maxLines: number,
  rowToModelLine: (visualRow: number) => number,
  chainOf: (lineNumber: number) => readonly Scope[],
  isLineHidden?: (lineNumber: number) => boolean,
): StickyHeaders {
  if (maxLines <= 0 || probeRow < 0) return { lines: [], pushed: -1 };

  const visibleChain = (lineNumber: number): readonly Scope[] => {
    if (lineNumber < 1) return [];
    const raw = chainOf(lineNumber);
    if (!isLineHidden || !raw.length) return raw;
    return raw.filter((s) => !isLineHidden(s.header));
  };

  const matches = (chain: readonly Scope[], i: number, scopes: Scope[]) => {
    if (chain.length <= i) return false;
    for (let j = 0; j < i; j++) {
      if (chain[j]!.header !== scopes[j]!.header) return false;
    }
    return true;
  };

  const lines: number[] = [];
  const scopes: Scope[] = [];
  let pushed = -1;
  let below = rowToModelLine(probeRow - 1);

  for (let i = 0; i < maxLines; i++) {
    const at = rowToModelLine(probeRow + i);
    const above = below;
    below = at;

    if (above && above !== at) {
      const prev = visibleChain(above);
      const cur = at ? visibleChain(at) : [];
      const scopeEnded =
        matches(prev, i, scopes) &&
        (prev[i]!.end <= above || !matches(cur, i, scopes) || cur[i]!.header !== prev[i]!.header);
      if (scopeEnded) {
        scopes.push(prev[i]!);
        pushed = i;
        break;
      }
    }

    if (!at) break;
    const chain = visibleChain(at);
    if (!matches(chain, i, scopes)) break;
    scopes.push(chain[i]!);
  }

  for (const s of scopes) lines.push(s.header);
  return { lines, pushed };
}

/**
 * Parses ATX Markdown headings (`#`..`######`) while ignoring fenced code blocks (` ``` ` / `~~~`)
 * and builds nested `{ header, end }` scopes for Sticky Scroll.
 */
export function computeMarkdownHeadingScopes(model: TextModel): Scope[] {
  const total = model.getLineCount();
  const headings: HeadingEntry[] = [];
  let fenceChar: '`' | '~' | null = null;
  let fenceLen = 0;

  for (let ln = 1; ln <= total; ln++) {
    const raw = model.getLineContent(ln);
    const trimmed = raw.trimStart();

    if (fenceChar) {
      const closeRe = fenceChar === '`' ? /^`{3,}\s*$/ : /^~{3,}\s*$/;
      if (closeRe.test(trimmed) && trimmed.trim().length >= fenceLen) {
        fenceChar = null;
        fenceLen = 0;
      }
      continue;
    }

    const openFence = /^(`{3,}|~{3,})/.exec(trimmed);
    if (openFence) {
      fenceChar = openFence[1]![0] as '`' | '~';
      fenceLen = openFence[1]!.length;
      continue;
    }

    // Standard ATX heading: up to 3 leading spaces, 1-6 '#', followed by space/tab or EOL
    const h = /^ {0,3}(#{1,6})(?:[ \t]+|$)/.exec(raw);
    if (h) {
      headings.push({ line: ln, level: h[1]!.length });
    }
  }

  // Each heading scope extends until the line immediately before the next heading with level <= current
  const scopes: Scope[] = [];
  for (let i = 0; i < headings.length; i++) {
    const cur = headings[i]!;
    let end = total;
    for (let j = i + 1; j < headings.length; j++) {
      if (headings[j]!.level <= cur.level) {
        end = headings[j]!.line - 1;
        break;
      }
    }
    if (end > cur.line) {
      scopes.push({ header: cur.line, end });
    }
  }
  return scopes;
}

/**
 * Scope finder for Markdown documents: pins active `#` -> `##` -> `###` heading hierarchy.
 */
export class MarkdownScopeFinder implements IScopeFinder {
  private model: TextModel;
  private version = -1;
  private scopes: Scope[] = [];

  constructor(model: TextModel) {
    this.model = model;
  }

  sync(model: TextModel, _tabSize?: number): void {
    const ver = model.getVersionId();
    if (model !== this.model || ver !== this.version) {
      this.model = model;
      this.version = ver;
      this.scopes = computeMarkdownHeadingScopes(model);
    }
  }

  invalidate(): void {
    this.version = -1;
  }

  chain(n: number): readonly Scope[] {
    this.sync(this.model);
    const out: Scope[] = [];
    for (const s of this.scopes) {
      // Strictly inside the heading's section (body line below header) OR on the heading itself
      // when scrolling past it: VS Code sticky shows parent headings containing line `n`
      if (s.header < n && n <= s.end) {
        out.push(s);
      } else if (s.header >= n) {
        break;
      }
    }
    return out;
  }

  headersForRows(
    probeRow: number,
    maxLines: number,
    rowToModelLine: (visualRow: number) => number,
    isLineHidden?: (lineNumber: number) => boolean,
  ): StickyHeaders {
    this.sync(this.model);
    return computeStickyHeadersFromChain(
      probeRow,
      maxLines,
      rowToModelLine,
      (ln) => this.chain(ln),
      isLineHidden,
    );
  }

  headers(probeLine: number, maxLines: number): StickyHeaders {
    const lineCount = this.model.getLineCount();
    return this.headersForRows(probeLine - 1, maxLines, (row) => {
      if (row < 0) return 0;
      return Math.min(row + 1, lineCount);
    });
  }
}

/**
 * Scope finder backed by `DocumentSymbolProvider` hierarchy (`outlineModel`).
 */
export class OutlineScopeFinder implements IScopeFinder {
  private model: TextModel;
  private flatScopes: Scope[] = [];

  constructor(model: TextModel, symbols: readonly DocumentSymbol[] = []) {
    this.model = model;
    this.setSymbols(symbols);
  }

  sync(model: TextModel, _tabSize?: number): void {
    this.model = model;
  }

  setModel(model: TextModel): void {
    this.model = model;
  }

  setSymbols(symbols: readonly DocumentSymbol[] | null): void {
    if (!symbols || !symbols.length) {
      this.flatScopes = [];
      return;
    }
    const out: Scope[] = [];
    const visit = (list: readonly DocumentSymbol[]) => {
      for (const sym of list) {
        const start = sym.range.startLineNumber;
        const end = sym.range.endLineNumber;
        if (end > start) {
          out.push({ header: start, end });
        }
        if (sym.children?.length) visit(sym.children);
      }
    };
    visit(symbols);
    out.sort((a, b) => a.header - b.header || b.end - a.end);
    this.flatScopes = out;
  }

  hasScopes(): boolean {
    return this.flatScopes.length > 0;
  }

  invalidate(): void {
    /* updated asynchronously by DocumentSymbolsController */
  }

  chain(n: number): readonly Scope[] {
    const out: Scope[] = [];
    for (const s of this.flatScopes) {
      if (s.header < n && n <= s.end) {
        // Avoid duplicate header lines at the same line number
        if (!out.length || out[out.length - 1]!.header !== s.header) {
          out.push(s);
        }
      } else if (s.header >= n) {
        break;
      }
    }
    return out;
  }

  headersForRows(
    probeRow: number,
    maxLines: number,
    rowToModelLine: (visualRow: number) => number,
    isLineHidden?: (lineNumber: number) => boolean,
  ): StickyHeaders {
    return computeStickyHeadersFromChain(
      probeRow,
      maxLines,
      rowToModelLine,
      (ln) => this.chain(ln),
      isLineHidden,
    );
  }

  headers(probeLine: number, maxLines: number): StickyHeaders {
    const lineCount = this.model.getLineCount();
    return this.headersForRows(probeLine - 1, maxLines, (row) => {
      if (row < 0) return 0;
      return Math.min(row + 1, lineCount);
    });
  }
}

/**
 * S6: Scope finder backed directly by `StructureTree` (used when no LSP symbols exist).
 */
export class StructureScopeFinder implements IScopeFinder {
  private model: TextModel;
  private getScopes: () => readonly Scope[];

  constructor(model: TextModel, getScopes: () => readonly Scope[]) {
    this.model = model;
    this.getScopes = getScopes;
  }

  sync(model: TextModel): void {
    this.model = model;
  }

  chain(n: number): readonly Scope[] {
    const scopes = this.getScopes();
    const out: Scope[] = [];
    for (let i = 0; i < scopes.length; i++) {
      const s = scopes[i]!;
      if (s.header < n && n <= s.end) {
        if (!out.length || out[out.length - 1]!.header !== s.header) {
          out.push(s);
        }
      } else if (s.header >= n) {
        break;
      }
    }
    return out;
  }

  headersForRows(
    probeRow: number,
    maxLines: number,
    rowToModelLine: (visualRow: number) => number,
    isLineHidden?: (lineNumber: number) => boolean,
  ): StickyHeaders {
    return computeStickyHeadersFromChain(
      probeRow,
      maxLines,
      rowToModelLine,
      (ln) => this.chain(ln),
      isLineHidden,
    );
  }

  headers(probeLine: number, maxLines: number): StickyHeaders {
    const lineCount = this.model.getLineCount();
    return this.headersForRows(probeLine - 1, maxLines, (row) => {
      if (row < 0) return 0;
      return Math.min(row + 1, lineCount);
    });
  }
}

