// src/features/explorer/components/Symbols/SymbolsPanel.tsx
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  haptic,
  type DocumentSymbol as MonoDocumentSymbol,
  type IBreadcrumbItem,
} from '@mono/editor';
import * as monaco from '@/core/mono';
import { getSymbolTree, getActiveEditor } from '@/core/services/symbolService';
import { useTabStore } from '@/store/tabStore';
import { useSettingsStore } from '@/features/settings/store/settingsStore';
import { Icon } from '@/ui/components/Icon/IconRegistry';
import { getSymbolIconName } from '@/core/symbols/utils/iconMap';
import { useBreadcrumbPalette } from '@/features/editor/components/BreadCrumb/hooks/useBreadcrumbPalette';
import {
  buildSymbolTreeRows,
  computeStickyAncestorIndices,
  findDeepestSymbolAtLine,
  type DropdownRow,
} from '@/features/editor/components/BreadCrumb/treeHelpers';
import './SymbolsPanel.css';

const BASE_PAD_PX = 8;
const INDENT_PX = 16;
const TWISTY_W_PX = 16;
const LONG_PRESS_MS = 450;
const LONG_PRESS_MOVE_TOLERANCE_PX = 8;

interface SymbolsPanelProps {
  onSourceLoaded?: (source: string | null) => void;
}

function toMonoSymbols(nodes: any[]): MonoDocumentSymbol[] {
  return nodes.map((n) => ({
    name: n.name || '?',
    detail: n.detail || undefined,
    kind: typeof n.kind === 'number' ? n.kind : 12,
    range: n.range ?? {
      startLineNumber: 1,
      startColumn: 1,
      endLineNumber: 1,
      endColumn: 1,
    },
    selectionRange: n.selectionRange ?? n.range ?? {
      startLineNumber: 1,
      startColumn: 1,
      endLineNumber: 1,
      endColumn: 1,
    },
    children: Array.isArray(n.children) && n.children.length > 0 ? toMonoSymbols(n.children) : undefined,
  }));
}

export const SymbolsPanel: React.FC<SymbolsPanelProps> = ({ onSourceLoaded }) => {
  const activeTabId = useTabStore((s) => s.activeTabId);
  const showSymbolDetails = useSettingsStore((s) => s.settings['breadcrumbs.showSymbolDetails'] === true);
  const palette = useBreadcrumbPalette();

  const listRef = useRef<HTMLDivElement>(null);
  const longPressTimerRef = useRef<number | null>(null);
  const longPressStartRef = useRef<{ x: number; y: number } | null>(null);
  const longPressTriggeredRef = useRef(false);

  const [symbols, setSymbols] = useState<MonoDocumentSymbol[]>([]);
  const [loading, setLoading] = useState(false);
  const [cursorLine, setCursorLine] = useState<number>(1);
  const [collapsedIds, setCollapsedIds] = useState<Set<string>>(() => new Set());
  const [scrollTop, setScrollTop] = useState(0);
  const [refreshTick, setRefreshTick] = useState(0);

  const isCoarse =
    typeof window !== 'undefined' && !!window.matchMedia?.('(pointer: coarse)')?.matches;
  const rowHeight = isCoarse ? 28 : 23;

  // Fetch document symbols preferring active MonoEditor structure / LSP providers
  const loadSymbols = useCallback(async () => {
    const editor = getActiveEditor();
    const model = editor?.getModel?.();
    if (!editor || !model) {
      setSymbols([]);
      onSourceLoaded?.(null);
      setLoading(false);
      return;
    }

    setLoading(true);
    try {
      const pos = editor.getPosition?.();
      if (pos?.lineNumber) setCursorLine(pos.lineNumber);

      // 1. Prefer live SymbolManager (LSP > MonoNative > fallback)
      const managedTree = await getSymbolTree(model);
      if (managedTree && managedTree.length > 0) {
        setSymbols(toMonoSymbols(managedTree));
        onSourceLoaded?.(managedTree[0]?.source || null);
        setLoading(false);
        return;
      }

      // 2. Direct Mono structure engine outline fallback
      const monoOutline = editor.getStructure?.()?.getOutline?.();
      if (monoOutline && monoOutline.length > 0) {
        setSymbols(monoOutline);
        onSourceLoaded?.('mono');
        setLoading(false);
        return;
      }

      setSymbols([]);
      onSourceLoaded?.(null);
    } catch {
      setSymbols([]);
      onSourceLoaded?.(null);
    } finally {
      setLoading(false);
    }
  }, [onSourceLoaded]);

  // Listen to global outline refresh / collapse / LSP ready events
  useEffect(() => {
    const onRefresh = () => setRefreshTick((t) => t + 1);
    const onCollapseAll = () => {
      setCollapsedIds((prev) => {
        if (prev.size > 0) return new Set();
        const allParents = new Set<string>();
        const rows = buildSymbolTreeRows(
          symbols,
          { kind: 'file', label: '' },
          new Set(),
        );
        for (const r of rows) {
          if (r.hasChildren) allParents.add(r.id);
        }
        return allParents;
      });
    };

    window.addEventListener('ms-outline-refresh', onRefresh);
    window.addEventListener('ms-lsp-ready', onRefresh);
    window.addEventListener('ms-outline-collapse-all', onCollapseAll);
    return () => {
      window.removeEventListener('ms-outline-refresh', onRefresh);
      window.removeEventListener('ms-lsp-ready', onRefresh);
      window.removeEventListener('ms-outline-collapse-all', onCollapseAll);
    };
  }, [symbols]);

  // Bind to active editor mount, tab switch, content changes, and cursor movement
  useEffect(() => {
    let alive = true;
    let debounceTimer: ReturnType<typeof setTimeout> | null = null;
    let retryTimer: ReturnType<typeof setTimeout> | null = null;
    const disposables: Array<{ dispose(): void }> = [];

    const scheduleRefresh = (delay = 350) => {
      if (debounceTimer) clearTimeout(debounceTimer);
      debounceTimer = setTimeout(() => {
        debounceTimer = null;
        if (alive) void loadSymbols();
      }, delay);
    };

    const bindEditor = (ed: any) => {
      if (!ed) return;
      const model = ed.getModel?.();
      if (model && typeof model.onDidChangeContent === 'function') {
        disposables.push(model.onDidChangeContent(() => scheduleRefresh(350)));
      } else if (typeof ed.onDidChangeModelContent === 'function') {
        disposables.push(ed.onDidChangeModelContent(() => scheduleRefresh(350)));
      }

      if (typeof ed.onDidChangeCursorPosition === 'function') {
        disposables.push(
          ed.onDidChangeCursorPosition((ev: any) => {
            const ln = ev?.position?.lineNumber ?? ed.getPosition?.()?.lineNumber;
            if (typeof ln === 'number' && ln > 0) setCursorLine(ln);
          }),
        );
      }

      const structure = ed.getStructure?.();
      if (structure && typeof structure.onDidChange === 'function') {
        disposables.push(structure.onDidChange(() => scheduleRefresh(150)));
      }
    };

    setCollapsedIds(new Set());
    void loadSymbols();

    const currentEditor = getActiveEditor();
    if (currentEditor) {
      bindEditor(currentEditor);
    } else {
      // Editor may mount asynchronously right after activeTabId changes
      retryTimer = setTimeout(() => {
        if (!alive) return;
        const lateEditor = getActiveEditor();
        if (lateEditor) {
          bindEditor(lateEditor);
          void loadSymbols();
        }
      }, 250);
    }

    if (typeof monaco.editor.onDidCreateEditor === 'function') {
      disposables.push(
        monaco.editor.onDidCreateEditor((created) => {
          if (!alive) return;
          bindEditor(created);
          scheduleRefresh(120);
        }),
      );
    }

    return () => {
      alive = false;
      if (debounceTimer) clearTimeout(debounceTimer);
      if (retryTimer) clearTimeout(retryTimer);
      for (const d of disposables) {
        try {
          d.dispose();
        } catch {
          /* ignore */
        }
      }
    };
  }, [activeTabId, refreshTick, loadSymbols]);

  // Compute active symbol matching the cursor line
  const activeSymbolItem = useMemo<Pick<IBreadcrumbItem, 'kind' | 'label' | 'range' | 'selectionRange'>>(() => {
    const activeSym = findDeepestSymbolAtLine(symbols, cursorLine);
    if (!activeSym) return { kind: 'file', label: '' };
    return {
      kind: 'symbol',
      label: activeSym.name,
      range: activeSym.range,
      selectionRange: activeSym.selectionRange,
    };
  }, [symbols, cursorLine]);

  // Build visible flat tree rows matching Breadcrumb picker tree
  const rows = useMemo<DropdownRow[]>(() => {
    return buildSymbolTreeRows(symbols, activeSymbolItem, collapsedIds);
  }, [symbols, activeSymbolItem, collapsedIds]);

  const activeIdx = useMemo(() => rows.findIndex((r) => r.isCurrent), [rows]);

  const activeRowAncestors = useMemo(
    () => (activeIdx >= 0 && rows[activeIdx] ? new Set(rows[activeIdx]!.ancestorIndices) : null),
    [activeIdx, rows],
  );

  // Sticky parent headers while scrolling
  const stickyIndices = useMemo<number[]>(() => {
    return computeStickyAncestorIndices(rows, scrollTop, rowHeight, 4);
  }, [rows, scrollTop, rowHeight]);

  // Auto-scroll active block into view when cursor moves across symbols
  useEffect(() => {
    if (activeIdx < 0) return;
    const listEl = listRef.current;
    if (!listEl || listEl.clientHeight <= 0) return;
    const stickyOffset = stickyIndices.length * rowHeight;
    const rowTop = activeIdx * rowHeight;
    const rowBottom = rowTop + rowHeight;
    if (rowTop < listEl.scrollTop + stickyOffset) {
      const next = Math.max(0, rowTop - stickyOffset - rowHeight);
      listEl.scrollTop = next;
      setScrollTop(next);
    } else if (rowBottom > listEl.scrollTop + listEl.clientHeight) {
      const next = Math.max(0, rowBottom - listEl.clientHeight + rowHeight);
      listEl.scrollTop = next;
      setScrollTop(next);
    }
  }, [activeIdx, rowHeight]);

  // Long-press cleanup
  const clearLongPress = useCallback(() => {
    if (longPressTimerRef.current !== null) {
      window.clearTimeout(longPressTimerRef.current);
      longPressTimerRef.current = null;
    }
    longPressStartRef.current = null;
  }, []);

  useEffect(() => () => clearLongPress(), [clearLongPress]);

  const toggleExpand = useCallback((rowId: string) => {
    setCollapsedIds((prev) => {
      const next = new Set(prev);
      if (next.has(rowId)) next.delete(rowId);
      else next.add(rowId);
      return next;
    });
  }, []);

  const jumpToSymbol = useCallback((row: DropdownRow) => {
    const editor = getActiveEditor();
    if (!editor || !row.symbol) return;
    const target = row.symbol.selectionRange ?? row.symbol.range;
    const ln = target.startLineNumber;
    const col = target.startColumn;
    editor.setPosition?.({ lineNumber: ln, column: col });
    if (typeof editor.revealPositionInCenter === 'function') {
      editor.revealPositionInCenter({ lineNumber: ln, column: col });
    } else if (typeof editor.revealLineInCenter === 'function') {
      editor.revealLineInCenter(ln);
    } else {
      editor.revealLine?.(ln, col);
    }
    editor.focus?.();
    setCursorLine(ln);
  }, []);

  const selectSymbolBlock = useCallback((row: DropdownRow) => {
    const editor = getActiveEditor();
    if (!editor || !row.symbol) return;
    const r = row.symbol.range;
    editor.setSelection?.({
      startLineNumber: r.startLineNumber,
      startColumn: r.startColumn,
      endLineNumber: r.endLineNumber,
      endColumn: r.endColumn,
    });
    if (typeof editor.revealRangeInCenter === 'function') {
      editor.revealRangeInCenter(r);
    } else if (typeof editor.revealLineInCenter === 'function') {
      editor.revealLineInCenter(r.startLineNumber);
    }
    editor.focus?.();
    haptic('selection');
    setCursorLine(r.startLineNumber);
  }, []);

  const handlePointerDown = useCallback(
    (e: React.PointerEvent, row: DropdownRow) => {
      if (!row.symbol) return;
      if (e.button !== 0 && e.pointerType === 'mouse') return;
      clearLongPress();
      longPressTriggeredRef.current = false;
      longPressStartRef.current = { x: e.clientX, y: e.clientY };
      longPressTimerRef.current = window.setTimeout(() => {
        longPressTimerRef.current = null;
        longPressStartRef.current = null;
        longPressTriggeredRef.current = true;
        selectSymbolBlock(row);
      }, LONG_PRESS_MS);
    },
    [clearLongPress, selectSymbolBlock],
  );

  const handlePointerMove = useCallback(
    (e: React.PointerEvent) => {
      const start = longPressStartRef.current;
      if (!start) return;
      if (
        Math.abs(e.clientX - start.x) > LONG_PRESS_MOVE_TOLERANCE_PX ||
        Math.abs(e.clientY - start.y) > LONG_PRESS_MOVE_TOLERANCE_PX
      ) {
        clearLongPress();
      }
    },
    [clearLongPress],
  );

  const cssVars = {
    '--outline-bg': palette.background,
    '--outline-border': palette.border,
    '--outline-fg': palette.foreground,
    '--outline-detail': palette.detailForeground,
    '--outline-sel-bg': palette.selectedBackground,
    '--outline-sel-fg': palette.selectedForeground,
    '--outline-hover-bg': palette.hoverBackground,
    '--outline-hl': palette.highlight,
    '--outline-guide': palette.indentGuide,
    '--outline-guide-active': palette.activeIndentGuide,
    '--outline-row-h': `${rowHeight}px`,
  } as React.CSSProperties;

  const renderRow = (row: DropdownRow, idx: number, isSticky = false) => {
    const isActive = !isSticky && idx === activeIdx;
    const padLeft = BASE_PAD_PX + row.depth * INDENT_PX;

    return (
      <div
        key={isSticky ? `sticky:${row.id}:${idx}` : `${row.id}:${idx}`}
        data-outline-idx={isSticky ? undefined : idx}
        role="treeitem"
        aria-selected={isActive}
        aria-expanded={row.hasChildren ? row.isExpanded : undefined}
        className={`ms-outline-row${isActive ? ' is-active' : ''}${isSticky ? ' is-sticky-row' : ''}`}
        style={{ paddingLeft: padLeft }}
        onPointerDown={(e) => handlePointerDown(e, row)}
        onPointerMove={handlePointerMove}
        onPointerUp={clearLongPress}
        onPointerCancel={clearLongPress}
        onPointerLeave={clearLongPress}
        onContextMenu={(e) => e.preventDefault()}
        onClick={(e) => {
          e.stopPropagation();
          if (longPressTriggeredRef.current) {
            longPressTriggeredRef.current = false;
            return;
          }
          jumpToSymbol(row);
        }}
      >
        {row.depth > 0 && (
          <span className="ms-outline-guides" aria-hidden="true">
            {Array.from({ length: row.depth }, (_, level) => {
              const ancIdx = row.ancestorIndices[level];
              const isActiveGuide = !!(
                activeRowAncestors &&
                ancIdx !== undefined &&
                activeRowAncestors.has(ancIdx)
              );
              const leftPx = BASE_PAD_PX + level * INDENT_PX + Math.floor(TWISTY_W_PX / 2);
              return (
                <span
                  key={level}
                  className={`ms-outline-indent-guide${isActiveGuide ? ' is-active' : ''}`}
                  style={{ left: leftPx }}
                />
              );
            })}
          </span>
        )}

        <span
          className={`ms-outline-twisty${row.hasChildren ? ' is-clickable' : ''}`}
          aria-hidden="true"
          onPointerDown={(e) => {
            if (row.hasChildren) e.stopPropagation();
          }}
          onClick={(e) => {
            if (!row.hasChildren) return;
            e.preventDefault();
            e.stopPropagation();
            toggleExpand(row.id);
          }}
        >
          {row.hasChildren && (
            <Icon name={row.isExpanded ? 'chevron-down' : 'chevron-right'} size={13} />
          )}
        </span>

        <span className="ms-outline-icon">
          <Icon
            name={getSymbolIconName((row.symbolKind ?? 12) as any) as any}
            size={15}
            color={palette.iconForSymbolKind(row.symbolKind)}
          />
        </span>

        <span className="ms-outline-label">{row.label}</span>

        {showSymbolDetails && row.detail && (
          <span className="ms-outline-detail">{row.detail}</span>
        )}
      </div>
    );
  };

  if (loading && rows.length === 0) {
    return <div className="ms-outline-empty">Loading outline…</div>;
  }
  if (rows.length === 0) {
    return <div className="ms-outline-empty">No symbols found in active editor.</div>;
  }

  return (
    <div className="ms-outline-root" style={cssVars} role="tree" aria-label="Document Outline">
      {stickyIndices.length > 0 && (
        <div className="ms-outline-sticky-overlay" aria-hidden="true">
          {stickyIndices.map((rowIdx) => {
            const row = rows[rowIdx];
            return row ? renderRow(row, rowIdx, true) : null;
          })}
        </div>
      )}

      <div
        ref={listRef}
        className="ms-outline-list"
        onScroll={(e) => setScrollTop(e.currentTarget.scrollTop)}
      >
        {rows.map((row, idx) => renderRow(row, idx, false))}
      </div>
    </div>
  );
};