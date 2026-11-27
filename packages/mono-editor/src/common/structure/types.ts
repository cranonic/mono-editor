import type { MonoDisposable } from '../core/types';
import type {
  StructureEngineKind,
  StructureKeywordPair,
  StructureLanguageRules,
} from '../languages/languageConfigurationTypes';
import type { DocumentSymbol, FoldingRange, SymbolKind } from '../languages/providers/types';

export type { StructureEngineKind, StructureKeywordPair, StructureLanguageRules };

export const StructureKind = {
  Block: 0,
  Comment: 1,
  Imports: 2,
  Region: 3,
  Tag: 4,
  Heading: 5,
  Keyword: 6,
  Offside: 7,
  Symbol: 8,
} as const;

export type StructureKind = (typeof StructureKind)[keyof typeof StructureKind];

export interface StructureNodeDraft {
  readonly startLine: number;
  readonly endLine: number;
  readonly startCol?: number;
  readonly endCol?: number;
  readonly kind: StructureKind;
  /** Optional explicit folding endLine if different from scope endLine (e.g. closing brace line). */
  readonly foldEndLine?: number;
}

export interface StructureTree {
  readonly versionId: number;
  readonly languageId: string;
  readonly count: number;
  readonly startLine: Int32Array;
  readonly endLine: Int32Array;
  readonly foldEndLine: Int32Array;
  readonly startCol: Int32Array;
  readonly endCol: Int32Array;
  readonly parent: Int32Array;
  readonly kind: Uint8Array;
  readonly symbols: readonly DocumentSymbol[];
}

export interface StructureScopeItem {
  readonly index: number;
  readonly startLine: number;
  readonly endLine: number;
  readonly startCol: number;
  readonly endCol: number;
  readonly kind: StructureKind;
  readonly name?: string;
  readonly detail?: string;
  readonly symbolKind?: SymbolKind;
}

export interface StructureBuildOptions {
  readonly maxLines?: number;
  readonly maxLineLength?: number;
  readonly tabSize?: number;
  readonly languageId?: string;
}

export interface IDocumentStructure {
  getTree(): StructureTree;
  getFoldingRanges(): FoldingRange[];
  getScopeAt(line: number, column?: number): StructureScopeItem[];
  getOutline(): DocumentSymbol[];
  onDidChangeStructure(listener: () => void): MonoDisposable;
}

export const DEFAULT_STRUCTURE_MAX_LINES = 100_000;
export const DEFAULT_STRUCTURE_MAX_LINE_LENGTH = 20_000;
