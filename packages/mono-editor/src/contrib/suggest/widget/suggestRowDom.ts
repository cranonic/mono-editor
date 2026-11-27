import { CompletionItemKind, type CompletionItem } from '../../../common/languages/providers/types';
import { haptic } from '../../../platform/haptic/haptic';
import { createIcon, kindToCodicon } from '../../../platform/icons';
import {
  kindLabel,
  labelOfItem,
  matchIndexes,
  type SuggestPalette,
  type SuggestWidgetOptions,
} from './suggestStyle';

export function hasItemDocumentation(item: CompletionItem | null | undefined): boolean {
  if (!item) return false;
  if (item.kind === CompletionItemKind.Keyword || item.kind === CompletionItemKind.Text) return false;
  if (typeof item.documentation === 'string' && item.documentation.trim().length > 0) return true;
  if (
    item.documentation &&
    typeof item.documentation === 'object' &&
    typeof item.documentation.value === 'string' &&
    item.documentation.value.trim().length > 0
  ) {
    return true;
  }
  return Boolean(item.detail && item.detail.trim().length > 0);
}

export interface SuggestRowBuildContext {
  item: CompletionItem;
  index: number;
  rowHeight: number;
  iconPx: number;
  filter: string;
  opts: SuggestWidgetOptions;
  pal: SuggestPalette;
  onToggleDocs: () => void;
  onTouchAccept: (index: number) => void;
  onPointerAccept: (index: number) => void;
  onHoverEnter: (index: number) => void;
  onHoverLeave: (index: number) => void;
}

export function buildSuggestRow(ctx: SuggestRowBuildContext): HTMLDivElement {
  const { item, index, rowHeight, iconPx, filter, opts, pal } = ctx;
  const row = document.createElement('div');
  row.setAttribute('role', 'option');
  Object.assign(row.style, {
    display: 'flex',
    alignItems: 'center',
    boxSizing: 'border-box',
    height: `${rowHeight}px`,
    lineHeight: `${rowHeight}px`,
    padding: '0 6px 0 4px',
    cursor: 'pointer',
    whiteSpace: 'pre',
    userSelect: 'none',
  } as CSSStyleDeclaration);
  (row.style as unknown as { webkitUserSelect: string }).webkitUserSelect = 'none';

  if (opts.showIcons !== false) {
    const icon = createIcon(kindToCodicon(item.kind), iconPx);
    Object.assign(icon.style, {
      width: `${iconPx}px`,
      height: `${iconPx}px`,
      lineHeight: `${iconPx}px`,
      fontSize: `${iconPx}px`,
      flexShrink: '0',
      margin: '0 4px 0 2px',
      color: pal.icon(item.kind),
    });
    row.appendChild(icon);
  }

  const lab = document.createElement('span');
  Object.assign(lab.style, { flex: '1 1 auto', minWidth: '0', overflow: 'hidden', textOverflow: 'ellipsis' });
  const text = labelOfItem(item);
  const hits = matchIndexes(text, filter);
  if (!hits) {
    lab.textContent = text;
  } else {
    let run = '';
    let runHit = false;
    const flush = () => {
      if (!run) return;
      if (runHit) {
        const s = document.createElement('span');
        s.textContent = run;
        s.className = 'mono-sg-hl';
        s.style.fontWeight = 'bold';
        lab.appendChild(s);
      } else {
        lab.appendChild(document.createTextNode(run));
      }
      run = '';
    };
    for (let k = 0; k < text.length; k++) {
      const h = hits.has(k);
      if (h !== runHit) {
        flush();
        runHit = h;
      }
      run += text[k];
    }
    flush();
  }
  row.appendChild(lab);

  const right = item.detail || kindLabel(item.kind);
  if (right) {
    const d = document.createElement('span');
    d.className = 'mono-sg-detail';
    d.textContent = right;
    Object.assign(d.style, {
      flex: '0 1 auto',
      maxWidth: '55%',
      marginLeft: '14px',
      overflow: 'hidden',
      textOverflow: 'ellipsis',
      textAlign: 'right',
      fontSize: '85%',
      color: pal.detailForeground,
    });
    row.appendChild(d);
  }

  if (hasItemDocumentation(item)) {
    const infoBtn = document.createElement('button');
    infoBtn.type = 'button';
    infoBtn.className = 'mono-sg-info-btn';
    infoBtn.title = 'Read More (Ctrl+Space)';
    infoBtn.setAttribute('aria-label', 'Toggle Documentation');
    const infoIconPx = Math.max(12, Math.round((opts.fontSize ?? 14) * 0.96));
    const infoBtnPx = Math.max(18, infoIconPx + 4);
    const infoIcon = createIcon('info', infoIconPx);
    infoIcon.style.lineHeight = `${infoIconPx}px`;
    infoIcon.style.fontSize = `${infoIconPx}px`;
    infoBtn.appendChild(infoIcon);
    Object.assign(infoBtn.style, {
      display: 'none',
      alignItems: 'center',
      justifyContent: 'center',
      flexShrink: '0',
      marginLeft: '4px',
      width: `${infoBtnPx}px`,
      height: `${infoBtnPx}px`,
      borderRadius: '3px',
      border: 'none',
      background: 'transparent',
      color: 'inherit',
      lineHeight: '1',
      padding: '0',
      cursor: 'pointer',
    });
    const onToggle = (e: Event) => {
      e.preventDefault();
      e.stopPropagation();
      ctx.onToggleDocs();
    };
    infoBtn.addEventListener('touchstart', (e) => e.stopPropagation(), { passive: true });
    infoBtn.addEventListener('touchend', onToggle, { passive: false });
    infoBtn.addEventListener('pointerdown', (e) => { e.preventDefault(); e.stopPropagation(); });
    infoBtn.addEventListener('pointerup', onToggle);
    infoBtn.addEventListener('click', (e) => { e.preventDefault(); e.stopPropagation(); });
    row.appendChild(infoBtn);
  }

  bindSuggestRowEvents(row, index, ctx);
  return row;
}

function bindSuggestRowEvents(
  row: HTMLDivElement,
  i: number,
  ctx: SuggestRowBuildContext,
): void {
  let startX = 0;
  let startY = 0;
  let moved = false;
  let touchStartX = 0;
  let touchStartY = 0;
  let touchMoved = false;

  row.addEventListener('touchstart', (e: TouchEvent) => {
    const t = e.touches[0];
    if (t) { touchStartX = t.clientX; touchStartY = t.clientY; }
    touchMoved = false;
    e.stopPropagation();
  }, { passive: true });
  row.addEventListener('touchmove', (e: TouchEvent) => {
    const t = e.touches[0];
    if (t && Math.hypot(t.clientX - touchStartX, t.clientY - touchStartY) > 6) touchMoved = true;
  }, { passive: true });
  row.addEventListener('touchend', (e: TouchEvent) => {
    if (touchMoved) return;
    e.preventDefault();
    e.stopPropagation();
    haptic('light');
    ctx.onTouchAccept(i);
  }, { passive: false });
  row.addEventListener('pointerdown', (e) => {
    startX = e.clientX; startY = e.clientY; moved = false;
    if (e.pointerType === 'mouse') e.preventDefault();
    e.stopPropagation();
  });
  row.addEventListener('pointermove', (e) => {
    if (Math.hypot(e.clientX - startX, e.clientY - startY) > 6) moved = true;
  });
  row.addEventListener('pointerup', (e) => {
    if (moved) return;
    e.preventDefault();
    e.stopPropagation();
    ctx.onPointerAccept(i);
  });
  row.addEventListener('click', (e) => {
    e.preventDefault();
    e.stopPropagation();
    if (!moved) ctx.onPointerAccept(i);
  });
  row.addEventListener('pointerenter', (e) => {
    if (e.pointerType !== 'mouse') return;
    ctx.onHoverEnter(i);
  });
  row.addEventListener('pointerleave', (e) => {
    if (e.pointerType !== 'mouse') return;
    ctx.onHoverLeave(i);
  });
}

export function paintSuggestRow(
  row: HTMLDivElement | undefined,
  selected: boolean,
  hovered: boolean,
  docsExpanded: boolean,
  pal: SuggestPalette,
): void {
  if (!row) return;
  row.setAttribute('aria-selected', selected ? 'true' : 'false');
  row.style.background = selected ? pal.selectedBackground : hovered ? pal.hoverBackground : 'transparent';
  row.style.color = selected ? pal.selectedForeground : pal.foreground;
  const hl = selected ? pal.focusHighlight : pal.highlight;
  row.querySelectorAll?.<HTMLElement>('.mono-sg-hl').forEach((h) => (h.style.color = hl));
  const detailEl = row.querySelector?.<HTMLElement>('.mono-sg-detail') ?? null;
  if (detailEl) {
    detailEl.style.color = selected ? pal.selectedDetailForeground : pal.detailForeground;
  }
  const infoBtn = row.querySelector?.<HTMLButtonElement>('.mono-sg-info-btn') ?? null;
  if (infoBtn) {
    infoBtn.style.display = selected ? 'inline-flex' : 'none';
    infoBtn.style.opacity = docsExpanded ? '1' : '0.8';
    infoBtn.setAttribute('aria-pressed', docsExpanded ? 'true' : 'false');
  }
}
