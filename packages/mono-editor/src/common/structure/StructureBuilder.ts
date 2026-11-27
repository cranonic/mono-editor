import type { MonoDisposable } from '../core/types';
import { getLanguageConfiguration } from '../languages/languageConfigurationRegistry';
import type { DocumentSymbol, FoldingRange } from '../languages/providers/types';
import type { TextModel } from '../model/TextModel';
import type { LineTokensProvider } from './bracketScan';
import { buildBracketNodes } from './engines/bracketsEngine';
import { buildHeadingNodes } from './engines/headingsEngine';
import { buildKeywordNodes } from './engines/keywordsEngine';
import { buildOffsideNodes } from './engines/offsideEngine';
import { buildTagNodes } from './engines/tagsEngine';
import { buildSymbolsFromTree } from './symbolRules';
import {
  DEFAULT_STRUCTURE_MAX_LINE_LENGTH,
  DEFAULT_STRUCTURE_MAX_LINES,
  StructureKind,
  type IDocumentStructure,
  type StructureBuildOptions,
  type StructureEngineKind,
  type StructureLanguageRules,
  type StructureNodeDraft,
  type StructureScopeItem,
  type StructureTree,
} from './types';

function inferEngine(languageId: string, rules?: StructureLanguageRules, offSide?: boolean): StructureEngineKind {
  if (rules?.engine) return rules.engine;
  const lang = languageId.toLowerCase();
  if (lang === 'markdown' || lang === 'md') return 'headings';
  if (lang === 'html' || lang === 'xml' || lang === 'svg' || lang === 'vue' || lang === 'svelte') return 'tags';
  if (lang === 'shell' || lang === 'bash' || lang === 'sh' || lang === 'zsh' || lang === 'sql' || lang === 'ruby' || lang === 'lua') {
    return 'keywords';
  }
  if (lang === 'python' || lang === 'py' || lang === 'yaml' || lang === 'yml' || offSide || rules?.offSide) {
    return 'offside';
  }
  return 'brackets';
}

function emptyTree(versionId: number, languageId: string): StructureTree {
  return {
    versionId,
    languageId,
    count: 0,
    startLine: new Int32Array(0),
    endLine: new Int32Array(0),
    foldEndLine: new Int32Array(0),
    startCol: new Int32Array(0),
    endCol: new Int32Array(0),
    parent: new Int32Array(0),
    kind: new Uint8Array(0),
    symbols: [],
  };
}

/**
 * Builds a compact struct-of-arrays `StructureTree` (sorted by startLine asc,
 * endLine desc, with parent links computed in O(N)) plus syntax-accurate symbols.
 */
export function buildStructureTree(
  model: TextModel,
  opts: StructureBuildOptions & { getLineTokens?: LineTokensProvider } = {},
): StructureTree {
  const versionId = model.getVersionId();
  const languageId = opts.languageId ?? model.getLanguageId();
  const lineCount = model.getLineCount();
  const maxLines = opts.maxLines ?? DEFAULT_STRUCTURE_MAX_LINES;
  const maxLineLength = opts.maxLineLength ?? DEFAULT_STRUCTURE_MAX_LINE_LENGTH;

  if (lineCount <= 0 || lineCount > maxLines) {
    return emptyTree(versionId, languageId);
  }

  const config = getLanguageConfiguration(languageId);
  const rules: StructureLanguageRules = {
    ...(config?.structure ?? {}),
    brackets: config?.structure?.brackets ?? config?.brackets,
    offSide: config?.structure?.offSide ?? config?.folding?.offSide,
    regionMarkers: config?.structure?.regionMarkers ?? config?.folding?.markers,
    commentLinePrefix: config?.structure?.commentLinePrefix ?? config?.comments?.lineComment ?? undefined,
    blockComment: config?.structure?.blockComment ?? config?.comments?.blockComment ?? undefined,
  };

  const engine = inferEngine(languageId, rules, config?.folding?.offSide);
  let drafts: StructureNodeDraft[];

  if (engine === 'offside') {
    drafts = buildOffsideNodes(model, rules, {
      tabSize: opts.tabSize,
      maxLineLength,
      languageId,
      markers: config?.folding?.markers,
    });
  } else if (engine === 'tags') {
    drafts = buildTagNodes(model, rules, { maxLineLength, languageId });
  } else if (engine === 'headings') {
    drafts = buildHeadingNodes(model, rules);
  } else if (engine === 'keywords') {
    drafts = buildKeywordNodes(model, rules, { languageId, markers: config?.folding?.markers });
  } else {
    drafts = buildBracketNodes(model, rules, {
      maxLineLength,
      getLineTokens: opts.getLineTokens,
      languageId,
      markers: config?.folding?.markers,
    });
  }

  // Deduplicate by startLine: keep the outermost span per startLine (preferring Region > others when equal)
  drafts.sort((a, b) => {
    if (a.startLine !== b.startLine) return a.startLine - b.startLine;
    if (a.endLine !== b.endLine) return b.endLine - a.endLine;
    if (a.kind === StructureKind.Region && b.kind !== StructureKind.Region) return -1;
    if (b.kind === StructureKind.Region && a.kind !== StructureKind.Region) return 1;
    return 0;
  });

  const unique: StructureNodeDraft[] = [];
  let lastStart = -1;
  for (let i = 0; i < drafts.length; i++) {
    const d = drafts[i]!;
    if (d.endLine <= d.startLine) continue;
    if (d.startLine === lastStart) continue;
    lastStart = d.startLine;
    unique.push(d);
  }

  const count = unique.length;
  const startLine = new Int32Array(count);
  const endLine = new Int32Array(count);
  const foldEndLine = new Int32Array(count);
  const startCol = new Int32Array(count);
  const endCol = new Int32Array(count);
  const parent = new Int32Array(count).fill(-1);
  const kind = new Uint8Array(count);

  const stack: number[] = [];
  for (let i = 0; i < count; i++) {
    const d = unique[i]!;
    startLine[i] = d.startLine;
    endLine[i] = d.endLine;
    foldEndLine[i] = d.foldEndLine ?? d.endLine;
    startCol[i] = d.startCol ?? 1;
    endCol[i] = d.endCol ?? 1;
    kind[i] = d.kind;

    while (stack.length > 0 && endLine[stack[stack.length - 1]!]! < d.startLine) {
      stack.pop();
    }
    if (stack.length > 0) {
      parent[i] = stack[stack.length - 1]!;
    }
    stack.push(i);
  }

  const partialTree: StructureTree = {
    versionId,
    languageId,
    count,
    startLine,
    endLine,
    foldEndLine,
    startCol,
    endCol,
    parent,
    kind,
    symbols: [],
  };

  const symbols = buildSymbolsFromTree(model, partialTree, languageId);
  return { ...partialTree, symbols };
}

/** Converts a `StructureTree` into `FoldingRange[]` (omitting 0-body spans). */
export function structureTreeToFoldingRanges(tree: StructureTree): FoldingRange[] {
  const ranges: FoldingRange[] = [];
  for (let i = 0; i < tree.count; i++) {
    const start = tree.startLine[i]!;
    const end = tree.foldEndLine[i]!;
    if (end <= start) continue;
    const k = tree.kind[i] as StructureKind;
    const kind =
      k === StructureKind.Comment ? 'comment'
        : k === StructureKind.Imports ? 'imports'
          : k === StructureKind.Region ? 'region'
            : undefined;
    ranges.push(kind ? { start, end, kind } : { start, end });
  }
  return ranges;
}

function findSymbolChainAt(
  symbols: readonly DocumentSymbol[],
  line: number,
  col: number | undefined,
  out: DocumentSymbol[],
): void {
  for (let i = 0; i < symbols.length; i++) {
    const s = symbols[i]!;
    const r = s.range;
    if (line < r.startLineNumber || line > r.endLineNumber) continue;
    if (col !== undefined) {
      if (line === r.startLineNumber && col < r.startColumn) continue;
      if (line === r.endLineNumber && col > r.endColumn) continue;
    }
    out.push(s);
    if (s.children?.length) {
      findSymbolChainAt(s.children, line, col, out);
    }
    return;
  }
}

/**
 * Returns the outermost-to-innermost enclosing scope chain at `(line, column?)`.
 * Prefers named symbol hierarchy when available, supplemented by `StructureTree` spans.
 */
export function queryScopeAt(
  tree: StructureTree,
  line: number,
  column?: number,
  overrideSymbols?: readonly DocumentSymbol[] | null,
): StructureScopeItem[] {
  const syms = overrideSymbols && overrideSymbols.length > 0 ? overrideSymbols : tree.symbols;
  if (syms.length > 0) {
    const chain: DocumentSymbol[] = [];
    findSymbolChainAt(syms, line, column, chain);
    if (chain.length > 0) {
      return chain.map((s, idx) => ({
        index: idx,
        startLine: s.range.startLineNumber,
        endLine: s.range.endLineNumber,
        startCol: s.range.startColumn,
        endCol: s.range.endColumn,
        kind: StructureKind.Symbol,
        name: s.name,
        detail: s.detail,
        symbolKind: s.kind,
      }));
    }
  }

  // Binary search in tree.startLine for last node with startLine <= line
  if (tree.count === 0) return [];
  let lo = 0;
  let hi = tree.count - 1;
  let candidate = -1;
  while (lo <= hi) {
    const mid = (lo + hi) >>> 1;
    if (tree.startLine[mid]! <= line) {
      candidate = mid;
      lo = mid + 1;
    } else {
      hi = mid - 1;
    }
  }
  if (candidate === -1) return [];

  // Walk backwards/parents to find innermost node containing `line`
  let idx = candidate;
  while (idx >= 0 && tree.endLine[idx]! < line) {
    idx = tree.parent[idx]!;
  }
  if (idx < 0) return [];

  const rev: StructureScopeItem[] = [];
  for (let cur = idx; cur >= 0; cur = tree.parent[cur]!) {
    if (tree.startLine[cur]! <= line && line <= tree.endLine[cur]!) {
      rev.push({
        index: cur,
        startLine: tree.startLine[cur]!,
        endLine: tree.endLine[cur]!,
        startCol: tree.startCol[cur]!,
        endCol: tree.endCol[cur]!,
        kind: tree.kind[cur] as StructureKind,
      });
    }
  }
  rev.reverse();
  return rev;
}

/**
 * Version-keyed `IDocumentStructure` service bound to an editor's active `TextModel`.
 */
export class DocumentStructureService implements IDocumentStructure {
  private model: TextModel;
  private getLineTokens?: LineTokensProvider;
  private cachedTree: StructureTree | null = null;
  private cachedLang = '';
  private cachedVersion = -1;
  private maxLines = DEFAULT_STRUCTURE_MAX_LINES;
  private externalSymbols: readonly DocumentSymbol[] | null = null;
  private listeners = new Set<() => void>();

  constructor(model: TextModel, getLineTokens?: LineTokensProvider) {
    this.model = model;
    this.getLineTokens = getLineTokens;
  }

  setModel(model: TextModel): void {
    this.model = model;
    this.invalidate();
  }

  setMaxLines(maxLines: number): void {
    if (maxLines > 0 && maxLines !== this.maxLines) {
      this.maxLines = maxLines;
      this.invalidate();
    }
  }

  setExternalSymbols(symbols: readonly DocumentSymbol[] | null): void {
    this.externalSymbols = symbols && symbols.length > 0 ? symbols : null;
    this.fireChange();
  }

  invalidate(): void {
    this.cachedTree = null;
    this.cachedVersion = -1;
    this.externalSymbols = null;
    this.fireChange();
  }

  getTree(): StructureTree {
    const ver = this.model.getVersionId();
    const lang = this.model.getLanguageId();
    if (this.cachedTree && this.cachedVersion === ver && this.cachedLang === lang) {
      return this.cachedTree;
    }
    this.cachedTree = buildStructureTree(this.model, {
      maxLines: this.maxLines,
      getLineTokens: this.getLineTokens,
    });
    this.cachedVersion = ver;
    this.cachedLang = lang;
    return this.cachedTree;
  }

  getFoldingRanges(): FoldingRange[] {
    return structureTreeToFoldingRanges(this.getTree());
  }

  getScopeAt(line: number, column?: number): StructureScopeItem[] {
    return queryScopeAt(this.getTree(), line, column, this.externalSymbols);
  }

  getOutline(): DocumentSymbol[] {
    if (this.externalSymbols && this.externalSymbols.length > 0) {
      return [...this.externalSymbols];
    }
    return [...this.getTree().symbols];
  }

  onDidChangeStructure(listener: () => void): MonoDisposable {
    this.listeners.add(listener);
    return { dispose: () => this.listeners.delete(listener) };
  }

  private fireChange(): void {
    for (const l of this.listeners) {
      try { l(); } catch { /* ignore */ }
    }
  }
}
