import type { ResolvedMenuGroup } from '../../platform/menus';
import type { DEFAULT_MENU_STYLE } from './types';

export const MORE_ICON_SVG =
  '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="currentColor"><circle cx="12" cy="5" r="2.2"/><circle cx="12" cy="12" r="2.2"/><circle cx="12" cy="19" r="2.2"/></svg>';

export const BACK_ICON_SVG =
  '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M19 12H6"/><polyline points="12 18 6 12 12 6"/></svg>';

const CTX_STYLE_ID = 'mono-ctx-menu-style';

function ensureContextMenuStyle(): void {
  if (typeof document === 'undefined' || !document.head) return;
  if (document.getElementById(CTX_STYLE_ID)) return;
  const s = document.createElement('style');
  s.id = CTX_STYLE_ID;
  s.textContent = `
.mono-ctx-vertical-list{scrollbar-width:none;-ms-overflow-style:none}
.mono-ctx-vertical-list::-webkit-scrollbar{display:none;width:0;height:0}
.mono-ctx-menu{scrollbar-width:none;-ms-overflow-style:none}
.mono-ctx-menu::-webkit-scrollbar{display:none;width:0;height:0}
`;
  document.head.appendChild(s);
}

export function appendSvgIcon(parent: HTMLElement, svgSource: string, size: number): void {
  if (!svgSource || typeof DOMParser === 'undefined') return;
  try {
    const normalized = /xmlns\s*=/.test(svgSource)
      ? svgSource
      : svgSource.replace(/<svg\b/i, '<svg xmlns="http://www.w3.org/2000/svg"');
    const parser = new DOMParser();
    const parsed = parser.parseFromString(normalized, 'image/svg+xml');
    const rootSvg = parsed.documentElement;
    if (rootSvg && rootSvg.tagName.toLowerCase() === 'svg') {
      const svg = document.importNode(rootSvg, true) as unknown as SVGElement;
      svg.setAttribute('width', String(size));
      svg.setAttribute('height', String(size));
      svg.style.display = 'block';
      svg.style.flexShrink = '0';
      parent.appendChild(svg);
    }
  } catch { /* ignore malformed icon */ }
}

export function applyMenuRootStyle(
  el: HTMLDivElement,
  style: typeof DEFAULT_MENU_STYLE,
  vertical: boolean,
): void {
  ensureContextMenuStyle();
  Object.assign(el.style, {
    position: 'absolute',
    display: 'flex',
    flexDirection: vertical ? 'column' : 'row',
    alignItems: vertical ? 'stretch' : 'center',
    gap: vertical ? '0px' : style.gap,
    padding: vertical ? '0px' : style.padding,
    background: style.background,
    border: style.border,
    borderRadius: vertical ? '8px' : style.borderRadius,
    boxShadow: style.shadow,
    zIndex: String(style.zIndex),
    pointerEvents: 'auto',
    userSelect: 'none',
    touchAction: vertical ? 'pan-y' : 'manipulation',
    boxSizing: 'border-box',
  } as CSSStyleDeclaration);
  (el.style as unknown as { webkitUserSelect: string }).webkitUserSelect = 'none';
}

export function createMenuToolbarButton(params: {
  label: string;
  iconSvg: string | undefined;
  size: number;
  enabled: boolean;
  id: string;
  style: typeof DEFAULT_MENU_STYLE;
}): HTMLButtonElement {
  const { label, iconSvg, size, enabled, id, style } = params;
  const btn = document.createElement('button');
  btn.type = 'button';
  btn.title = label;
  btn.setAttribute('aria-label', label);
  btn.dataset.menuId = id;
  Object.assign(btn.style, {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    minWidth: `${size + 12}px`,
    height: `${size + 12}px`,
    padding: iconSvg ? '0' : '0 8px',
    margin: '0',
    border: 'none',
    borderRadius: '8px',
    background: 'transparent',
    color: style.iconColor,
    fontSize: '12px',
    opacity: enabled ? '1' : String(style.disabledOpacity),
    cursor: enabled ? 'pointer' : 'default',
    pointerEvents: enabled ? 'auto' : 'none',
  });
  if (iconSvg) appendSvgIcon(btn, iconSvg, size);
  else btn.textContent = label;
  btn.addEventListener('pointerdown', (ev) => {
    ev.preventDefault();
    ev.stopPropagation();
  });
  return btn;
}

export function renderVerticalMenuList(params: {
  container: HTMLElement;
  groups: ResolvedMenuGroup[];
  withBackHeader: boolean;
  showIcons: boolean;
  showShortcuts: boolean;
  style: typeof DEFAULT_MENU_STYLE;
  getShortcutLabel?: (commandId: string) => string | undefined;
  onBack: () => void;
  onInvoke: (command: string, args?: unknown[]) => Promise<void>;
}): { header: HTMLElement | null; rows: HTMLElement[] } {
  const { container, groups, withBackHeader, showIcons, showShortcuts, style, getShortcutLabel, onBack, onInvoke } =
    params;
  ensureContextMenuStyle();
  const rows: HTMLElement[] = [];
  let header: HTMLButtonElement | null = null;

  if (withBackHeader) {
    header = document.createElement('button');
    header.type = 'button';
    header.className = 'mono-ctx-back-header';
    header.title = 'Back';
    header.setAttribute('aria-label', 'Back');
    Object.assign(header.style, {
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'flex-start',
      width: '100%',
      height: '28px',
      padding: '0 10px',
      border: 'none',
      borderBottom: '1px solid rgba(128,128,128,0.22)',
      background: 'transparent',
      color: style.iconColor,
      cursor: 'pointer',
      flexShrink: '0',
      boxSizing: 'border-box',
    });
    appendSvgIcon(header, BACK_ICON_SVG, 16);
    header.addEventListener('pointerenter', () => {
      header!.style.background = 'rgba(128,128,128,0.14)';
    });
    header.addEventListener('pointerleave', () => {
      header!.style.background = 'transparent';
    });
    header.addEventListener('pointerdown', (e) => {
      e.preventDefault();
      e.stopPropagation();
    });
    header.addEventListener('click', (e) => {
      e.preventDefault();
      e.stopPropagation();
      onBack();
    });
    container.appendChild(header);
  }

  const body = document.createElement('div');
  body.className = 'mono-ctx-vertical-list';
  Object.assign(body.style, {
    display: 'flex',
    flexDirection: 'column',
    overflowY: 'auto',
    overflowX: 'hidden',
    overscrollBehavior: 'contain',
    scrollbarWidth: 'none',
    padding: '3px 0',
    minWidth: '180px',
    maxWidth: '260px',
    maxHeight: withBackHeader ? '192px' : '220px',
  });
  (body.style as unknown as { WebkitOverflowScrolling: string }).WebkitOverflowScrolling = 'touch';
  body.addEventListener('pointerdown', (e) => {
    // Allow native touch vertical scrolling inside the list without dismissing or passing to canvas
    e.stopPropagation();
  });

  groups.forEach((grp, gIdx) => {
    if (gIdx > 0) {
      const sep = document.createElement('div');
      sep.setAttribute('role', 'separator');
      Object.assign(sep.style, {
        height: '1px',
        margin: '4px 8px',
        background: 'rgba(128,128,128,0.22)',
        flexShrink: '0',
      });
      body.appendChild(sep);
    }

    for (const { entry, enabled } of grp.items) {
      const row = document.createElement('button');
      row.type = 'button';
      row.setAttribute('role', 'menuitem');
      row.dataset.menuId = entry.id;
      row.disabled = !enabled;
      Object.assign(row.style, {
        display: 'flex',
        alignItems: 'center',
        gap: '8px',
        width: '100%',
        minHeight: '30px',
        padding: '5px 12px',
        border: 'none',
        background: 'transparent',
        color: style.iconColor,
        opacity: enabled ? '1' : String(style.disabledOpacity),
        fontSize: '13px',
        fontFamily: 'system-ui, -apple-system, sans-serif',
        textAlign: 'left',
        cursor: enabled ? 'pointer' : 'default',
        whiteSpace: 'nowrap',
        boxSizing: 'border-box',
      });

      if (showIcons) {
        const iconSlot = document.createElement('span');
        Object.assign(iconSlot.style, {
          width: '16px',
          height: '16px',
          display: 'inline-flex',
          alignItems: 'center',
          justifyContent: 'center',
          flexShrink: '0',
        });
        if (entry.icon) appendSvgIcon(iconSlot, entry.icon, 15);
        row.appendChild(iconSlot);
      }

      const label = document.createElement('span');
      label.textContent = entry.title;
      label.style.flex = '1 1 auto';
      label.style.overflow = 'hidden';
      label.style.textOverflow = 'ellipsis';
      row.appendChild(label);

      if (showShortcuts && getShortcutLabel) {
        const sc = getShortcutLabel(entry.command);
        if (sc) {
          const scEl = document.createElement('span');
          scEl.className = 'mono-ctx-shortcut';
          scEl.textContent = sc;
          Object.assign(scEl.style, {
            marginLeft: '16px',
            fontSize: '11px',
            opacity: '0.62',
            flexShrink: '0',
          });
          row.appendChild(scEl);
        }
      }

      row.addEventListener('pointerenter', () => {
        if (enabled) row.style.background = 'rgba(128,128,128,0.16)';
      });
      row.addEventListener('pointerleave', () => {
        row.style.background = 'transparent';
      });
      row.addEventListener('pointerdown', (e) => {
        if (e.pointerType === 'mouse') e.preventDefault();
        e.stopPropagation();
      });
      row.addEventListener('click', async (e) => {
        e.preventDefault();
        e.stopPropagation();
        if (!enabled) return;
        await onInvoke(entry.command, entry.args);
      });

      body.appendChild(row);
      rows.push(row);
    }
  });

  if (rows.length > 0) container.appendChild(body);
  return { header, rows };
}
