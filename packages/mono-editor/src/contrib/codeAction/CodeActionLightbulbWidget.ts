import type { CodeAction } from '../../common/languages/providers/types';
import { createIcon, ensureCodicons } from '../../platform/icons';
import type { ResolvedWidgetTheme } from '../../platform/theme/widgetTheme';

/**
 * Clickable Code Action Lightbulb + Quick Fix menu (`Ctrl+.`).
 */
export class CodeActionLightbulbWidget {
  private host: HTMLElement;
  private bulbEl: HTMLButtonElement | null = null;
  private menuEl: HTMLDivElement | null = null;
  private theme: ResolvedWidgetTheme | null = null;
  private actions: CodeAction[] = [];
  private fontSize = 14;
  private lineHeight = 20;

  constructor(host: HTMLElement) {
    this.host = host;
  }

  setFontOptions(opts: { fontSize?: number; lineHeight?: number }): void {
    if (opts.fontSize != null && Number.isFinite(opts.fontSize)) {
      this.fontSize = Math.max(8, opts.fontSize);
      if (opts.lineHeight == null) {
        this.lineHeight = Math.round(this.fontSize * 1.45);
      }
    }
    if (opts.lineHeight != null && Number.isFinite(opts.lineHeight)) {
      this.lineHeight = Math.max(12, opts.lineHeight);
    }
  }

  getBulbSize(): number {
    const fs = Math.max(8, this.fontSize || 14);
    const ideal = Math.max(14, Math.round(20 * (fs / 14)));
    const maxH = Math.max(14, Math.round(this.lineHeight || fs * 1.45));
    return Math.min(maxH, ideal);
  }

  isLightbulbVisible(): boolean {
    return !!this.bulbEl;
  }

  applyTheme(theme: ResolvedWidgetTheme): void {
    this.theme = theme;
    if (this.menuEl) {
      this.menuEl.style.background = theme.background;
      this.menuEl.style.border = `1px solid ${theme.border}`;
      this.menuEl.style.color = theme.foreground;
      this.menuEl.style.boxShadow = theme.shadow;
    }
  }

  isMenuOpen(): boolean {
    return !!this.menuEl;
  }

  showLightbulb(
    actions: CodeAction[],
    anchor: { x: number; y: number },
    onPick: (action: CodeAction) => void,
  ): void {
    this.hideLightbulb();
    if (!actions.length) return;
    ensureCodicons();
    this.actions = actions;

    const bulbSize = this.getBulbSize();
    const iconSize = Math.max(11, Math.round(bulbSize * 0.75));
    const bulb = document.createElement('button');
    bulb.type = 'button';
    bulb.className = 'mono-code-action-bulb';
    bulb.title = `Show Code Actions (${actions.length} available) — Ctrl+.`;
    bulb.setAttribute('aria-label', 'Show Code Actions');
    Object.assign(bulb.style, {
      position: 'absolute',
      left: `${Math.max(2, Math.round(anchor.x))}px`,
      top: `${Math.max(2, Math.round(anchor.y))}px`,
      zIndex: '44',
      width: `${bulbSize}px`,
      height: `${bulbSize}px`,
      padding: '0',
      border: 'none',
      borderRadius: '3px',
      background: 'transparent',
      color: '#ffcc00',
      display: 'inline-flex',
      alignItems: 'center',
      justifyContent: 'center',
      cursor: 'pointer',
      pointerEvents: 'auto',
    } as CSSStyleDeclaration);
    bulb.appendChild(createIcon('lightbulb', iconSize));
    bulb.addEventListener('pointerdown', (e) => e.stopPropagation());
    bulb.addEventListener('mousedown', (e) => e.preventDefault());
    bulb.addEventListener('click', (e) => {
      e.preventDefault();
      e.stopPropagation();
      this.openMenu(
        this.actions,
        { x: anchor.x + bulbSize + 2, y: anchor.y + Math.max(14, bulbSize - 2) },
        onPick,
      );
    });
    this.host.appendChild(bulb);
    this.bulbEl = bulb;
  }

  openMenu(
    actions: CodeAction[],
    anchor: { x: number; y: number },
    onPick: (action: CodeAction) => void,
  ): void {
    this.hideMenu();
    ensureCodicons();
    this.actions = actions;

    const bg = this.theme?.background ?? '#252526';
    const border = this.theme?.border ?? '#454545';
    const fg = this.theme?.foreground ?? '#cccccc';
    const muted = this.theme?.mutedForeground ?? '#9d9d9d';
    const hover = this.theme?.hoverBackground ?? 'rgba(255,255,255,0.08)';
    const shadow = this.theme?.shadow ?? '0 6px 20px rgba(0,0,0,0.45)';

    const fs = Math.max(10, Math.round(this.fontSize || 14));
    const scale = fs / 14;
    const menuFontSize = Math.max(11, Math.round(fs * 0.86));
    const kindFontSize = Math.max(9, Math.round(menuFontSize * 0.83));
    const menuIconSize = Math.max(12, Math.round(menuFontSize * 1.08));
    const padY = Math.max(4, Math.round(5 * scale));
    const padX = Math.max(8, Math.round(10 * scale));
    const gap = Math.max(5, Math.round(6 * scale));
    const hostW = this.host.clientWidth || 600;
    const hostH = this.host.clientHeight || 400;
    const minW = Math.min(Math.round(210 * Math.max(1, scale)), Math.max(180, hostW - 12));
    const maxW = Math.min(Math.round(360 * Math.max(1, scale)), Math.max(220, hostW - 12));

    const menu = document.createElement('div');
    menu.className = 'mono-code-action-menu';
    Object.assign(menu.style, {
      position: 'absolute',
      zIndex: '48',
      minWidth: `${minW}px`,
      maxWidth: `${maxW}px`,
      background: bg,
      border: `1px solid ${border}`,
      borderRadius: '4px',
      boxShadow: shadow,
      color: fg,
      fontFamily: 'system-ui, -apple-system, sans-serif',
      fontSize: `${menuFontSize}px`,
      padding: '4px 0',
      pointerEvents: 'auto',
    } as CSSStyleDeclaration);

    if (!actions.length) {
      const empty = document.createElement('div');
      empty.textContent = 'No code actions available';
      empty.style.padding = `${padY + 1}px ${padX}px`;
      empty.style.color = muted;
      menu.appendChild(empty);
    } else {
      for (const act of actions) {
        const row = document.createElement('div');
        Object.assign(row.style, {
          display: 'flex',
          alignItems: 'center',
          gap: `${gap}px`,
          padding: `${padY}px ${padX}px`,
          cursor: 'pointer',
        });
        const icon = createIcon('lightbulb', menuIconSize);
        icon.style.color = '#ffcc00';
        const label = document.createElement('span');
        label.textContent = act.title;
        label.style.flex = '1';
        row.appendChild(icon);
        row.appendChild(label);
        if (act.kind) {
          const k = document.createElement('span');
          k.textContent = act.kind;
          k.style.fontSize = `${kindFontSize}px`;
          k.style.color = muted;
          row.appendChild(k);
        }
        row.addEventListener('pointerenter', () => { row.style.background = hover; });
        row.addEventListener('pointerleave', () => { row.style.background = 'transparent'; });
        row.addEventListener('mousedown', (e) => e.preventDefault());
        row.addEventListener('click', (e) => {
          e.stopPropagation();
          this.hideMenu();
          onPick(act);
        });
        menu.appendChild(row);
      }
    }

    menu.addEventListener('pointerdown', (e) => e.stopPropagation());
    this.host.appendChild(menu);
    this.menuEl = menu;

    const w = menu.offsetWidth;
    const h = menu.offsetHeight;
    let left = Math.max(6, anchor.x);
    let top = Math.max(6, anchor.y);
    if (left + w > hostW - 6) left = Math.max(6, hostW - w - 6);
    if (top + h > hostH - 6) top = Math.max(6, anchor.y - h - (this.getBulbSize() + 2));
    menu.style.left = `${Math.round(left)}px`;
    menu.style.top = `${Math.round(top)}px`;
  }

  hideMenu(): void {
    this.menuEl?.remove();
    this.menuEl = null;
  }

  hideLightbulb(): void {
    this.bulbEl?.remove();
    this.bulbEl = null;
  }

  hideAll(): void {
    this.hideMenu();
    this.hideLightbulb();
  }

  dispose(): void {
    this.hideAll();
  }
}
