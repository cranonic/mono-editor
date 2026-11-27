// src/features/editor/components/BreadCrumb/treeHelpers.ts
import type { DocumentSymbol, IBreadcrumbItem } from '@mono/editor';

export interface DropdownRow {
  id: string;
  label: string;
  detail?: string;
  depth: number;
  kind: 'folder' | 'file' | 'symbol';
  symbolKind?: number;
  hasChildren: boolean;
  isExpanded: boolean;
  isLoadingChildren?: boolean;
  isCurrent?: boolean;
  parentIndex: number;
  ancestorIndices: number[];
  pathItem?: IBreadcrumbItem;
  symbol?: DocumentSymbol;
  matchIndices?: number[];
  score?: number;
}

export function symbolRowId(sym: DocumentSymbol, depth: number, index: number): string {
  return `sym:${sym.name}:${sym.range.startLineNumber}:${sym.range.startColumn}:${depth}:${index}`;
}

export function isMatchingActiveSymbol(
  sym: DocumentSymbol,
  activeItem: Pick<IBreadcrumbItem, 'kind' | 'label' | 'range' | 'selectionRange'>,
): boolean {
  if (activeItem.kind !== 'symbol') return false;
  if (sym.name !== activeItem.label) return false;
  const r = activeItem.range ?? activeItem.selectionRange;
  if (!r) return false;
  return sym.range.startLineNumber === r.startLineNumber;
}

/**
 * Flattens a hierarchical `DocumentSymbol[]` tree into visible tree rows,
 * respecting `collapsedIds` (parent symbols default to expanded, matching VS Code).
 */
export function buildSymbolTreeRows(
  symbols: readonly DocumentSymbol[],
  activeItem: Pick<IBreadcrumbItem, 'kind' | 'label' | 'range' | 'selectionRange'>,
  collapsedIds: ReadonlySet<string>,
  depth = 0,
  parentIndex = -1,
  ancestorIndices: readonly number[] = [],
  out: DropdownRow[] = [],
): DropdownRow[] {
  for (let i = 0; i < symbols.length; i++) {
    const sym = symbols[i]!;
    const id = symbolRowId(sym, depth, i);
    const hasChildren = !!(sym.children && sym.children.length > 0);
    const isExpanded = hasChildren && !collapsedIds.has(id);
    const rowIdx = out.length;

    out.push({
      id,
      label: sym.name,
      detail: sym.detail || undefined,
      depth,
      kind: 'symbol',
      symbolKind: sym.kind,
      hasChildren,
      isExpanded,
      isCurrent: isMatchingActiveSymbol(sym, activeItem),
      parentIndex,
      ancestorIndices: [...ancestorIndices],
      symbol: sym,
    });

    if (hasChildren && isExpanded) {
      buildSymbolTreeRows(
        sym.children!,
        activeItem,
        collapsedIds,
        depth + 1,
        rowIdx,
        [...ancestorIndices, rowIdx],
        out,
      );
    }
  }
  return out;
}

/**
 * Flattens a directory list with inline expanded folder children into visible tree rows.
 */
export function buildPathTreeRows(
  rootItems: readonly IBreadcrumbItem[],
  activeItem: Pick<IBreadcrumbItem, 'path' | 'uri'>,
  expandedFolders: ReadonlySet<string>,
  folderChildrenCache: ReadonlyMap<string, readonly IBreadcrumbItem[]>,
  loadingFolders: ReadonlySet<string>,
  allowInlineExpand: boolean,
  depth = 0,
  parentIndex = -1,
  ancestorIndices: readonly number[] = [],
  out: DropdownRow[] = [],
): DropdownRow[] {
  for (let i = 0; i < rootItems.length; i++) {
    const item = rootItems[i]!;
    const isFolder = !!(item.isDirectory || item.kind === 'folder');
    const folderKey = item.path || item.uri || item.id;
    const isExpanded = allowInlineExpand && isFolder && expandedFolders.has(folderKey);
    const rowIdx = out.length;

    out.push({
      id: item.id,
      label: item.label,
      depth,
      kind: isFolder ? 'folder' : 'file',
      hasChildren: isFolder,
      isExpanded,
      isLoadingChildren: isExpanded && loadingFolders.has(folderKey),
      isCurrent:
        depth === 0 &&
        ((!!item.path && item.path === activeItem.path) ||
          (!!item.uri && item.uri === activeItem.uri)),
      parentIndex,
      ancestorIndices: [...ancestorIndices],
      pathItem: item,
    });

    if (isExpanded) {
      const children = folderChildrenCache.get(folderKey);
      if (children && children.length > 0) {
        buildPathTreeRows(
          children,
          activeItem,
          expandedFolders,
          folderChildrenCache,
          loadingFolders,
          allowInlineExpand,
          depth + 1,
          rowIdx,
          [...ancestorIndices, rowIdx],
          out,
        );
      }
    }
  }
  return out;
}

/**
 * Computes which parent rows should be pinned as sticky headers at the top
 * of a scrolled breadcrumb picker tree (matching VS Code tree sticky scroll).
 */
export function computeStickyAncestorIndices(
  rows: readonly DropdownRow[],
  scrollTop: number,
  rowHeight: number,
  maxSticky = 4,
): number[] {
  if (rows.length === 0 || scrollTop <= 0 || rowHeight <= 0 || maxSticky <= 0) {
    return [];
  }

  // Iteratively settle on the row directly underneath the sticky stack
  let sticky: number[] = [];
  for (let pass = 0; pass <= maxSticky; pass++) {
    const effectiveTop = scrollTop + sticky.length * rowHeight;
    const topIdx = Math.min(rows.length - 1, Math.floor(effectiveTop / rowHeight));
    const topRow = rows[topIdx];
    if (!topRow) break;

    const candidates: number[] = [];
    for (const ancIdx of topRow.ancestorIndices) {
      // Only stick ancestors that have actually scrolled above the viewport top
      if (ancIdx * rowHeight < scrollTop + candidates.length * rowHeight) {
        candidates.push(ancIdx);
        if (candidates.length >= maxSticky) break;
      }
    }

    // If topRow itself is an expanded parent scrolled partway past effectiveTop,
    // check if its first child is still in the subtree below
    if (
      candidates.length < maxSticky &&
      topRow.hasChildren &&
      topRow.isExpanded &&
      topIdx + 1 < rows.length &&
      rows[topIdx + 1]!.depth > topRow.depth &&
      topIdx * rowHeight < scrollTop + candidates.length * rowHeight
    ) {
      candidates.push(topIdx);
    }

    if (
      candidates.length === sticky.length &&
      candidates.every((v, i) => v === sticky[i])
    ) {
      return candidates;
    }
    sticky = candidates;
  }

  return sticky;
}

export function fuzzyMatchLabel(
  query: string,
  text: string,
): { score: number; indices: number[] } | null {
  const q = query.trim().toLowerCase();
  if (!q) return { score: 0, indices: [] };
  const t = text.toLowerCase();

  const subIdx = t.indexOf(q);
  if (subIdx >= 0) {
    const indices: number[] = [];
    for (let i = 0; i < q.length; i++) indices.push(subIdx + i);
    const prefixBonus = subIdx === 0 ? 100 : 50;
    return { score: prefixBonus - subIdx, indices };
  }

  const indices: number[] = [];
  let qi = 0;
  let score = 0;
  let prev = -1;
  for (let ti = 0; ti < t.length && qi < q.length; ti++) {
    if (t[ti] === q[qi]) {
      indices.push(ti);
      if (prev === ti - 1) score += 8;
      if (
        ti === 0 ||
        t[ti - 1] === '_' ||
        t[ti - 1] === '-' ||
        t[ti - 1] === '/' ||
        t[ti - 1] === '.'
      ) {
        score += 6;
      }
      prev = ti;
      qi++;
    }
  }
  if (qi < q.length) return null;
  return { score: score - (text.length - q.length) * 0.1, indices };
}
