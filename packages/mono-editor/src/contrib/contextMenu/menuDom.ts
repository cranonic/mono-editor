import type { ResolvedMenuGroup } from '../../platform/menus';
import type { DEFAULT_MENU_STYLE } from './types';

export const MORE_ICON_SVG =
  '<svg viewBox="0 0 24 24" fill="currentColor"><circle cx="12" cy="5" r="2"/><circle cx="12" cy="12" r="2"/><circle cx="12" cy="19" r="2"/></svg>';

export const BACK_ICON_SVG =
  '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="15 18 9 12 15 6"/></svg>';

export function appendSvgIcon(parent: HTMLElement, svgSource: string, size: number): void {
  if (!svgSource || typeof DOMParser === 'undefined') return;
  try {
    const parser = new DOMParser();
    const parsed = parser.parseFromString(svgSource, 'image/svg+xml');
    const rootSvg = parsed.documentElement;
    if (rootSvg && rootSvg.tagName.toLowerCase() === 'svg') {
      const svg = document.importNode(rootSvg, true) as unknown as SVGElement;
      svg.setAttribute('width', String(size));
      svg.setAttribute('height', String(size));
      svg.style.display = 'block';
      parent.appendChild(svg);
    }
  } catch { /* ignore malformed icon */ }
}

export function applyMenuRootStyle(
  el: HTMLDivElement,
  style: typeof DEFAULT_MENU_STYLE,
  vertical: boolean,
): void {
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
    touchAction: 'manipulation',
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
  const rows: HTMLElement[] = [];
  let header: HTMLDivElement | null = null;

  if (withBackHeader) {
    header = document.createElement('div');
    header.className = 'mono-ctx-back-header';
    Object.assign(header.style, {
      display: 'flex',
      alignItems: 'center',
      gap: '6px',
      padding: '4px 8px',
      borderBottom: '1px solid rgba(128,128,128,0.22)',
      fontSize: '12px',
      fontWeight: '600',
      color: style.iconColor,
      cursor: 'pointer',
      flexShrink: '0',
    });
    appendSvgIcon(header, BACK_ICON_SVG, 14);
    const backLabel = document.createElement('span');
    backLabel.textContent = 'Back';
    header.appendChild(backLabel);
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
    overscrollBehavior: 'contain',
    padding: '4px 0',
    minWidth: '190px',
    maxWidth: '280px',
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
        e.preventDefault();
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
