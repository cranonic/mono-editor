// src/features/editor/components/BreadCrumb/BreadcrumbsDropdown.tsx
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  capPopupMaxWidth,
  haptic,
  placePopupHorizontal,
  POPUP_MAX_WIDTH_RATIO,
  type IBreadcrumbItem,
  type IBreadcrumbsModel,
  type IMonoEditor,
  type PickerPalette,
  type ResolvedBreadcrumbsOptions,
} from '@mono/editor';
import { Icon } from '@/ui/components/Icon/IconRegistry';
import { FileIcon } from '@/ui/components/FileIcon/DefaultIconTheme';
import { getSymbolIconName } from '@/core/symbols/utils/iconMap';
import { createAppBreadcrumbsPathProvider, readBreadcrumbDirectory } from './pathProvider';
import {
  buildPathTreeRows,
  buildSymbolTreeRows,
  computeStickyAncestorIndices,
  fuzzyMatchLabel,
  type DropdownRow,
} from './treeHelpers';

const BASE_PAD_PX = 8;
const INDENT_PX = 16;
const TWISTY_W_PX = 16;
const LONG_PRESS_MS = 450;
const LONG_PRESS_MOVE_TOLERANCE_PX = 8;

interface BreadcrumbsDropdownProps {
  editor: IMonoEditor;
  model: IBreadcrumbsModel;
  anchorRect: DOMRect;
  hostRect: DOMRect;
  palette: PickerPalette;
  activeItem: IBreadcrumbItem;
  options: ResolvedBreadcrumbsOptions;
  onClose: (refocusEditor?: boolean) => void;
  onStepSegment: (delta: -1 | 1) => void;
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

export const BreadcrumbsDropdown: React.FC<BreadcrumbsDropdownProps> = ({
  editor,
  model,
  anchorRect,
  hostRect,
  palette,
  activeItem,
  options,
  onClose,
  onStepSegment,
}) => {
  const containerRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);

  // Long-press tracking for selecting a symbol's full block in the editor
  const longPressTimerRef = useRef<number | null>(null);
  const longPressStartRef = useRef<{ x: number; y: number } | null>(null);
  const longPressTriggeredRef = useRef(false);

  const [filter, setFilter] = useState('');
  // -1 = no row highlighted when nothing matches; matched isCurrent row is highlighted on open
  const [selectedIdx, setSelectedIdx] = useState(-1);
  const [loading, setLoading] = useState(false);
  const [scrollTop, setScrollTop] = useState(0);
  const autoScrolledKeyRef = useRef<string | null>(null);

  // File/folder tree state
  const [rootPathItems, setRootPathItems] = useState<readonly IBreadcrumbItem[]>([]);
  const [dirStack, setDirStack] = useState<string[]>([]);
  const [expandedFolders, setExpandedFolders] = useState<Set<string>>(() => new Set());
  const [folderChildrenCache, setFolderChildrenCache] = useState<Map<string, readonly IBreadcrumbItem[]>>(
    () => new Map(),
  );
  const [loadingFolders, setLoadingFolders] = useState<Set<string>>(() => new Set());

  // Symbol tree collapsed IDs (parents start expanded by default like VS Code)
  const [collapsedSymbolIds, setCollapsedSymbolIds] = useState<Set<string>>(() => new Set());

  const isSymbolMode = activeItem.kind === 'symbol';
  const isEnterFolderMode = options.folderClickBehavior === 'enter';
  const showSymbolDetails = options.showSymbolDetails === true;
  const isCoarse =
    typeof window !== 'undefined' && !!window.matchMedia?.('(pointer: coarse)')?.matches;
  const rowHeight = isCoarse ? 30 : 24;

  // Reset picker tree state when switching active breadcrumb segment
  useEffect(() => {
    autoScrolledKeyRef.current = null;
    setFilter('');
    setSelectedIdx(-1);
    setScrollTop(0);
    setDirStack([]);
    setExpandedFolders(new Set());
    setCollapsedSymbolIds(new Set());
    if (listRef.current) listRef.current.scrollTop = 0;

    if (isSymbolMode) return;

    let alive = true;
    setLoading(true);
    model
      .getSiblings(activeItem)
      .then((siblings) => {
        if (!alive) return;
        setRootPathItems(siblings);
      })
      .finally(() => {
        if (alive) setLoading(false);
      });

    return () => {
      alive = false;
    };
  }, [activeItem, isSymbolMode, model]);

  // Build visible tree rows (symbols or files/folders)
  const treeRows = useMemo<DropdownRow[]>(() => {
    if (isSymbolMode) {
      const outline = model.getOutlineForPicker();
      return buildSymbolTreeRows(outline, activeItem, collapsedSymbolIds);
    }
    return buildPathTreeRows(
      rootPathItems,
      activeItem,
      expandedFolders,
      folderChildrenCache,
      loadingFolders,
      !isEnterFolderMode,
    );
  }, [
    isSymbolMode,
    model,
    activeItem,
    collapsedSymbolIds,
    rootPathItems,
    expandedFolders,
    folderChildrenCache,
    loadingFolders,
    isEnterFolderMode,
  ]);

  const isFiltering = filter.trim().length > 0;

  // Filtered + best-match sorted rows when typing; tree rows otherwise
  const filteredRows = useMemo<DropdownRow[]>(() => {
    if (!isFiltering) return treeRows;
    const q = filter.trim();
    const matched: DropdownRow[] = [];
    for (const row of treeRows) {
      const m = fuzzyMatchLabel(q, row.label);
      if (m) {
        matched.push({
          ...row,
          depth: 0,
          parentIndex: -1,
          ancestorIndices: [],
          matchIndices: m.indices,
          score: m.score,
        });
      }
    }
    matched.sort((a, b) => (b.score ?? 0) - (a.score ?? 0));
    return matched;
  }, [treeRows, isFiltering, filter]);

  // Keep selectedIdx valid when filtering toggles
  useEffect(() => {
    if (isFiltering) {
      setSelectedIdx(filteredRows.length > 0 ? 0 : -1);
    } else {
      setSelectedIdx((prev) => (prev >= filteredRows.length ? -1 : prev));
    }
  }, [isFiltering, filteredRows.length]);

  // Sticky ancestor rows while scrolling the tree (disabled while flat-filtering)
  const maxH = Math.max(140, Math.min(320, Math.floor((hostRect.height || 400) * 0.6)));
  const maxSticky = Math.max(1, Math.min(4, Math.floor((maxH - 40) / rowHeight / 2)));
  const stickyIndices = useMemo<number[]>(() => {
    if (isFiltering || loading) return [];
    return computeStickyAncestorIndices(filteredRows, scrollTop, rowHeight, maxSticky);
  }, [isFiltering, loading, filteredRows, scrollTop, rowHeight, maxSticky]);

  // Focus filter input on desktop without popping soft keyboard on touch
  useEffect(() => {
    if (!isCoarse) {
      inputRef.current?.focus();
    } else {
      containerRef.current?.focus();
    }
  }, [activeItem.id, isCoarse]);

  // Auto-jump scroll + highlight the clicked/current block or file once rows are ready
  useEffect(() => {
    if (loading || isFiltering) return;
    const scrollKey = `${activeItem.id}:${dirStack.length}:${treeRows.length}`;
    if (autoScrolledKeyRef.current === scrollKey) return;
    if (treeRows.length === 0) return;

    const currentIdx = treeRows.findIndex((r) => r.isCurrent);
    autoScrolledKeyRef.current = scrollKey;

    if (currentIdx >= 0) {
      setSelectedIdx(currentIdx);
      const scrollToCurrent = () => {
        const listEl = listRef.current;
        if (!listEl) return;
        const viewportH = listEl.clientHeight || maxH;
        const stickyCount = Math.min(maxSticky, treeRows[currentIdx]?.ancestorIndices.length ?? 0);
        const stickyPad = stickyCount * rowHeight;
        const idealTop =
          currentIdx * rowHeight - Math.max(stickyPad + rowHeight, Math.floor((viewportH - rowHeight) / 2));
        const clampedTop = Math.max(0, Math.min(idealTop, Math.max(0, listEl.scrollHeight - viewportH)));
        listEl.scrollTop = clampedTop;
        setScrollTop(clampedTop);
      };
      // Run immediately and after layout paint so sticky overlay & scroll position stay exact
      scrollToCurrent();
      const raf = window.requestAnimationFrame(scrollToCurrent);
      return () => window.cancelAnimationFrame(raf);
    } else {
      // No current item matched — do NOT highlight row 0 by default
      setSelectedIdx(-1);
    }
  }, [activeItem.id, dirStack.length, loading, isFiltering, treeRows, rowHeight, maxH, maxSticky]);

  // Scroll focused row into view when navigating with keyboard
  useEffect(() => {
    if (selectedIdx < 0) return;
    const listEl = listRef.current;
    if (!listEl) return;
    const activeEl = listEl.querySelector<HTMLElement>(`[data-bc-idx="${selectedIdx}"]`);
    if (!activeEl) return;
    const stickyOffset = stickyIndices.length * rowHeight;
    const rowTop = activeEl.offsetTop;
    const rowBottom = rowTop + rowHeight;
    if (rowTop < listEl.scrollTop + stickyOffset) {
      const next = Math.max(0, rowTop - stickyOffset);
      listEl.scrollTop = next;
      setScrollTop(next);
    } else if (rowBottom > listEl.scrollTop + listEl.clientHeight) {
      const next = Math.max(0, rowBottom - listEl.clientHeight);
      listEl.scrollTop = next;
      setScrollTop(next);
    }
  }, [selectedIdx, stickyIndices.length, rowHeight]);

  // Clean up any pending long-press timer on unmount
  const clearLongPress = useCallback(() => {
    if (longPressTimerRef.current !== null) {
      window.clearTimeout(longPressTimerRef.current);
      longPressTimerRef.current = null;
    }
    longPressStartRef.current = null;
  }, []);

  useEffect(() => () => clearLongPress(), [clearLongPress]);

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

  const toggleSymbolExpand = useCallback((rowId: string) => {
    setCollapsedSymbolIds((prev) => {
      const next = new Set(prev);
      if (next.has(rowId)) next.delete(rowId);
      else next.add(rowId);
      return next;
    });
  }, []);

  const toggleFolderExpand = useCallback(
    async (folderPath: string) => {
      let willExpand = false;
      setExpandedFolders((prev) => {
        const next = new Set(prev);
        if (next.has(folderPath)) {
          next.delete(folderPath);
          willExpand = false;
        } else {
          next.add(folderPath);
          willExpand = true;
        }
        return next;
      });

      if (!willExpand) return;
      if (folderChildrenCache.has(folderPath)) return;

      setLoadingFolders((prev) => new Set(prev).add(folderPath));
      try {
        const children = await readBreadcrumbDirectory(folderPath);
        setFolderChildrenCache((prev) => {
          const next = new Map(prev);
          next.set(folderPath, children);
          return next;
        });
      } finally {
        setLoadingFolders((prev) => {
          const next = new Set(prev);
          next.delete(folderPath);
          return next;
        });
      }
    },
    [folderChildrenCache],
  );

  const drillIntoFolder = useCallback(async (folderPath: string) => {
    setLoading(true);
    try {
      const children = await readBreadcrumbDirectory(folderPath);
      setDirStack((prev) => [...prev, folderPath]);
      setRootPathItems(children);
      setExpandedFolders(new Set());
      setFilter('');
      setSelectedIdx(-1);
      setScrollTop(0);
      if (listRef.current) listRef.current.scrollTop = 0;
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
      setRootPathItems(items);
      setExpandedFolders(new Set());
      setFilter('');
      setSelectedIdx(-1);
      setScrollTop(0);
      if (listRef.current) listRef.current.scrollTop = 0;
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

  const selectSymbolBlock = useCallback(
    (row: DropdownRow) => {
      if (!row.symbol) return;
      const r = row.symbol.range;
      editor.setSelection({
        startLineNumber: r.startLineNumber,
        startColumn: r.startColumn,
        endLineNumber: r.endLineNumber,
        endColumn: r.endColumn,
      });
      editor.revealRangeInCenter?.(r);
      haptic('selection');
      onClose(true);
    },
    [editor, onClose],
  );

  const activateRow = useCallback(
    (row: DropdownRow) => {
      if (row.kind === 'symbol' && row.symbol) {
        revealRow(row);
        onClose(true);
        return;
      }
      if (row.kind === 'folder' && row.pathItem?.path) {
        if (isEnterFolderMode) {
          void drillIntoFolder(row.pathItem.path);
        } else {
          void toggleFolderExpand(row.pathItem.path);
        }
        return;
      }
      if (row.pathItem) {
        const p = row.pathItem.path || row.pathItem.uri;
        if (p) {
          createAppBreadcrumbsPathProvider(p).openItem?.(row.pathItem);
        }
        onClose(true);
      }
    },
    [revealRow, onClose, isEnterFolderMode, drillIntoFolder, toggleFolderExpand],
  );

  const handleTwistyClick = useCallback(
    (e: React.MouseEvent, row: DropdownRow) => {
      e.preventDefault();
      e.stopPropagation();
      if (row.kind === 'symbol' && row.hasChildren) {
        toggleSymbolExpand(row.id);
      } else if (row.kind === 'folder' && row.pathItem?.path) {
        if (isEnterFolderMode) {
          void drillIntoFolder(row.pathItem.path);
        } else {
          void toggleFolderExpand(row.pathItem.path);
        }
      }
    },
    [toggleSymbolExpand, toggleFolderExpand, drillIntoFolder, isEnterFolderMode],
  );

  const handleRowPointerDown = useCallback(
    (e: React.PointerEvent, row: DropdownRow) => {
      if (row.kind !== 'symbol' || !row.symbol) return;
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

  const handleRowPointerMove = useCallback(
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
      if (count > 0) setSelectedIdx((i) => (i < 0 ? 0 : (i + 1) % count));
      return;
    }
    if (e.key === 'ArrowUp') {
      e.preventDefault();
      if (count > 0) setSelectedIdx((i) => (i < 0 ? count - 1 : (i - 1 + count) % count));
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
      const row = selectedIdx >= 0 ? filteredRows[selectedIdx] : undefined;
      if (row) {
        if (e.shiftKey && row.kind === 'symbol' && row.symbol) {
          selectSymbolBlock(row);
        } else {
          activateRow(row);
        }
      }
      return;
    }
    if (e.key === ' ' && document.activeElement !== inputRef.current) {
      e.preventDefault();
      const row = selectedIdx >= 0 ? filteredRows[selectedIdx] : undefined;
      if (row) {
        if (row.kind === 'folder' && row.pathItem?.path && !isEnterFolderMode) {
          void toggleFolderExpand(row.pathItem.path);
        } else {
          revealRow(row);
        }
      }
      return;
    }
    if (e.key === 'ArrowRight' && filter.length === 0) {
      const row = selectedIdx >= 0 ? filteredRows[selectedIdx] : undefined;
      if (row && row.hasChildren) {
        if (row.kind === 'symbol') {
          if (!row.isExpanded) {
            e.preventDefault();
            toggleSymbolExpand(row.id);
            return;
          }
          if (selectedIdx + 1 < count && filteredRows[selectedIdx + 1]!.depth > row.depth) {
            e.preventDefault();
            setSelectedIdx(selectedIdx + 1);
            return;
          }
        } else if (row.kind === 'folder' && row.pathItem?.path) {
          e.preventDefault();
          if (isEnterFolderMode) {
            void drillIntoFolder(row.pathItem.path);
          } else if (!row.isExpanded) {
            void toggleFolderExpand(row.pathItem.path);
          } else if (selectedIdx + 1 < count && filteredRows[selectedIdx + 1]!.depth > row.depth) {
            setSelectedIdx(selectedIdx + 1);
          }
          return;
        }
      }
      e.preventDefault();
      onStepSegment(1);
      return;
    }
    if (e.key === 'ArrowLeft' && filter.length === 0) {
      const row = selectedIdx >= 0 ? filteredRows[selectedIdx] : undefined;
      if (row && row.hasChildren && row.isExpanded) {
        e.preventDefault();
        if (row.kind === 'symbol') toggleSymbolExpand(row.id);
        else if (row.kind === 'folder' && row.pathItem?.path) void toggleFolderExpand(row.pathItem.path);
        return;
      }
      if (row && row.parentIndex >= 0) {
        e.preventDefault();
        setSelectedIdx(row.parentIndex);
        return;
      }
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
  const naturalW = Math.min(maxW, Math.max(220, maxW));
  const placed = placePopupHorizontal({
    anchorX: anchorRect.left - hostRect.left,
    naturalWidth: naturalW,
    hostWidth: hostW,
    margin: 6,
  });

  const ARROW = 7;
  const top = Math.round(anchorRect.bottom - hostRect.top + ARROW);
  const arrowLeft = Math.round(
    Math.min(
      Math.max(anchorRect.left + Math.min(anchorRect.width, 24) / 2 - hostRect.left - placed.left - ARROW, 8),
      Math.max(8, placed.width - ARROW * 2 - 8),
    ),
  );
  // Show filter bar on touch or whenever user has typed / drilled into a folder (and always when typing)
  const showFilterRow = isCoarse || filter.length > 0 || dirStack.length > 0;

  const cssVars = {
    '--bc-bg': palette.background,
    '--bc-border': palette.border,
    '--bc-fg': palette.foreground,
    '--bc-detail': palette.detailForeground,
    '--bc-sel-bg': palette.selectedBackground,
    '--bc-sel-fg': palette.selectedForeground,
    '--bc-hover-bg': palette.hoverBackground,
    '--bc-hl': palette.highlight,
    '--bc-shadow': palette.shadow,
    '--bc-guide': palette.indentGuide,
    '--bc-guide-active': palette.activeIndentGuide,
    '--bc-row-h': `${rowHeight}px`,
    '--bc-arrow': ARROW,
  } as React.CSSProperties;

  const activeRowAncestors =
    selectedIdx >= 0 && filteredRows[selectedIdx]
      ? new Set(filteredRows[selectedIdx]!.ancestorIndices)
      : null;

  const renderTreeRow = (row: DropdownRow, idx: number, isSticky = false) => {
    const isSelected = !isSticky && idx === selectedIdx;
    const padLeft = BASE_PAD_PX + row.depth * INDENT_PX;
    const showTwisty = !isFiltering && row.hasChildren;

    return (
      <div
        key={isSticky ? `sticky:${row.id}:${idx}` : `${row.id}:${idx}`}
        data-bc-idx={isSticky ? undefined : idx}
        role={isSticky ? 'presentation' : 'option'}
        aria-selected={isSticky ? undefined : isSelected}
        aria-expanded={showTwisty ? row.isExpanded : undefined}
        className={`ms-bc-option${isSelected ? ' is-selected' : ''}${row.isCurrent ? ' is-current' : ''}${isSticky ? ' is-sticky-row' : ''}`}
        style={{ paddingLeft: padLeft }}
        onMouseEnter={!isSticky && !isCoarse ? () => setSelectedIdx(idx) : undefined}
        onPointerDown={(e) => handleRowPointerDown(e, row)}
        onPointerMove={handleRowPointerMove}
        onPointerUp={clearLongPress}
        onPointerCancel={clearLongPress}
        onPointerLeave={clearLongPress}
        onContextMenu={(e) => {
          if (row.kind === 'symbol' && row.symbol) {
            e.preventDefault();
          }
        }}
        onClick={(e) => {
          e.stopPropagation();
          if (longPressTriggeredRef.current) {
            longPressTriggeredRef.current = false;
            return;
          }
          if (isSticky && row.kind === 'symbol' && row.symbol) {
            // Clicking a sticky parent jumps to that parent or scrolls it into view
            revealRow(row);
            onClose(true);
            return;
          }
          activateRow(row);
        }}
      >
        {/* Vertical indent guide lines matching ancestor twisty columns */}
        {!isFiltering && row.depth > 0 && (
          <span className="ms-bc-guides" aria-hidden="true">
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
                  className={`ms-bc-indent-guide${isActiveGuide ? ' is-active' : ''}`}
                  style={{ left: leftPx }}
                />
              );
            })}
          </span>
        )}

        {/* Tree twisty chevron (expand/collapse) */}
        {!isFiltering && (
          <span
            className={`ms-bc-twisty${showTwisty ? ' is-clickable' : ''}`}
            aria-hidden="true"
            onPointerDown={(e) => {
              if (showTwisty) e.stopPropagation();
            }}
            onClick={(e) => {
              if (showTwisty) handleTwistyClick(e, row);
            }}
          >
            {showTwisty && (
              <Icon
                name={row.isExpanded ? 'chevron-down' : 'chevron-right'}
                size={13}
              />
            )}
          </span>
        )}

        {options.icons && (
          <span className="ms-bc-opt-icon">
            {row.kind === 'symbol' ? (
              <Icon
                name={getSymbolIconName((row.symbolKind ?? 12) as any) as any}
                size={16}
                color={palette.iconForSymbolKind(row.symbolKind)}
              />
            ) : (
              <FileIcon name={row.label} isDir={row.kind === 'folder'} />
            )}
          </span>
        )}

        <span className="ms-bc-opt-label">
          {renderHighlightedLabel(row.label, row.matchIndices)}
        </span>

        {showSymbolDetails && row.detail && (
          <span className="ms-bc-opt-detail">{row.detail}</span>
        )}

        {row.isLoadingChildren && (
          <span className="ms-bc-opt-detail">…</span>
        )}

        {isEnterFolderMode && row.kind === 'folder' && (
          <span className="ms-bc-opt-chevron" aria-hidden="true">
            <Icon name="chevron-right" size={12} />
          </span>
        )}
      </div>
    );
  };

  return (
    <div
      ref={containerRef}
      className="ms-bc-dropdown"
      style={{ ...cssVars, left: placed.left, top, width: placed.width }}
      tabIndex={-1}
      role="dialog"
      aria-label={isSymbolMode ? 'Document symbols outline' : 'Folder siblings'}
      onKeyDown={handleKeyDown}
    >
      <span className="ms-bc-arrow" style={{ left: arrowLeft }} aria-hidden="true" />
      <div className="ms-bc-panel" style={{ maxHeight: maxH }}>
        <div className={`ms-bc-filter-row${showFilterRow ? '' : ' is-hidden'}`}>
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
            placeholder={isSymbolMode ? 'Filter symbols...' : 'Filter files...'}
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

        <div className="ms-bc-list-wrap">
          {stickyIndices.length > 0 && (
            <div className="ms-bc-sticky-overlay" aria-hidden="true">
              {stickyIndices.map((rowIdx) => {
                const row = filteredRows[rowIdx];
                return row ? renderTreeRow(row, rowIdx, true) : null;
              })}
            </div>
          )}

          <div
            ref={listRef}
            className="ms-bc-list"
            role="listbox"
            aria-label={isSymbolMode ? 'Outline symbols' : 'Files and folders'}
            onScroll={(e) => setScrollTop(e.currentTarget.scrollTop)}
            onMouseLeave={
              !isCoarse
                ? () =>
                    setSelectedIdx((prev) => {
                      if (isFiltering) return prev;
                      const currentIdx = filteredRows.findIndex((r) => r.isCurrent);
                      return currentIdx >= 0 ? currentIdx : -1;
                    })
                : undefined
            }
          >
            {loading && <div className="ms-bc-empty">Loading…</div>}
            {!loading && filteredRows.length === 0 && (
              <div className="ms-bc-empty">No matching items</div>
            )}
            {!loading && filteredRows.map((row, idx) => renderTreeRow(row, idx, false))}
          </div>
        </div>
      </div>
    </div>
  );
};
