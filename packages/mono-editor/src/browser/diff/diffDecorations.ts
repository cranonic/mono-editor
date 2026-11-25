import type { IRange, IViewZone } from '../../common/core/types';
import type { IModelDeltaDecoration } from '../../common/decorations/types';
import type { ILineChange } from '../../common/diff/myersDiff';
import type { ResolvedWidgetTheme } from '../../platform/theme/widgetTheme';
import type { IMonoEditor } from '../editor/editorTypes';
import { renderHighlightedCodeToDom } from '../render/markdownDom';
import type { IHideUnchangedRegionsOptions } from './diffTypes';

export interface DiffVisualState {
  origZoneIds: string[];
  modZoneIds: string[];
  origDecIds: string[];
  modDecIds: string[];
  expandedHiddenKeys: Set<string>;
}

export interface DiffVisualApplyArgs {
  originalEditor: IMonoEditor;
  modifiedEditor: IMonoEditor;
  changes: readonly ILineChange[];
  inlineMode: boolean;
  renderIndicators: boolean;
  renderOverviewRuler: boolean;
  renderMarginRevertIcon: boolean;
  canRevert: boolean;
  hideUnchangedRegions?: IHideUnchangedRegionsOptions;
  theme: ResolvedWidgetTheme;
  fontFamily: string;
  fontSize: number;
  lineHeight: number;
  state: DiffVisualState;
  onRevertHunk: (change: ILineChange) => void;
  onExpandHiddenRegion: (key: string) => void;
}

const DEL_LINE_BG = 'rgba(239, 68, 68, 0.16)';
const INS_LINE_BG = 'rgba(34, 197, 94, 0.16)';
const DEL_CHAR_BG = 'rgba(239, 68, 68, 0.34)';
const INS_CHAR_BG = 'rgba(34, 197, 94, 0.34)';
const DEL_MARKER = '#ef4444';
const INS_MARKER = '#22c55e';

function makeFillerNode(heightPx: number, isDark: boolean): HTMLDivElement {
  const el = document.createElement('div');
  el.className = 'mono-diff-filler-zone';
  const stripe = isDark ? 'rgba(255,255,255,0.045)' : 'rgba(0,0,0,0.045)';
  Object.assign(el.style, {
    width: '100%',
    height: `${Math.max(0, heightPx)}px`,
    pointerEvents: 'none',
    backgroundImage: `repeating-linear-gradient(-45deg, transparent, transparent 5px, ${stripe} 5px, ${stripe} 10px)`,
    boxSizing: 'border-box',
  });
  return el;
}

function makeInlineDeletedZoneNode(
  lines: string[],
  langId: string,
  fontFamily: string,
  fontSize: number,
  lineHeight: number,
  theme: ResolvedWidgetTheme,
  canRevert: boolean,
  onRevert: () => void,
): HTMLDivElement {
  const wrap = document.createElement('div');
  wrap.className = 'mono-diff-inline-deleted-zone';
  Object.assign(wrap.style, {
    width: '100%',
    minHeight: `${Math.max(1, lines.length) * lineHeight}px`,
    background: DEL_LINE_BG,
    borderLeft: `3px solid ${DEL_MARKER}`,
    boxSizing: 'border-box',
    position: 'relative',
    fontFamily,
    fontSize: `${fontSize}px`,
    lineHeight: `${lineHeight}px`,
    overflowX: 'auto',
    overflowY: 'hidden',
    userSelect: 'text',
  });

  if (canRevert) {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.textContent = '↩ Revert';
    btn.title = 'Revert deleted lines';
    Object.assign(btn.style, {
      position: 'sticky',
      float: 'right',
      right: '8px',
      top: '2px',
      margin: '2px 6px 0 0',
      padding: '1px 6px',
      borderRadius: '4px',
      border: `1px solid ${theme.border}`,
      background: theme.background,
      color: theme.foreground,
      fontSize: '11px',
      lineHeight: '16px',
      cursor: 'pointer',
      zIndex: '2',
    });
    btn.addEventListener('pointerdown', (e) => e.stopPropagation());
    btn.addEventListener('click', (e) => {
      e.preventDefault();
      e.stopPropagation();
      onRevert();
    });
    wrap.appendChild(btn);
  }

  for (const text of lines) {
    const row = document.createElement('div');
    Object.assign(row.style, {
      height: `${lineHeight}px`,
      lineHeight: `${lineHeight}px`,
      whiteSpace: 'pre',
      paddingLeft: '8px',
      paddingRight: '8px',
      opacity: '0.88',
    });
    const sign = document.createElement('span');
    sign.textContent = '- ';
    sign.style.color = DEL_MARKER;
    sign.style.fontWeight = '700';
    sign.style.userSelect = 'none';
    row.appendChild(sign);
    const code = document.createElement('span');
    renderHighlightedCodeToDom(code, text, langId, theme.foreground);
    row.appendChild(code);
    wrap.appendChild(row);
  }

  return wrap;
}

function makeExpandHiddenZoneNode(
  hiddenCount: number,
  theme: ResolvedWidgetTheme,
  onExpand: () => void,
): HTMLDivElement {
  const row = document.createElement('div');
  row.className = 'mono-diff-unchanged-zone';
  Object.assign(row.style, {
    width: '100%',
    height: '24px',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    gap: '8px',
    background: theme.isDark ? 'rgba(255,255,255,0.05)' : 'rgba(0,0,0,0.05)',
    borderTop: `1px solid ${theme.border}`,
    borderBottom: `1px solid ${theme.border}`,
    color: theme.mutedForeground,
    fontSize: '11px',
    fontFamily: 'system-ui, -apple-system, sans-serif',
    cursor: 'pointer',
    userSelect: 'none',
    boxSizing: 'border-box',
  });
  row.textContent = `⋯ ${hiddenCount} unchanged line${hiddenCount === 1 ? '' : 's'} — click to expand ⋯`;
  row.addEventListener('pointerdown', (e) => e.stopPropagation());
  row.addEventListener('click', (e) => {
    e.preventDefault();
    e.stopPropagation();
    onExpand();
  });
  return row;
}

/**
 * Applies diff line/char decorations, overview ruler ticks, filler view zones (split alignment),
 * inline syntax-highlighted deleted blocks, and optional unchanged-region folding.
 */
export function applyDiffVisuals(args: DiffVisualApplyArgs): void {
  const {
    originalEditor,
    modifiedEditor,
    changes,
    inlineMode,
    renderIndicators,
    renderOverviewRuler,
    renderMarginRevertIcon,
    canRevert,
    hideUnchangedRegions,
    theme,
    fontFamily,
    fontSize,
    lineHeight,
    state,
    onRevertHunk,
    onExpandHiddenRegion,
  } = args;

  const origModel = originalEditor.getModel();
  const modModel = modifiedEditor.getModel();
  const origLineCount = origModel.getLineCount();
  const modLineCount = modModel.getLineCount();

  const origDecs: IModelDeltaDecoration[] = [];
  const modDecs: IModelDeltaDecoration[] = [];
  const origZones: IViewZone[] = [];
  const modZones: IViewZone[] = [];

  for (const ch of changes) {
    const delCount = ch.originalEndLineNumber > 0
      ? ch.originalEndLineNumber - ch.originalStartLineNumber + 1
      : 0;
    const insCount = ch.modifiedEndLineNumber > 0
      ? ch.modifiedEndLineNumber - ch.modifiedStartLineNumber + 1
      : 0;

    // 1) Line-level decorations on Original editor
    if (delCount > 0) {
      for (let ln = ch.originalStartLineNumber; ln <= ch.originalEndLineNumber; ln++) {
        origDecs.push({
          range: { startLineNumber: ln, startColumn: 1, endLineNumber: ln, endColumn: 1 },
          options: {
            isWholeLine: true,
            monoBackgroundColor: DEL_LINE_BG,
            className: 'mono-diff-line-delete',
            ...(renderIndicators ? { glyphMarginSymbol: '−', glyphMarginColor: DEL_MARKER } : {}),
            ...(renderOverviewRuler ? { overviewRuler: { color: DEL_MARKER, position: 1 } } : {}),
          },
        });
      }
    }

    // 2) Line-level decorations on Modified editor
    if (insCount > 0) {
      for (let ln = ch.modifiedStartLineNumber; ln <= ch.modifiedEndLineNumber; ln++) {
        modDecs.push({
          range: { startLineNumber: ln, startColumn: 1, endLineNumber: ln, endColumn: 1 },
          options: {
            isWholeLine: true,
            monoBackgroundColor: INS_LINE_BG,
            className: 'mono-diff-line-insert',
            ...(renderIndicators ? { glyphMarginSymbol: '+', glyphMarginColor: INS_MARKER } : {}),
            ...(renderOverviewRuler ? { overviewRuler: { color: INS_MARKER, position: 4 } } : {}),
          },
        });
      }
    }

    // 3) Character-level highlights inside modified lines
    if (ch.charChanges?.length) {
      for (const cc of ch.charChanges) {
        if (cc.originalEndColumn > cc.originalStartColumn) {
          origDecs.push({
            range: {
              startLineNumber: cc.originalStartLineNumber,
              startColumn: cc.originalStartColumn,
              endLineNumber: cc.originalEndLineNumber,
              endColumn: cc.originalEndColumn,
            },
            options: {
              monoBackgroundColor: DEL_CHAR_BG,
              inlineClassName: 'mono-diff-char-delete',
            },
          });
        }
        if (cc.modifiedEndColumn > cc.modifiedStartColumn) {
          modDecs.push({
            range: {
              startLineNumber: cc.modifiedStartLineNumber,
              startColumn: cc.modifiedStartColumn,
              endLineNumber: cc.modifiedEndLineNumber,
              endColumn: cc.modifiedEndColumn,
            },
            options: {
              monoBackgroundColor: INS_CHAR_BG,
              inlineClassName: 'mono-diff-char-insert',
            },
          });
        }
      }
    }

    // 4) Alignment view zones
    if (inlineMode) {
      if (delCount > 0) {
        const deletedLines: string[] = [];
        for (let ln = ch.originalStartLineNumber; ln <= ch.originalEndLineNumber; ln++) {
          deletedLines.push(origModel.getLineContent(ln));
        }
        const afterLine =
          ch.modifiedEndLineNumber > 0
            ? Math.max(0, ch.modifiedStartLineNumber - 1)
            : Math.max(0, ch.modifiedStartLineNumber);
        const zoneNode = makeInlineDeletedZoneNode(
          deletedLines,
          origModel.getLanguageId(),
          fontFamily,
          fontSize,
          lineHeight,
          theme,
          renderMarginRevertIcon && canRevert,
          () => onRevertHunk(ch),
        );
        modZones.push({
          afterLineNumber: Math.min(afterLine, modLineCount),
          heightInPx: Math.max(lineHeight, deletedLines.length * lineHeight),
          domNode: zoneNode,
        });
      }
    } else {
      // Split mode: pad shorter side with striped filler view zone so scroll positions align 1:1
      if (insCount > delCount) {
        const padRows = insCount - delCount;
        const afterOrig = delCount > 0 ? ch.originalEndLineNumber : ch.originalStartLineNumber;
        origZones.push({
          afterLineNumber: Math.max(0, Math.min(afterOrig, origLineCount)),
          heightInPx: padRows * lineHeight,
          domNode: makeFillerNode(padRows * lineHeight, theme.isDark),
        });
      } else if (delCount > insCount) {
        const padRows = delCount - insCount;
        const afterMod = insCount > 0 ? ch.modifiedEndLineNumber : ch.modifiedStartLineNumber;
        modZones.push({
          afterLineNumber: Math.max(0, Math.min(afterMod, modLineCount)),
          heightInPx: padRows * lineHeight,
          domNode: makeFillerNode(padRows * lineHeight, theme.isDark),
        });
      }
    }
  }

  // 5) Optional hideUnchangedRegions (default disabled)
  const origHidden: IRange[] = [];
  const modHidden: IRange[] = [];
  if (hideUnchangedRegions?.enabled && changes.length > 0) {
    const ctx = Math.max(0, hideUnchangedRegions.contextLineCount ?? 3);
    const minLen = Math.max(1, hideUnchangedRegions.minimumLineCount ?? 3);
    let prevOrigEnd = 0;
    let prevModEnd = 0;

    const addUnchangedGap = (oStart: number, oEnd: number, mStart: number, mEnd: number) => {
      const oLen = oEnd - oStart + 1;
      const mLen = mEnd - mStart + 1;
      if (oLen < minLen || mLen < minLen) return;
      const key = `${oStart}:${oEnd}:${mStart}:${mEnd}`;
      if (state.expandedHiddenKeys.has(key)) return;
      origHidden.push({ startLineNumber: oStart, startColumn: 1, endLineNumber: oEnd, endColumn: 1 });
      modHidden.push({ startLineNumber: mStart, startColumn: 1, endLineNumber: mEnd, endColumn: 1 });
      const bannerH = 24;
      origZones.push({
        afterLineNumber: Math.max(0, oStart - 1),
        heightInPx: bannerH,
        domNode: makeExpandHiddenZoneNode(oLen, theme, () => onExpandHiddenRegion(key)),
      });
      modZones.push({
        afterLineNumber: Math.max(0, mStart - 1),
        heightInPx: bannerH,
        domNode: makeExpandHiddenZoneNode(mLen, theme, () => onExpandHiddenRegion(key)),
      });
    };

    for (const ch of changes) {
      const chOrigStart = ch.originalEndLineNumber > 0 ? ch.originalStartLineNumber : ch.originalStartLineNumber + 1;
      const chModStart = ch.modifiedEndLineNumber > 0 ? ch.modifiedStartLineNumber : ch.modifiedStartLineNumber + 1;
      const gapOStart = prevOrigEnd === 0 ? 1 : prevOrigEnd + ctx + 1;
      const gapOEnd = chOrigStart - ctx - 1;
      const gapMStart = prevModEnd === 0 ? 1 : prevModEnd + ctx + 1;
      const gapMEnd = chModStart - ctx - 1;
      if (gapOEnd >= gapOStart && gapMEnd >= gapMStart) {
        addUnchangedGap(gapOStart, gapOEnd, gapMStart, gapMEnd);
      }
      prevOrigEnd = ch.originalEndLineNumber > 0 ? ch.originalEndLineNumber : ch.originalStartLineNumber;
      prevModEnd = ch.modifiedEndLineNumber > 0 ? ch.modifiedEndLineNumber : ch.modifiedStartLineNumber;
    }
    const tailOStart = prevOrigEnd + ctx + 1;
    const tailMStart = prevModEnd + ctx + 1;
    if (origLineCount >= tailOStart && modLineCount >= tailMStart) {
      addUnchangedGap(tailOStart, origLineCount, tailMStart, modLineCount);
    }
  }

  originalEditor.setHiddenAreas(origHidden);
  modifiedEditor.setHiddenAreas(modHidden);

  state.origDecIds = originalEditor.deltaDecorations(state.origDecIds, origDecs);
  state.modDecIds = modifiedEditor.deltaDecorations(state.modDecIds, modDecs);

  originalEditor.changeViewZones((acc) => {
    for (const id of state.origZoneIds) acc.removeZone(id);
    state.origZoneIds = [];
    for (const z of origZones) state.origZoneIds.push(acc.addZone(z));
  });

  modifiedEditor.changeViewZones((acc) => {
    for (const id of state.modZoneIds) acc.removeZone(id);
    state.modZoneIds = [];
    for (const z of modZones) state.modZoneIds.push(acc.addZone(z));
  });
}
