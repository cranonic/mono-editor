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

  constructor(host: HTMLElement) {
    this.host = host;
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
      width: '20px',
      height: '20px',
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
    bulb.appendChild(createIcon('lightbulb', 15));
    bulb.addEventListener('pointerdown', (e) => e.stopPropagation());
    bulb.addEventListener('mousedown', (e) => e.preventDefault());
    bulb.addEventListener('click', (e) => {
      e.preventDefault();
      e.stopPropagation();
      this.openMenu(this.actions, { x: anchor.x + 22, y: anchor.y + 18 }, onPick);
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

    const menu = document.createElement('div');
    menu.className = 'mono-code-action-menu';
    Object.assign(menu.style, {
      position: 'absolute',
      zIndex: '48',
      minWidth: '210px',
      maxWidth: '360px',
      background: bg,
      border: `1px solid ${border}`,
      borderRadius: '4px',
      boxShadow: shadow,
      color: fg,
      fontFamily: 'system-ui, -apple-system, sans-serif',
      fontSize: '12px',
      padding: '4px 0',
      pointerEvents: 'auto',
    } as CSSStyleDeclaration);

    if (!actions.length) {
      const empty = document.createElement('div');
      empty.textContent = 'No code actions available';
      empty.style.padding = '6px 10px';
      empty.style.color = muted;
      menu.appendChild(empty);
    } else {
      for (const act of actions) {
        const row = document.createElement('div');
        Object.assign(row.style, {
          display: 'flex',
          alignItems: 'center',
          gap: '6px',
          padding: '5px 10px',
          cursor: 'pointer',
        });
        const icon = createIcon('lightbulb', 13);
        icon.style.color = '#ffcc00';
        const label = document.createElement('span');
        label.textContent = act.title;
        label.style.flex = '1';
        row.appendChild(icon);
        row.appendChild(label);
        if (act.kind) {
          const k = document.createElement('span');
          k.textContent = act.kind;
          k.style.fontSize = '10px';
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

    const hostW = this.host.clientWidth || 600;
    const hostH = this.host.clientHeight || 400;
    const w = menu.offsetWidth;
    const h = menu.offsetHeight;
    let left = Math.max(6, anchor.x);
    let top = Math.max(6, anchor.y);
    if (left + w > hostW - 6) left = Math.max(6, hostW - w - 6);
    if (top + h > hostH - 6) top = Math.max(6, anchor.y - h - 22);
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
