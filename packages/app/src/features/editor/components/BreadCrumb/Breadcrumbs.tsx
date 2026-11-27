// src/features/editor/components/BreadCrumb/Breadcrumbs.tsx
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { IBreadcrumbItem, IBreadcrumbsSnapshot, IMonoEditor } from '@mono/editor';
import { Icon } from '@/ui/components/Icon/IconRegistry';
import { FileIcon } from '@/ui/components/FileIcon/DefaultIconTheme';
import { getSymbolIconName } from '@/core/symbols/utils/iconMap';
import { createAppBreadcrumbsPathProvider } from './pathProvider';
import { BreadcrumbsDropdown } from './BreadcrumbsDropdown';
import './Breadcrumbs.css';

export interface BreadcrumbsProps {
  editor?: IMonoEditor | null;
  filePath?: string;
  showBreadcrumb?: boolean;
}

export const Breadcrumbs: React.FC<BreadcrumbsProps> = ({
  editor,
  filePath = '',
  showBreadcrumb = true,
}) => {
  const barRef = useRef<HTMLDivElement>(null);
  const segRefs = useRef<Map<number, HTMLButtonElement>>(new Map());
  const [snapshot, setSnapshot] = useState<IBreadcrumbsSnapshot | null>(null);
  const [anchorRect, setAnchorRect] = useState<DOMRect | null>(null);
  const [hostRect, setHostRect] = useState<DOMRect | null>(null);

  const model = useMemo(() => editor?.getBreadcrumbs?.() ?? null, [editor]);

  // Attach workspace/FS path provider and subscribe to model snapshots
  useEffect(() => {
    if (!model) {
      setSnapshot(null);
      return;
    }
    const provider = createAppBreadcrumbsPathProvider(filePath);
    model.setPathProvider(provider);
    setSnapshot(model.getSnapshot());
    const sub = model.onDidChange((next) => {
      setSnapshot(next);
    });
    return () => {
      sub.dispose();
    };
  }, [model, filePath]);

  // Keep active / focused segment scrolled into view + update anchor rect when picker is open
  useEffect(() => {
    if (!snapshot || snapshot.items.length === 0) return;
    const targetIdx =
      snapshot.focusedIndex >= 0
        ? Math.min(snapshot.focusedIndex, snapshot.items.length - 1)
        : snapshot.items.length - 1;

    const segEl = segRefs.current.get(targetIdx);
    if (segEl) {
      segEl.scrollIntoView({ inline: 'nearest', block: 'nearest' });
      if (snapshot.pickerOpen) {
        setAnchorRect(segEl.getBoundingClientRect());
        const hostEl =
          barRef.current?.closest('.ms-code-editor-container') ??
          barRef.current?.parentElement;
        if (hostEl) {
          setHostRect(hostEl.getBoundingClientRect());
        }
      }
    }
  }, [snapshot]);

  const handleSegmentClick = useCallback(
    (idx: number) => {
      if (!model || !snapshot) return;
      if (snapshot.pickerOpen && snapshot.focusedIndex === idx) {
        model.setPickerOpen(false);
        return;
      }
      model.setFocusedIndex(idx, true);
    },
    [model, snapshot],
  );

  const handleClose = useCallback(
    (refocusEditor = false) => {
      if (!model) return;
      model.setPickerOpen(false);
      if (refocusEditor) {
        model.selectEditor();
      }
    },
    [model],
  );

  const handleStepSegment = useCallback(
    (delta: -1 | 1) => {
      if (!model) return;
      if (delta > 0) model.focusNext(true);
      else model.focusPrevious(true);
    },
    [model],
  );

  const handleBarKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (!model || !snapshot) return;
      if (e.key === 'ArrowRight') {
        e.preventDefault();
        model.focusNext(false);
      } else if (e.key === 'ArrowLeft') {
        e.preventDefault();
        model.focusPrevious(false);
      } else if (e.key === 'Enter' || e.key === 'ArrowDown') {
        e.preventDefault();
        model.setPickerOpen(true);
      } else if (e.key === ' ') {
        e.preventDefault();
        model.revealFocused();
      } else if (e.key === 'Escape') {
        e.preventDefault();
        model.selectEditor();
      }
    },
    [model, snapshot],
  );

  if (!showBreadcrumb || !editor || !model || !snapshot || !snapshot.enabled) {
    return null;
  }

  const items = snapshot.items;
  if (items.length === 0) return null;

  const activeItem: IBreadcrumbItem | undefined =
    snapshot.focusedIndex >= 0 ? items[snapshot.focusedIndex] : undefined;

  return (
    <>
      <nav
        ref={barRef}
        className="ms-breadcrumbs-container"
        aria-label="Breadcrumbs"
        onKeyDown={handleBarKeyDown}
      >
        {items.map((item, idx) => {
          const isFocused = snapshot.focusedIndex === idx;
          const isLast = idx === items.length - 1;
          return (
            <React.Fragment key={`${item.id}:${idx}`}>
              {idx > 0 && (
                <span className="ms-breadcrumb-separator" aria-hidden="true">
                  <Icon name="chevron-right" size={12} />
                </span>
              )}
              <button
                type="button"
                ref={(el) => {
                  if (el) segRefs.current.set(idx, el);
                  else segRefs.current.delete(idx);
                }}
                className={`ms-breadcrumb-item${isFocused ? ' is-focused' : ''}${isLast ? ' is-last' : ''}`}
                aria-haspopup="listbox"
                aria-expanded={snapshot.pickerOpen && isFocused}
                title={item.path || item.label}
                onClick={(e) => {
                  e.stopPropagation();
                  handleSegmentClick(idx);
                }}
              >
                {snapshot.options.icons && (
                  <span className="ms-breadcrumb-icon">
                    {item.kind === 'symbol' ? (
                      <Icon
                        name={getSymbolIconName((item.symbolKind ?? 12) as any) as any}
                        size={13}
                      />
                    ) : (
                      <FileIcon name={item.label} isDir={item.kind === 'folder'} />
                    )}
                  </span>
                )}
                <span className="ms-breadcrumb-label">{item.label}</span>
              </button>
            </React.Fragment>
          );
        })}
      </nav>

      {snapshot.pickerOpen && activeItem && anchorRect && hostRect && (
        <BreadcrumbsDropdown
          editor={editor}
          model={model}
          anchorRect={anchorRect}
          hostRect={hostRect}
          activeItem={activeItem}
          options={snapshot.options}
          onClose={handleClose}
          onStepSegment={handleStepSegment}
        />
      )}
    </>
  );
};
