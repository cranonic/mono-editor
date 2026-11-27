// src/features/editor/components/BreadCrumb/BreadcrumbsDropdown.tsx
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  capPopupMaxWidth,
  placePopupHorizontal,
  POPUP_MAX_WIDTH_RATIO,
  type DocumentSymbol,
  type IBreadcrumbItem,
  type IBreadcrumbsModel,
  type IMonoEditor,
  type ResolvedBreadcrumbsOptions,
} from '@mono/editor';
import { Icon } from '@/ui/components/Icon/IconRegistry';
import { FileIcon } from '@/ui/components/FileIcon/DefaultIconTheme';
import { getSymbolIconName } from '@/core/symbols/utils/iconMap';
import { readBreadcrumbDirectory } from './pathProvider';

interface DropdownRow {
  id: string;
  label: string;
  detail?: string;
  depth: number;
  kind: 'folder' | 'file' | 'symbol';
  symbolKind?: number;
  isCurrent?: boolean;
  pathItem?: IBreadcrumbItem;
  symbol?: DocumentSymbol;
  matchIndices?: number[];
  score?: number;
}

interface BreadcrumbsDropdownProps {
  editor: IMonoEditor;
  model: IBreadcrumbsModel;
  anchorRect: DOMRect;
  hostRect: DOMRect;
  activeItem: IBreadcrumbItem;
  options: ResolvedBreadcrumbsOptions;
  onClose: (refocusEditor?: boolean) => void;
  onStepSegment: (delta: -1 | 1) => void;
}

function fuzzyMatch(query: string, text: string): { score: number; indices: number[] } | null {
  const q = query.trim().toLowerCase();
  if (!q) return { score: 0, indices: [] };
  const t = text.toLowerCase();

  // Contiguous substring gets highest score
  const subIdx = t.indexOf(q);
  if (subIdx >= 0) {
    const indices: number[] = [];
    for (let i = 0; i < q.length; i++) indices.push(subIdx + i);
    const prefixBonus = subIdx === 0 ? 100 : 50;
    return { score: prefixBonus - subIdx, indices };
  }

  // Fuzzy subsequence fallback
  const indices: number[] = [];
  let qi = 0;
  let score = 0;
  let prev = -1;
  for (let ti = 0; ti < t.length && qi < q.length; ti++) {
    if (t[ti] === q[qi]) {
      indices.push(ti);
      if (prev === ti - 1) score += 8;
      if (ti === 0 || t[ti - 1] === '_' || t[ti - 1] === '-' || t[ti - 1] === '/' || t[ti - 1] === '.') {
        score += 6;
      }
      prev = ti;
      qi++;
    }
  }
  if (qi < q.length) return null;
  return { score: score - (text.length - q.length) * 0.1, indices };
}

function renderHighlightedLabel(label: string, indices?: number[]): React.ReactNode {
  if (!indices || indices.length === 0) return label;
  const set = new Set(indices);
  const parts: React.ReactNode[] = [];
  let buf = '';
  let inMatch = false;

  const flush = (key: number) => {
    if (!buf) return;
    parts.push(
      inMatch ? (
        <mark key={key} className="ms-bc-match">
          {buf}
        </mark>
      ) : (
        <React.Fragment key={key}>{buf}</React.Fragment>
      ),
    );
    buf = '';
  };

  for (let i = 0; i < label.length; i++) {
    const m = set.has(i);
    if (m !== inMatch) {
      flush(i);
      inMatch = m;
    }
    buf += label[i];
  }
  flush(label.length);
  return parts;
}

function flattenSymbols(
  symbols: readonly DocumentSymbol[],
  depth: number,
  activeId: string,
  out: DropdownRow[],
): void {
  for (let i = 0; i < symbols.length; i++) {
    const sym = symbols[i]!;
    const id = `sym:${sym.name}:${sym.range.startLineNumber}:${sym.range.startColumn}:${i}`;
    out.push({
      id,
      label: sym.name,
      detail: sym.detail || undefined,
      depth,
      kind: 'symbol',
      symbolKind: sym.kind,
      isCurrent: activeId === `sym:${sym.name}:${sym.range.startLineNumber}:${sym.range.startColumn}`,
      symbol: sym,
    });
    if (sym.children && sym.children.length > 0) {
      flattenSymbols(sym.children, depth + 1, activeId, out);
    }
  }
}

export const BreadcrumbsDropdown: React.FC<BreadcrumbsDropdownProps> = ({
  editor,
  model,
  anchorRect,
  hostRect,
  activeItem,
  options,
  onClose,
  onStepSegment,
}) => {
  const containerRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);

  const [filter, setFilter] = useState('');
  const [selectedIdx, setSelectedIdx] = useState(0);
  const [loading, setLoading] = useState(false);
  const [pathRows, setPathRows] = useState<DropdownRow[]>([]);
  const [dirStack, setDirStack] = useState<string[]>([]);

  const isSymbolMode = activeItem.kind === 'symbol';

  // Load siblings when active path item changes
  useEffect(() => {
    setFilter('');
    setDirStack([]);
    if (isSymbolMode) return;

    let alive = true;
    setLoading(true);
    model
      .getSiblings(activeItem)
      .then((siblings) => {
        if (!alive) return;
        const rows: DropdownRow[] = siblings.map((s) => ({
          id: s.id,
          label: s.label,
          depth: 0,
          kind: s.isDirectory || s.kind === 'folder' ? 'folder' : 'file',
          isCurrent: s.path === activeItem.path || s.uri === activeItem.uri,
          pathItem: s,
        }));
        setPathRows(rows);
        const curIdx = rows.findIndex((r) => r.isCurrent);
        setSelectedIdx(curIdx >= 0 ? curIdx : 0);
      })
      .finally(() => {
        if (alive) setLoading(false);
      });

    return () => {
      alive = false;
    };
  }, [activeItem, isSymbolMode, model]);

  // Build symbol rows from model outline
  const symbolRows = useMemo<DropdownRow[]>(() => {
    if (!isSymbolMode) return [];
    const outline = model.getOutlineForPicker();
    const out: DropdownRow[] = [];
    flattenSymbols(outline, 0, activeItem.id, out);
    return out;
  }, [isSymbolMode, model, activeItem.id]);

  // Initialize selected index for symbol picker
  useEffect(() => {
    if (!isSymbolMode) return;
    const curIdx = symbolRows.findIndex((r) => r.isCurrent);
    setSelectedIdx(curIdx >= 0 ? curIdx : 0);
  }, [isSymbolMode, symbolRows]);

  // Filtered + best-match sorted rows
  const filteredRows = useMemo<DropdownRow[]>(() => {
    const base = isSymbolMode ? symbolRows : pathRows;
    const q = filter.trim();
    if (!q) return base;

    const matched: DropdownRow[] = [];
    for (const row of base) {
      const m = fuzzyMatch(q, row.label);
      if (m) {
        matched.push({
          ...row,
          depth: 0,
          matchIndices: m.indices,
          score: m.score,
        });
      }
    }
    matched.sort((a, b) => (b.score ?? 0) - (a.score ?? 0));
    return matched;
  }, [isSymbolMode, symbolRows, pathRows, filter]);

  // Clamp selectedIdx when filter updates
  useEffect(() => {
    if (filter.trim().length > 0) {
      setSelectedIdx(0);
    } else if (selectedIdx >= filteredRows.length) {
      setSelectedIdx(Math.max(0, filteredRows.length - 1));
    }
  }, [filter, filteredRows.length, selectedIdx]);

  // Auto-focus filter input on desktop; avoid popping soft keyboard unexpectedly unless tapped on touch
  useEffect(() => {
    const isCoarse = typeof window !== 'undefined' && window.matchMedia?.('(pointer: coarse)')?.matches;
    if (!isCoarse) {
      inputRef.current?.focus();
    } else {
      containerRef.current?.focus();
    }
  }, [activeItem.id]);

  // Keep active row scrolled into view
  useEffect(() => {
    const listEl = listRef.current;
    if (!listEl) return;
    const activeEl = listEl.querySelector<HTMLElement>(`[data-bc-idx="${selectedIdx}"]`);
    activeEl?.scrollIntoView({ block: 'nearest' });
  }, [selectedIdx]);

  // Dismiss on outside pointerdown
  useEffect(() => {
    const onPointerDown = (e: PointerEvent) => {
      const target = e.target as Node | null;
      if (containerRef.current && target && containerRef.current.contains(target)) return;
      if ((target as HTMLElement | null)?.closest?.('.ms-breadcrumbs-container')) return;
      onClose(false);
    };
    window.addEventListener('pointerdown', onPointerDown, true);
    return () => window.removeEventListener('pointerdown', onPointerDown, true);
  }, [onClose]);

  const drillIntoFolder = useCallback(async (folderPath: string) => {
    setLoading(true);
    try {
      const children = await readBreadcrumbDirectory(folderPath);
      setDirStack((prev) => [...prev, folderPath]);
      setPathRows(
        children.map((c) => ({
          id: c.id,
          label: c.label,
          depth: 0,
          kind: c.isDirectory || c.kind === 'folder' ? 'folder' : 'file',
          pathItem: c,
        })),
      );
      setFilter('');
      setSelectedIdx(0);
    } finally {
      setLoading(false);
    }
  }, []);

  const stepUpFolder = useCallback(async () => {
    if (dirStack.length === 0) return false;
    const nextStack = dirStack.slice(0, -1);
    setDirStack(nextStack);
    setLoading(true);
    try {
      const items =
        nextStack.length > 0
          ? await readBreadcrumbDirectory(nextStack[nextStack.length - 1]!)
          : await model.getSiblings(activeItem);
      setPathRows(
        items.map((c) => ({
          id: c.id,
          label: c.label,
          depth: 0,
          kind: c.isDirectory || c.kind === 'folder' ? 'folder' : 'file',
          isCurrent: nextStack.length === 0 && (c.path === activeItem.path || c.uri === activeItem.uri),
          pathItem: c,
        })),
      );
      setFilter('');
      setSelectedIdx(0);
    } finally {
      setLoading(false);
    }
    return true;
  }, [dirStack, model, activeItem]);

  const revealRow = useCallback(
    (row: DropdownRow) => {
      if (row.symbol) {
        const target = row.symbol.selectionRange ?? row.symbol.range;
        editor.setPosition({ lineNumber: target.startLineNumber, column: target.startColumn });
        editor.revealPositionInCenter?.({
          lineNumber: target.startLineNumber,
          column: target.startColumn,
        });
      }
    },
    [editor],
  );

  const activateRow = useCallback(
    (row: DropdownRow) => {
      if (row.kind === 'symbol' && row.symbol) {
        revealRow(row);
        onClose(true);
        return;
      }
      if (row.kind === 'folder' && row.pathItem?.path) {
        void drillIntoFolder(row.pathItem.path);
        return;
      }
      if (row.pathItem) {
        // Use the model's path provider openItem via tab store
        const p = row.pathItem.path || row.pathItem.uri;
        if (p) {
          import('./pathProvider').then(({ createAppBreadcrumbsPathProvider }) => {
            createAppBreadcrumbsPathProvider(p).openItem?.(row.pathItem!);
          });
        }
        onClose(true);
      }
    },
    [revealRow, onClose, drillIntoFolder],
  );

  const handleKeyDown = (e: React.KeyboardEvent) => {
    const count = filteredRows.length;
    if (e.key === 'Escape') {
      e.preventDefault();
      e.stopPropagation();
      onClose(true);
      return;
    }
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      if (count > 0) setSelectedIdx((i) => (i + 1) % count);
      return;
    }
    if (e.key === 'ArrowUp') {
      e.preventDefault();
      if (count > 0) setSelectedIdx((i) => (i - 1 + count) % count);
      return;
    }
    if (e.key === 'Home') {
      e.preventDefault();
      if (count > 0) setSelectedIdx(0);
      return;
    }
    if (e.key === 'End') {
      e.preventDefault();
      if (count > 0) setSelectedIdx(count - 1);
      return;
    }
    if (e.key === 'Enter') {
      e.preventDefault();
      const row = filteredRows[selectedIdx];
      if (row) activateRow(row);
      return;
    }
    if (e.key === ' ' && document.activeElement !== inputRef.current) {
      e.preventDefault();
      const row = filteredRows[selectedIdx];
      if (row) revealRow(row);
      return;
    }
    if (e.key === 'ArrowRight' && filter.length === 0) {
      const row = filteredRows[selectedIdx];
      if (row && row.kind === 'folder' && row.pathItem?.path) {
        e.preventDefault();
        void drillIntoFolder(row.pathItem.path);
      } else {
        e.preventDefault();
        onStepSegment(1);
      }
      return;
    }
    if (e.key === 'ArrowLeft' && filter.length === 0) {
      e.preventDefault();
      if (dirStack.length > 0) {
        void stepUpFolder();
      } else {
        onStepSegment(-1);
      }
    }
  };

  // Compute safe popup geometry respecting POPUP_MAX_WIDTH_RATIO = 0.7 & placePopupHorizontal
  const hostW = hostRect.width > 0 ? hostRect.width : window.innerWidth;
  const maxW = capPopupMaxWidth(340, hostW, POPUP_MAX_WIDTH_RATIO);
  const naturalW = Math.min(maxW, Math.max(210, maxW));
  const placed = placePopupHorizontal({
    anchorX: anchorRect.left - hostRect.left,
    naturalWidth: naturalW,
    hostWidth: hostW,
    margin: 6,
  });

  const top = Math.round(anchorRect.bottom - hostRect.top + 2);
  const maxH = Math.max(140, Math.min(320, Math.floor((hostRect.height || 400) * 0.6)));

  return (
    <div
      ref={containerRef}
      className="ms-bc-dropdown"
      style={{
        left: placed.left,
        top,
        width: placed.width,
        maxHeight: maxH,
      }}
      tabIndex={-1}
      role="dialog"
      aria-label={isSymbolMode ? 'Document symbols outline' : 'Folder siblings'}
      onKeyDown={handleKeyDown}
    >
      <div className="ms-bc-filter-row">
        {dirStack.length > 0 && (
          <button
            type="button"
            className="ms-bc-back-btn"
            aria-label="Go up a folder"
            onClick={() => void stepUpFolder()}
          >
            <Icon name="chevron-left" size={14} />
          </button>
        )}
        <input
          ref={inputRef}
          type="text"
          className="ms-bc-filter-input"
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
          placeholder={isSymbolMode ? 'Filter symbols…' : 'Filter files…'}
          aria-label={isSymbolMode ? 'Filter symbols' : 'Filter files'}
        />
        {filter && (
          <button
            type="button"
            className="ms-bc-clear-btn"
            aria-label="Clear filter"
            onClick={() => {
              setFilter('');
              inputRef.current?.focus();
            }}
          >
            <Icon name="close" size={12} />
          </button>
        )}
      </div>

      <div
        ref={listRef}
        className="ms-bc-list"
        role="listbox"
        aria-label={isSymbolMode ? 'Outline symbols' : 'Files and folders'}
      >
        {loading && <div className="ms-bc-empty">Loading…</div>}
        {!loading && filteredRows.length === 0 && (
          <div className="ms-bc-empty">No matching items</div>
        )}
        {!loading &&
          filteredRows.map((row, idx) => {
            const isSelected = idx === selectedIdx;
            return (
              <div
                key={row.id}
                data-bc-idx={idx}
                role="option"
                aria-selected={isSelected}
                className={`ms-bc-option${isSelected ? ' is-selected' : ''}${row.isCurrent ? ' is-current' : ''}`}
                style={{ paddingLeft: 10 + row.depth * 14 }}
                onMouseEnter={() => setSelectedIdx(idx)}
                onClick={(e) => {
                  e.stopPropagation();
                  activateRow(row);
                }}
              >
                {options.icons && (
                  <span className="ms-bc-opt-icon">
                    {row.kind === 'symbol' ? (
                      <Icon
                        name={getSymbolIconName((row.symbolKind ?? 12) as any) as any}
                        size={14}
                      />
                    ) : (
                      <FileIcon name={row.label} isDir={row.kind === 'folder'} />
                    )}
                  </span>
                )}
                <span className="ms-bc-opt-label">
                  {renderHighlightedLabel(row.label, row.matchIndices)}
                </span>
                {row.detail && <span className="ms-bc-opt-detail">{row.detail}</span>}
                {row.kind === 'folder' && (
                  <span className="ms-bc-opt-chevron">
                    <Icon name="chevron-right" size={12} />
                  </span>
                )}
              </div>
            );
          })}
      </div>
    </div>
  );
};
