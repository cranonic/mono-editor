import {
  ContentWidgetPositionPreference,
  OverlayWidgetPositionPreference,
} from '../../common/core/enums';
import type {
  IContentWidget,
  IOverlayWidget,
  IViewZone,
  IViewZoneChangeAccessor,
} from '../../common/core/types';
import type { ViewZoneSpec } from './viewLayout';

export interface WidgetLayoutHost {
  readonly root: HTMLElement;
  getLineHeight(): number;
  getContentLeft(): number;
  getCssWidth(): number;
  getCssHeight(): number;
  screenPosOf(lineNumber: number, column: number): { x: number; y: number; h: number };
  getZoneTopForLine(afterLineNumber: number, zoneId: string): number;
  onZonesChanged(zones: readonly ViewZoneSpec[]): void;
}

interface StoredZone {
  id: string;
  zone: IViewZone;
  wrapper: HTMLDivElement;
  marginWrapper?: HTMLDivElement;
  spec: ViewZoneSpec;
}

/**
 * Manages Monaco-compatible ContentWidgets, OverlayWidgets, and multi-zone ViewZones
 * anchored cleanly inside the editor DOM overlay layer.
 */
export class EditorWidgetManager {
  private readonly host: WidgetLayoutHost;
  private readonly contentLayer: HTMLDivElement;
  private readonly overlayLayer: HTMLDivElement;
  private readonly zoneLayer: HTMLDivElement;

  private contentWidgets = new Map<string, IContentWidget>();
  private overlayWidgets = new Map<string, IOverlayWidget>();
  private viewZones = new Map<string, StoredZone>();
  private nextZoneId = 1;

  constructor(host: WidgetLayoutHost) {
    this.host = host;

    this.zoneLayer = document.createElement('div');
    Object.assign(this.zoneLayer.style, {
      position: 'absolute',
      inset: '0',
      pointerEvents: 'none',
      overflow: 'hidden',
      zIndex: '12',
    });

    this.contentLayer = document.createElement('div');
    Object.assign(this.contentLayer.style, {
      position: 'absolute',
      inset: '0',
      pointerEvents: 'none',
      overflow: 'visible',
      zIndex: '28',
    });

    this.overlayLayer = document.createElement('div');
    Object.assign(this.overlayLayer.style, {
      position: 'absolute',
      inset: '0',
      pointerEvents: 'none',
      overflow: 'hidden',
      zIndex: '30',
    });

    host.root.appendChild(this.zoneLayer);
    host.root.appendChild(this.contentLayer);
    host.root.appendChild(this.overlayLayer);
  }

  // ── Content Widgets ────────────────────────────────────────────────────────

  addContentWidget(widget: IContentWidget): void {
    const id = widget.getId();
    if (this.contentWidgets.has(id)) {
      this.layoutContentWidget(widget);
      return;
    }
    this.contentWidgets.set(id, widget);
    const node = widget.getDomNode() as HTMLElement | null;
    if (node) {
      node.style.position = 'absolute';
      node.style.pointerEvents = 'auto';
      if (!this.contentLayer.contains(node)) this.contentLayer.appendChild(node);
    }
    this.layoutContentWidget(widget);
  }

  layoutContentWidget(widget: IContentWidget): void {
    const node = widget.getDomNode() as HTMLElement | null;
    if (!node) return;
    const posSpec = widget.getPosition();
    if (!posSpec || !posSpec.position) {
      node.style.display = 'none';
      return;
    }
    node.style.display = '';
    const coords = this.host.screenPosOf(posSpec.position.lineNumber, posSpec.position.column);
    const pref = posSpec.preference[0] ?? ContentWidgetPositionPreference.BELOW;
    const w = node.offsetWidth || 120;
    const h = node.offsetHeight || this.host.getLineHeight();
    const maxW = Math.max(0, this.host.getCssWidth());
    const maxH = Math.max(0, this.host.getCssHeight());

    let top = coords.y;
    if (pref === ContentWidgetPositionPreference.ABOVE) {
      top = coords.y - h;
      if (top < 0 && posSpec.preference.includes(ContentWidgetPositionPreference.BELOW)) {
        top = coords.y + coords.h;
      }
    } else if (pref === ContentWidgetPositionPreference.BELOW) {
      top = coords.y + coords.h;
      if (top + h > maxH && posSpec.preference.includes(ContentWidgetPositionPreference.ABOVE)) {
        top = Math.max(0, coords.y - h);
      }
    }
    const left = Math.max(0, Math.min(Math.max(0, maxW - w), coords.x));
    node.style.left = `${Math.round(left)}px`;
    node.style.top = `${Math.round(top)}px`;
  }

  removeContentWidget(widget: IContentWidget): void {
    const id = widget.getId();
    this.contentWidgets.delete(id);
    const node = widget.getDomNode() as HTMLElement | null;
    if (node && node.parentElement === this.contentLayer) node.remove();
  }

  // ── Overlay Widgets ────────────────────────────────────────────────────────

  addOverlayWidget(widget: IOverlayWidget): void {
    const id = widget.getId();
    if (this.overlayWidgets.has(id)) {
      this.layoutOverlayWidget(widget);
      return;
    }
    this.overlayWidgets.set(id, widget);
    const node = widget.getDomNode() as HTMLElement | null;
    if (node) {
      node.style.position = 'absolute';
      node.style.pointerEvents = 'auto';
      if (!this.overlayLayer.contains(node)) this.overlayLayer.appendChild(node);
    }
    this.layoutOverlayWidget(widget);
  }

  layoutOverlayWidget(widget: IOverlayWidget): void {
    const node = widget.getDomNode() as HTMLElement | null;
    if (!node) return;
    const pos = widget.getPosition();
    if (!pos) return;
    node.style.top = '';
    node.style.bottom = '';
    node.style.left = '';
    node.style.right = '';
    node.style.transform = '';

    if (pos.preference === OverlayWidgetPositionPreference.TOP_RIGHT_CORNER) {
      node.style.top = '8px';
      node.style.right = '12px';
    } else if (pos.preference === OverlayWidgetPositionPreference.BOTTOM_RIGHT_CORNER) {
      node.style.bottom = '10px';
      node.style.right = '12px';
    } else if (pos.preference === OverlayWidgetPositionPreference.TOP_CENTER) {
      node.style.top = '8px';
      node.style.left = '50%';
      node.style.transform = 'translateX(-50%)';
    }
  }

  removeOverlayWidget(widget: IOverlayWidget): void {
    const id = widget.getId();
    this.overlayWidgets.delete(id);
    const node = widget.getDomNode() as HTMLElement | null;
    if (node && node.parentElement === this.overlayLayer) node.remove();
  }

  // ── Multi-Zone ViewZones ───────────────────────────────────────────────────

  changeViewZones(callback: (accessor: IViewZoneChangeAccessor) => void): void {
    let changed = false;
    const computeHeight = (z: IViewZone): number => {
      if (z.heightInPx != null) return Math.max(0, Math.round(z.heightInPx));
      const lines = z.heightInLines ?? 1;
      return Math.max(0, Math.round(lines * this.host.getLineHeight()));
    };

    const accessor: IViewZoneChangeAccessor = {
      addZone: (zone: IViewZone): string => {
        const id = `vz_${this.nextZoneId++}`;
        const heightPx = computeHeight(zone);
        const wrapper = document.createElement('div');
        Object.assign(wrapper.style, {
          position: 'absolute',
          left: '0px',
          right: '0px',
          height: `${heightPx}px`,
          pointerEvents: 'auto',
          overflow: 'hidden',
        });
        const dom = zone.domNode as HTMLElement | null;
        if (dom) {
          dom.style.height = '100%';
          wrapper.appendChild(dom);
        }
        this.zoneLayer.appendChild(wrapper);

        let marginWrapper: HTMLDivElement | undefined;
        if (zone.marginDomNode) {
          marginWrapper = document.createElement('div');
          Object.assign(marginWrapper.style, {
            position: 'absolute',
            left: '0px',
            height: `${heightPx}px`,
            pointerEvents: 'auto',
          });
          marginWrapper.appendChild(zone.marginDomNode as HTMLElement);
          this.zoneLayer.appendChild(marginWrapper);
        }

        const spec: ViewZoneSpec = {
          id,
          afterLineNumber: Math.max(0, Math.floor(zone.afterLineNumber)),
          heightPx,
        };
        this.viewZones.set(id, { id, zone, wrapper, marginWrapper, spec });
        zone.onComputedHeight?.(heightPx);
        changed = true;
        return id;
      },
      removeZone: (id: string): void => {
        const entry = this.viewZones.get(id);
        if (!entry) return;
        entry.wrapper.remove();
        entry.marginWrapper?.remove();
        this.viewZones.delete(id);
        changed = true;
      },
      layoutZone: (id: string): void => {
        const entry = this.viewZones.get(id);
        if (!entry) return;
        const heightPx = computeHeight(entry.zone);
        entry.spec.afterLineNumber = Math.max(0, Math.floor(entry.zone.afterLineNumber));
        entry.spec.heightPx = heightPx;
        entry.wrapper.style.height = `${heightPx}px`;
        if (entry.marginWrapper) entry.marginWrapper.style.height = `${heightPx}px`;
        entry.zone.onComputedHeight?.(heightPx);
        changed = true;
      },
    };

    callback(accessor);
    if (changed) {
      this.host.onZonesChanged(this.getViewZoneSpecs());
      this.layoutAll();
    }
  }

  getViewZoneSpecs(): ViewZoneSpec[] {
    return Array.from(this.viewZones.values()).map((z) => ({ ...z.spec }));
  }

  layoutAll(): void {
    const contentLeft = this.host.getContentLeft();
    const cssH = this.host.getCssHeight();
    for (const entry of this.viewZones.values()) {
      const top = this.host.getZoneTopForLine(entry.spec.afterLineNumber, entry.id);
      const visible = top + entry.spec.heightPx >= -40 && top <= cssH + 40;
      entry.wrapper.style.display = visible ? '' : 'none';
      entry.wrapper.style.left = `${contentLeft}px`;
      entry.wrapper.style.top = `${Math.round(top)}px`;
      if (entry.marginWrapper) {
        entry.marginWrapper.style.display = visible ? '' : 'none';
        entry.marginWrapper.style.width = `${contentLeft}px`;
        entry.marginWrapper.style.top = `${Math.round(top)}px`;
      }
      entry.zone.onDomNodeTop?.(top);
    }
    for (const cw of this.contentWidgets.values()) this.layoutContentWidget(cw);
    for (const ow of this.overlayWidgets.values()) this.layoutOverlayWidget(ow);
  }

  dispose(): void {
    const hadZones = this.viewZones.size > 0;
    this.contentWidgets.clear();
    this.overlayWidgets.clear();
    this.viewZones.clear();
    if (hadZones) this.host.onZonesChanged([]);
    this.zoneLayer.remove();
    this.contentLayer.remove();
    this.overlayLayer.remove();
  }
}
