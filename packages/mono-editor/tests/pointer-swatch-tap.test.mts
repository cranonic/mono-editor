import assert from 'node:assert/strict';
import { PointerController } from '../src/browser/input/pointer/PointerController';
import { TextModel } from '../src/common/model/TextModel';
import { SelectionState } from '../src/common/core/SelectionState';
import type { ColorHit } from '../src/browser/render/CanvasRenderer';

type Listener = (e: unknown) => void;

function createMockRoot() {
  const listeners = new Map<string, Listener[]>();
  const root = {
    style: {} as Record<string, string>,
    addEventListener(type: string, fn: Listener) {
      const list = listeners.get(type) ?? [];
      list.push(fn);
      listeners.set(type, list);
    },
    removeEventListener(type: string, fn: Listener) {
      const list = listeners.get(type) ?? [];
      listeners.set(type, list.filter((f) => f !== fn));
    },
    getBoundingClientRect() {
      return { left: 0, top: 0, width: 400, height: 600, right: 400, bottom: 600 };
    },
    setPointerCapture() {},
    dispatch(type: string, event: Record<string, unknown>) {
      for (const fn of listeners.get(type) ?? []) fn(event);
    },
  };
  return root;
}

function makePointerEvent(
  overrides: Partial<PointerEvent> & { clientX: number; clientY: number; pointerType: string },
) {
  return {
    pointerId: 1,
    button: 0,
    shiftKey: false,
    ctrlKey: false,
    metaKey: false,
    altKey: false,
    preventDefault() {},
    stopPropagation() {},
    ...overrides,
  };
}

function setupHarness() {
  const root = createMockRoot();
  const model = new TextModel('const c = "#ff0000";\nconst d = "#00ff00";\n'.repeat(20), 'javascript');
  const sel = new SelectionState();
  const swatchHit: ColorHit = {
    x: 100,
    y: 40,
    w: 14,
    h: 14,
    color: { red: 1, green: 0, blue: 0, alpha: 1 },
    range: { startLineNumber: 1, startColumn: 12, endLineNumber: 1, endColumn: 19 },
  };
  const stickySwatchHit: ColorHit = {
    x: 100,
    y: 8,
    w: 14,
    h: 14,
    color: { red: 0, green: 1, blue: 0, alpha: 1 },
    range: { startLineNumber: 1, startColumn: 12, endLineNumber: 1, endColumn: 19 },
  };
  let swatchClicks = 0;
  let foldToggles = 0;
  let scrollEvents = 0;

  const fakeView = {
    scrollTop: 50,
    scrollLeft: 0,
    contentLeft: 40,
    freeHandle: null,
    getWordWrap: () => 'off',
    clampScrollPublic() {},
    schedulePaint() {},
    ensureCaretVisible() {},
    setPointerHeld() {},
    notifyCaretActivity() {},
    positionAtPoint: () => ({ lineNumber: 2, column: 3 }),
    hitTestSticky: (_x: number, y: number) => (y < 24 ? { lineNumber: 1, index: 0 } : null),
    revealStickyLine() {},
    hitTestBottomSticky: () => null,
    revealBottomStickyLine() {},
    getStickyColorHits: () => [stickySwatchHit],
    getColorHits: () => [swatchHit],
    getFoldHits: () => [{ x: 20, y: 40, w: 16, h: 16, lineNumber: 1, collapsed: false }],
    getInlayHits: () => [],
    getLinkHits: () => [],
  };

  const ctrl = new PointerController(
    root as unknown as HTMLElement,
    model,
    sel,
    fakeView as never,
    () => ({ lineHeight: 20, charWidth: 8, fontSize: 14, fontFamily: 'monospace', paddingTop: 0, paddingBottom: 0 }),
    () => [],
    (kind) => { if (kind === 'scroll') scrollEvents++; },
    () => { foldToggles++; },
    () => { swatchClicks++; },
  );

  return {
    root,
    ctrl,
    getCounts: () => ({ swatchClicks, foldToggles, scrollEvents }),
  };
}

// 1. Touch scroll starting ON a color swatch must scroll and NEVER open color picker
{
  const { root, ctrl, getCounts } = setupHarness();
  root.dispatch('pointerdown', makePointerEvent({ pointerType: 'touch', clientX: 105, clientY: 45 }));
  assert.equal(getCounts().swatchClicks, 0, 'touch pointerdown on swatch must not open picker immediately');

  root.dispatch('pointermove', makePointerEvent({ pointerType: 'touch', clientX: 105, clientY: 95 }));
  root.dispatch('pointerup', makePointerEvent({ pointerType: 'touch', clientX: 105, clientY: 95 }));

  assert.equal(getCounts().swatchClicks, 0, 'touch scroll starting on swatch must NEVER open picker');
  assert.ok(getCounts().scrollEvents > 0, 'touch drag scrolled normally');
  ctrl.dispose();
}

// 2. Clean touch tap on a color swatch opens color picker on pointerup
{
  const { root, ctrl, getCounts } = setupHarness();
  root.dispatch('pointerdown', makePointerEvent({ pointerType: 'touch', clientX: 105, clientY: 45 }));
  assert.equal(getCounts().swatchClicks, 0, 'not fired on pointerdown');
  root.dispatch('pointermove', makePointerEvent({ pointerType: 'touch', clientX: 107, clientY: 47 }));
  root.dispatch('pointerup', makePointerEvent({ pointerType: 'touch', clientX: 107, clientY: 47 }));
  assert.equal(getCounts().swatchClicks, 1, 'clean touch tap fires swatch click on pointerup');
  ctrl.dispose();
}

// 3. Touch scroll starting on a sticky color swatch must scroll and NOT open picker; tap opens picker
{
  const { root, ctrl, getCounts } = setupHarness();
  root.dispatch('pointerdown', makePointerEvent({ pointerType: 'touch', clientX: 105, clientY: 12 }));
  root.dispatch('pointermove', makePointerEvent({ pointerType: 'touch', clientX: 105, clientY: 60 }));
  root.dispatch('pointerup', makePointerEvent({ pointerType: 'touch', clientX: 105, clientY: 60 }));
  assert.equal(getCounts().swatchClicks, 0, 'scroll on sticky swatch does not open picker');

  root.dispatch('pointerdown', makePointerEvent({ pointerType: 'touch', clientX: 105, clientY: 12 }));
  root.dispatch('pointerup', makePointerEvent({ pointerType: 'touch', clientX: 105, clientY: 12 }));
  assert.equal(getCounts().swatchClicks, 1, 'tap on sticky swatch opens picker on pointerup');
  ctrl.dispose();
}

// 4. Touch scroll starting on a fold chevron must NOT toggle fold; tap toggles fold
{
  const { root, ctrl, getCounts } = setupHarness();
  root.dispatch('pointerdown', makePointerEvent({ pointerType: 'touch', clientX: 26, clientY: 46 }));
  root.dispatch('pointermove', makePointerEvent({ pointerType: 'touch', clientX: 26, clientY: 96 }));
  root.dispatch('pointerup', makePointerEvent({ pointerType: 'touch', clientX: 26, clientY: 96 }));
  assert.equal(getCounts().foldToggles, 0, 'touch scroll on fold chevron does not toggle fold');

  root.dispatch('pointerdown', makePointerEvent({ pointerType: 'touch', clientX: 26, clientY: 46 }));
  root.dispatch('pointerup', makePointerEvent({ pointerType: 'touch', clientX: 26, clientY: 46 }));
  assert.equal(getCounts().foldToggles, 1, 'touch tap on fold chevron toggles fold on pointerup');
  ctrl.dispose();
}

// 5. Mouse click on color swatch still works immediately
{
  const { root, ctrl, getCounts } = setupHarness();
  root.dispatch('pointerdown', makePointerEvent({ pointerType: 'mouse', clientX: 105, clientY: 45 }));
  assert.equal(getCounts().swatchClicks, 1, 'mouse click activates swatch immediately');
  ctrl.dispose();
}

console.log('pointer-swatch-tap tests passed');
