export type ScrollbarVisibility = 'auto' | 'visible' | 'hidden';

export interface OverlayScrollbarOptions {
  vertical?: ScrollbarVisibility;
  horizontal?: ScrollbarVisibility;
  /**
   * Completely hide the vertical scrollbar (`opacity: 0`, non-blocking) after scrolling stops
   * when `vertical === 'auto'`. Set to `false` to keep a dimmed idle thumb. Default `true`.
   */
  hideVerticalOnScrollEnd?: boolean;
  /**
   * Completely hide the horizontal scrollbar (`opacity: 0`, non-blocking) after scrolling stops
   * when `horizontal === 'auto'`. Set to `false` to keep a dimmed idle thumb. Default `true`.
   */
  hideHorizontalOnScrollEnd?: boolean;
  /** Idle delay in ms before fading/hiding after scrolling stops. Default 900. */
  fadeDelayMs?: number;
}

export interface OverviewTick {
  /** Normalized 0..1 vertical position in the document */
  ratio: number;
  color: string;
}

export interface ScrollbarState {
  scrollTop: number;
  scrollLeft: number;
  scrollHeight: number;
  scrollWidth: number;
  viewportHeight: number;
  viewportWidth: number;
  contentLeft: number;
  /** Optional right inset (e.g. docked right minimap width) so horizontal scrollbar stops cleanly before minimap. */
  rightInset?: number;
  isDark: boolean;
  ticks?: OverviewTick[];
}

/**
 * Lightweight, focus-safe custom overlay scrollbar (vertical + horizontal)
 * with overview ruler ticks for diagnostic markers and find matches.
 */
export class OverlayScrollbar {
  private host: HTMLElement;
  private vTrack: HTMLDivElement;
  private vThumb: HTMLDivElement;
  private tickLayer: HTMLDivElement;
  private hTrack: HTMLDivElement;
  private hThumb: HTMLDivElement;
  private opts: Required<OverlayScrollbarOptions>;
  private onScrollTo: (scrollTop: number | null, scrollLeft: number | null) => void;
  private vFadeTimer: ReturnType<typeof setTimeout> | null = null;
  private hFadeTimer: ReturnType<typeof setTimeout> | null = null;
  private vHover = false;
  private hHover = false;
  private dragging: 'v' | 'h' | null = null;
  private dragStartClient = 0;
  private dragStartScroll = 0;
  private lastState: ScrollbarState | null = null;
  private disposed = false;

  private static readonly TRACK_SIZE = 12;
  private static readonly MIN_THUMB = 28;

  constructor(
    host: HTMLElement,
    onScrollTo: (scrollTop: number | null, scrollLeft: number | null) => void,
    options?: OverlayScrollbarOptions,
  ) {
    this.host = host;
    this.onScrollTo = onScrollTo;
    this.opts = {
      vertical: options?.vertical ?? 'auto',
      horizontal: options?.horizontal ?? 'auto',
      hideVerticalOnScrollEnd: options?.hideVerticalOnScrollEnd !== false,
      hideHorizontalOnScrollEnd: options?.hideHorizontalOnScrollEnd !== false,
      fadeDelayMs: Math.max(0, options?.fadeDelayMs ?? 900),
    };

    // Vertical track (right edge)
    const vTrack = document.createElement('div');
    vTrack.className = 'mono-scrollbar-v';
    Object.assign(vTrack.style, {
      position: 'absolute',
      top: '0px',
      right: '0px',
      bottom: '0px',
      width: `${OverlayScrollbar.TRACK_SIZE}px`,
      zIndex: '28',
      pointerEvents: this.opts.vertical === 'visible' || !this.opts.hideVerticalOnScrollEnd ? 'auto' : 'none',
      touchAction: 'none',
      userSelect: 'none',
      transition: 'opacity 180ms ease',
      opacity: this.idleOpacity('v'),
    });

    const tickLayer = document.createElement('div');
    Object.assign(tickLayer.style, {
      position: 'absolute',
      inset: '0',
      pointerEvents: 'none',
    });
    vTrack.appendChild(tickLayer);

    const vThumb = document.createElement('div');
    Object.assign(vThumb.style, {
      position: 'absolute',
      left: '2px',
      right: '2px',
      top: '0px',
      height: '32px',
      borderRadius: '4px',
      background: 'rgba(121, 121, 121, 0.45)',
      pointerEvents: 'inherit',
      cursor: 'default',
    });
    vTrack.appendChild(vThumb);

    // Horizontal track (bottom edge)
    const hTrack = document.createElement('div');
    hTrack.className = 'mono-scrollbar-h';
    Object.assign(hTrack.style, {
      position: 'absolute',
      left: '0px',
      right: `${OverlayScrollbar.TRACK_SIZE}px`,
      bottom: '0px',
      height: `${OverlayScrollbar.TRACK_SIZE - 2}px`,
      zIndex: '28',
      pointerEvents: this.opts.horizontal === 'visible' || !this.opts.hideHorizontalOnScrollEnd ? 'auto' : 'none',
      touchAction: 'none',
      userSelect: 'none',
      transition: 'opacity 180ms ease',
      opacity: this.idleOpacity('h'),
    });

    const hThumb = document.createElement('div');
    Object.assign(hThumb.style, {
      position: 'absolute',
      top: '2px',
      bottom: '2px',
      left: '0px',
      width: '32px',
      borderRadius: '4px',
      background: 'rgba(121, 121, 121, 0.45)',
      pointerEvents: 'inherit',
      cursor: 'default',
    });
    hTrack.appendChild(hThumb);

    this.vTrack = vTrack;
    this.vThumb = vThumb;
    this.tickLayer = tickLayer;
    this.hTrack = hTrack;
    this.hThumb = hThumb;

    // Never steal focus from the editor textarea
    const stopFocus = (e: Event) => {
      e.preventDefault();
      e.stopPropagation();
    };
    vTrack.addEventListener('mousedown', stopFocus);
    hTrack.addEventListener('mousedown', stopFocus);

    vTrack.addEventListener('pointerenter', () => {
      this.vHover = true;
      this.revealAxis('v', true);
    });
    hTrack.addEventListener('pointerenter', () => {
      this.hHover = true;
      this.revealAxis('h', true);
    });
    vTrack.addEventListener('pointerleave', () => {
      this.vHover = false;
      this.scheduleFadeAxis('v');
    });
    hTrack.addEventListener('pointerleave', () => {
      this.hHover = false;
      this.scheduleFadeAxis('h');
    });

    vTrack.addEventListener('pointerdown', this.onVDown);
    hTrack.addEventListener('pointerdown', this.onHDown);
    window.addEventListener('pointermove', this.onMove);
    window.addEventListener('pointerup', this.onUp);
    window.addEventListener('pointercancel', this.onUp);

    host.appendChild(vTrack);
    host.appendChild(hTrack);
  }

  getOptions(): Required<OverlayScrollbarOptions> {
    return { ...this.opts };
  }

  setOptions(options: OverlayScrollbarOptions): void {
    this.opts = {
      vertical: options.vertical ?? this.opts.vertical,
      horizontal: options.horizontal ?? this.opts.horizontal,
      hideVerticalOnScrollEnd:
        options.hideVerticalOnScrollEnd ?? this.opts.hideVerticalOnScrollEnd,
      hideHorizontalOnScrollEnd:
        options.hideHorizontalOnScrollEnd ?? this.opts.hideHorizontalOnScrollEnd,
      fadeDelayMs:
        options.fadeDelayMs !== undefined
          ? Math.max(0, options.fadeDelayMs)
          : this.opts.fadeDelayMs,
    };
    // Immediately apply updated idle visibility when not actively dragging
    if (this.dragging !== 'v' && !this.vHover) this.applyIdleAxis('v');
    if (this.dragging !== 'h' && !this.hHover) this.applyIdleAxis('h');
    if (this.lastState) this.update(this.lastState, false);
  }

  update(
    state: ScrollbarState,
    activeScroll = false,
    activeAxes?: { vertical?: boolean; horizontal?: boolean },
  ): void {
    if (this.disposed) return;
    this.lastState = state;
    const thumbColor = state.isDark
      ? 'rgba(148, 163, 184, 0.38)'
      : 'rgba(71, 85, 105, 0.34)';
    this.vThumb.style.background = thumbColor;
    this.hThumb.style.background = thumbColor;

    // Vertical geometry
    const maxV = Math.max(0, state.scrollHeight - state.viewportHeight);
    const showV = this.opts.vertical !== 'hidden' && maxV > 1 && state.viewportHeight > 0;
    this.vTrack.style.display = showV ? 'block' : 'none';
    if (showV) {
      const trackH = Math.max(1, state.viewportHeight);
      const thumbH = Math.max(
        OverlayScrollbar.MIN_THUMB,
        Math.min(trackH, Math.round((state.viewportHeight / state.scrollHeight) * trackH)),
      );
      const ratio = maxV > 0 ? Math.max(0, Math.min(1, state.scrollTop / maxV)) : 0;
      const top = Math.round(ratio * (trackH - thumbH));
      this.vThumb.style.height = `${thumbH}px`;
      this.vThumb.style.transform = `translate3d(0, ${top}px, 0)`;

      // Render overview ruler ticks (diagnostics & find matches)
      this.renderTicks(state.ticks ?? [], trackH);
    }

    // Horizontal geometry
    const rightInset = Math.max(0, state.rightInset ?? 0);
    const maxH = Math.max(0, state.scrollWidth - state.viewportWidth);
    const showH = this.opts.horizontal !== 'hidden' && maxH > 1 && state.viewportWidth > 0;
    this.hTrack.style.display = showH ? 'block' : 'none';
    if (showH) {
      this.hTrack.style.left = `${Math.max(0, state.contentLeft)}px`;
      this.hTrack.style.right = `${OverlayScrollbar.TRACK_SIZE + rightInset}px`;
      const trackW = Math.max(
        1,
        state.viewportWidth - state.contentLeft - OverlayScrollbar.TRACK_SIZE - rightInset,
      );
      const thumbW = Math.max(
        OverlayScrollbar.MIN_THUMB,
        Math.min(trackW, Math.round((state.viewportWidth / state.scrollWidth) * trackW)),
      );
      const ratio = maxH > 0 ? Math.max(0, Math.min(1, state.scrollLeft / maxH)) : 0;
      const left = Math.round(ratio * (trackW - thumbW));
      this.hThumb.style.width = `${thumbW}px`;
      this.hThumb.style.transform = `translate3d(${left}px, 0, 0)`;
    }

    if (this.opts.vertical === 'visible') {
      this.vTrack.style.opacity = '1';
      this.vTrack.style.pointerEvents = 'auto';
    }
    if (this.opts.horizontal === 'visible') {
      this.hTrack.style.opacity = '1';
      this.hTrack.style.pointerEvents = 'auto';
    }

    if (activeScroll) {
      // Strictly reveal only the axis (or axes) that actually scrolled
      const wakeV = activeAxes ? Boolean(activeAxes.vertical) : true;
      const wakeH = activeAxes ? Boolean(activeAxes.horizontal) : true;
      if (wakeV && showV) this.revealAxis('v', false);
      if (wakeH && showH) this.revealAxis('h', false);
    }
  }

  /** Force immediate fade-to-idle (useful on scroll end or testing). */
  hideIdleNow(): void {
    if (this.vFadeTimer) clearTimeout(this.vFadeTimer);
    if (this.hFadeTimer) clearTimeout(this.hFadeTimer);
    this.vFadeTimer = null;
    this.hFadeTimer = null;
    if (this.dragging !== 'v' && !this.vHover) this.applyIdleAxis('v');
    if (this.dragging !== 'h' && !this.hHover) this.applyIdleAxis('h');
  }

  private renderTicks(ticks: OverviewTick[], trackH: number): void {
    const layer = this.tickLayer;
    layer.textContent = '';
    if (!ticks.length) return;
    // Cap rendered ticks to avoid DOM bloat on huge search results
    const step = ticks.length > 80 ? Math.ceil(ticks.length / 80) : 1;
    for (let i = 0; i < ticks.length; i += step) {
      const t = ticks[i]!;
      const el = document.createElement('div');
      const y = Math.max(1, Math.min(trackH - 4, Math.round(t.ratio * trackH)));
      Object.assign(el.style, {
        position: 'absolute',
        left: '2px',
        right: '2px',
        top: `${y}px`,
        height: '3px',
        borderRadius: '1px',
        background: t.color,
        opacity: '0.85',
      });
      layer.appendChild(el);
    }
  }

  private idleOpacity(axis: 'v' | 'h'): string {
    const mode = axis === 'v' ? this.opts.vertical : this.opts.horizontal;
    const hideOnEnd =
      axis === 'v' ? this.opts.hideVerticalOnScrollEnd : this.opts.hideHorizontalOnScrollEnd;
    if (mode === 'visible') return '1';
    if (mode === 'hidden') return '0';
    return hideOnEnd ? '0' : '0.35';
  }

  private applyIdleAxis(axis: 'v' | 'h'): void {
    const track = axis === 'v' ? this.vTrack : this.hTrack;
    const mode = axis === 'v' ? this.opts.vertical : this.opts.horizontal;
    const hideOnEnd =
      axis === 'v' ? this.opts.hideVerticalOnScrollEnd : this.opts.hideHorizontalOnScrollEnd;
    if (mode === 'visible') {
      track.style.opacity = '1';
      track.style.pointerEvents = 'auto';
    } else if (mode === 'hidden' || hideOnEnd) {
      track.style.opacity = '0';
      track.style.pointerEvents = 'none';
    } else {
      track.style.opacity = '0.35';
      track.style.pointerEvents = 'auto';
    }
  }

  private revealAxis(axis: 'v' | 'h', keepOpen: boolean): void {
    const mode = axis === 'v' ? this.opts.vertical : this.opts.horizontal;
    const track = axis === 'v' ? this.vTrack : this.hTrack;
    if (mode === 'hidden') return;
    track.style.opacity = '1';
    track.style.pointerEvents = 'auto';
    if (axis === 'v' && this.vFadeTimer) {
      clearTimeout(this.vFadeTimer);
      this.vFadeTimer = null;
    }
    if (axis === 'h' && this.hFadeTimer) {
      clearTimeout(this.hFadeTimer);
      this.hFadeTimer = null;
    }
    if (!keepOpen && this.dragging !== axis) {
      this.scheduleFadeAxis(axis);
    }
  }

  private scheduleFadeAxis(axis: 'v' | 'h'): void {
    if (this.dragging === axis) return;
    if (axis === 'v') {
      if (this.vFadeTimer) clearTimeout(this.vFadeTimer);
      this.vFadeTimer = setTimeout(() => {
        this.vFadeTimer = null;
        if (this.disposed || this.dragging === 'v' || this.vHover) return;
        this.applyIdleAxis('v');
      }, this.opts.fadeDelayMs);
    } else {
      if (this.hFadeTimer) clearTimeout(this.hFadeTimer);
      this.hFadeTimer = setTimeout(() => {
        this.hFadeTimer = null;
        if (this.disposed || this.dragging === 'h' || this.hHover) return;
        this.applyIdleAxis('h');
      }, this.opts.fadeDelayMs);
    }
  }

  private onVDown = (e: PointerEvent): void => {
    if (!this.lastState) return;
    e.preventDefault();
    e.stopPropagation();
    const s = this.lastState;
    const maxV = Math.max(0, s.scrollHeight - s.viewportHeight);
    if (maxV <= 0) return;

    this.revealAxis('v', true);
    if (e.target === this.vThumb) {
      this.dragging = 'v';
      this.dragStartClient = e.clientY;
      this.dragStartScroll = s.scrollTop;
      return;
    }
    // Track click jump
    const rect = this.vTrack.getBoundingClientRect();
    const ratio = Math.max(0, Math.min(1, (e.clientY - rect.top) / Math.max(1, rect.height)));
    this.onScrollTo(ratio * maxV, null);
    this.dragging = 'v';
    this.dragStartClient = e.clientY;
    this.dragStartScroll = ratio * maxV;
  };

  private onHDown = (e: PointerEvent): void => {
    if (!this.lastState) return;
    e.preventDefault();
    e.stopPropagation();
    const s = this.lastState;
    const maxH = Math.max(0, s.scrollWidth - s.viewportWidth);
    if (maxH <= 0) return;

    this.revealAxis('h', true);
    if (e.target === this.hThumb) {
      this.dragging = 'h';
      this.dragStartClient = e.clientX;
      this.dragStartScroll = s.scrollLeft;
      return;
    }
    const rect = this.hTrack.getBoundingClientRect();
    const ratio = Math.max(0, Math.min(1, (e.clientX - rect.left) / Math.max(1, rect.width)));
    this.onScrollTo(null, ratio * maxH);
    this.dragging = 'h';
    this.dragStartClient = e.clientX;
    this.dragStartScroll = ratio * maxH;
  };

  private onMove = (e: PointerEvent): void => {
    if (!this.dragging || !this.lastState) return;
    const s = this.lastState;
    if (this.dragging === 'v') {
      const maxV = Math.max(0, s.scrollHeight - s.viewportHeight);
      const trackH = Math.max(1, s.viewportHeight);
      const thumbH = Math.max(
        OverlayScrollbar.MIN_THUMB,
        Math.min(trackH, Math.round((s.viewportHeight / s.scrollHeight) * trackH)),
      );
      const travel = Math.max(1, trackH - thumbH);
      const delta = ((e.clientY - this.dragStartClient) / travel) * maxV;
      this.onScrollTo(Math.max(0, Math.min(maxV, this.dragStartScroll + delta)), null);
    } else {
      const maxH = Math.max(0, s.scrollWidth - s.viewportWidth);
      const trackW = Math.max(1, s.viewportWidth - s.contentLeft - OverlayScrollbar.TRACK_SIZE);
      const thumbW = Math.max(
        OverlayScrollbar.MIN_THUMB,
        Math.min(trackW, Math.round((s.viewportWidth / s.scrollWidth) * trackW)),
      );
      const travel = Math.max(1, trackW - thumbW);
      const delta = ((e.clientX - this.dragStartClient) / travel) * maxH;
      this.onScrollTo(null, Math.max(0, Math.min(maxH, this.dragStartScroll + delta)));
    }
  };

  private onUp = (): void => {
    if (!this.dragging) return;
    const prev = this.dragging;
    this.dragging = null;
    this.scheduleFadeAxis(prev);
  };

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    if (this.vFadeTimer) clearTimeout(this.vFadeTimer);
    if (this.hFadeTimer) clearTimeout(this.hFadeTimer);
    window.removeEventListener('pointermove', this.onMove);
    window.removeEventListener('pointerup', this.onUp);
    window.removeEventListener('pointercancel', this.onUp);
    this.vTrack.remove();
    this.hTrack.remove();
  }
}
