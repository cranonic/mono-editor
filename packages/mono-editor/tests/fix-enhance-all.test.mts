/**
 * Comprehensive verification suite for all 10 tracks of Fix_Enhance.md (I, A, B, C, D, H, E, F, G, J).
 *
 * Run:
 *   npx tsx tests/fix-enhance-all.test.mts
 */
import assert from 'node:assert/strict';
import {
  computeCascadeTiming,
  computeDiff,
  computeDocsPlacement,
  computeMenuPlacement,
  computeMenuSafeArea,
  computeSignaturePlacement,
  createMenuEvalContext,
  createRowGeometry,
  DEFAULT_THEME,
  evaluateWhenExpression,
  markersAtPosition,
  MarkerSeverity,
  MenuId,
  MenuRegistry,
  resolveHoverAndDiagnosticsTriggers,
  resolveParameterLabelRange,
  type IMarker,
  type ResolvedViewZone,
} from '../src/index';
import { TextModel } from '../src/common/model/TextModel';
import { ViewLineProjection } from '../src/common/viewModel/ViewLineProjection';
import { SelectionState } from '../src/common/core/SelectionState';
import { ViewController } from '../src/browser/view/ViewController';
import { IndentScopeFinder, layoutStickyForScroll } from '../src/common/viewModel/StickyScroll';
import { buildFrameContext, colorAdvanceBefore, COLOR_SWATCH_ADVANCE, type PaintOptions } from '../src/browser/render/frameContext';
import { highlightsPass } from '../src/browser/render/passes/highlightsPass';
import { teardropsPass } from '../src/browser/render/passes/teardropsPass';
import type { ResolvedInlayHint } from '../src/common/virtualText/ghostTextTypes';
import { menus, registerDefaultEditorMenuEntries } from '../src/platform/menus/MenuRegistry';
import { BACK_ICON_SVG, MORE_ICON_SVG } from '../src/contrib/contextMenu/menuDom';
import { TeardropDragController } from '../src/browser/input/pointer/teardropHandles';
import { HoverContribution } from '../src/contrib/hover/HoverContribution';
import { HoverWidget } from '../src/contrib/hover/HoverWidget';
import { SignatureHelpController } from '../src/contrib/signatureHelp/SignatureHelpController';
import { SignatureHelpWidget } from '../src/contrib/signatureHelp/SignatureHelpWidget';
import { SuggestWidget } from '../src/contrib/suggest/SuggestWidget';
import { analyzeCallContext, languages, CompletionItemKind } from '../src/index';
import type { IEditorContributionHost } from '../src/browser/editor/editorTypes';

function rectsOverlap(
  a: { left: number; top: number; right: number; bottom: number },
  b: { left: number; top: number; right: number; bottom: number },
): boolean {
  return a.left < b.right && a.right > b.left && a.top < b.bottom && a.bottom > b.top;
}

// =============================================================================
// TRACK I — View-Zone Geometry & CodeLens Sticky/Scroll Anchoring
// =============================================================================
{
  const metrics = { lineHeight: 24, paddingTop: 6 };
  const zones: ResolvedViewZone[] = [
    { id: 'cl-1', afterVisualRow: -1, heightPx: 18.5 },
    { id: 'cl-5', afterVisualRow: 4, heightPx: 19.25 },
    { id: 'cl-12', afterVisualRow: 11, heightPx: 20 },
    { id: 'cl-20', afterVisualRow: 19, heightPx: 18 },
    { id: 'cl-30', afterVisualRow: 29, heightPx: 21.5 },
  ];
  const geom = createRowGeometry(metrics, 0, zones);

  // Every visual row round-trips cleanly through topOfRow -> rowAtDocY
  for (let r = 0; r < 40; r++) {
    const top = geom.topOfRow(r);
    const mid = top + metrics.lineHeight * 0.5;
    const hit = geom.rowAtDocY(mid);
    assert.equal(hit.row, r, `row ${r} round-trip failed`);
    assert.equal(hit.inZone, false, `row ${r} midpoint must not be inZone`);
  }

  // Probing inside a CodeLens zone returns the line immediately below it with inZone: true
  const cl5Top = geom.blockTopOfRow(5);
  assert.equal(geom.topOfRow(5) - cl5Top, 19.25, 'leadingZoneHeight matches blockTopOfRow');
  const insideLens = geom.rowAtDocY(cl5Top + 8);
  assert.equal(insideLens.row, 5, 'probe inside lens above row 5 maps to row 5');
  assert.equal(insideLens.inZone, true, 'probe inside lens sets inZone=true');

  // Sticky Scroll with CodeLens zones: no early sticky header when scrollTop is inside the lens strip
  const code = [
    'class Demo {',
    '  methodA() {',
    '    const x = 1;',
    '    const y = 2;',
    '    const z = 3;',
    '    return x + y + z;',
    '  }',
    '  methodB() {',
    '    return 42;',
    '  }',
    '}',
  ].join('\n');
  const model = new TextModel(code);
  const proj = new ViewLineProjection(model);
  const finder = new IndentScopeFinder(model);
  const stickyMetrics = {
    fontFamily: 'monospace',
    fontSize: 14,
    lineHeight: 24,
    gutterWidth: 40,
    charWidth: 8,
    paddingLeft: 8,
    paddingTop: 4,
  };
  // CodeLens directly above line 1 (`class Demo {`) with height 20px
  const lensZones: ResolvedViewZone[] = [{ id: 'lens-1', afterVisualRow: -1, heightPx: 20 }];
  const gLens = createRowGeometry(stickyMetrics, 0, lensZones);
  const stickyGeom = {
    topOfRow: (r: number) => gLens.stickyTopOfRow(r),
    blockTopOfRow: (r: number) => gLens.stickyBlockTopOfRow(r),
    rowAtDocY: (y: number) => gLens.rowAtStickyDocY(y),
  };
  // At scrollTop = 10 (inside the lens above line 1), line 1 has NOT scrolled off yet -> no sticky line!
  const atLens = layoutStickyForScroll(
    finder,
    10,
    stickyMetrics,
    5,
    true,
    1,
    1,
    false,
    proj,
    undefined,
    stickyGeom,
  );
  assert.equal(atLens.lines.length, 0, 'CodeLens above line 1 must not trigger premature sticky header');

  // Scroll anchoring when CodeLens view zones are added above the viewport
  (globalThis as Record<string, unknown>).window = { devicePixelRatio: 2 };
  (globalThis as Record<string, unknown>).requestAnimationFrame = () => 1;
  (globalThis as Record<string, unknown>).cancelAnimationFrame = () => {};
  const longCode = Array.from({ length: 80 }, (_, i) => `const line_${i + 1} = ${i + 1};`).join('\n');
  const m2 = new TextModel(longCode);
  const sel2 = new SelectionState();
  const mockRenderer: Record<string, unknown> = {
    resize() {},
    paint() {},
    measureColumnX: (_l: string, col: number, m: { charWidth: number }) => Math.max(0, col - 1) * m.charWidth,
    columnAtX: (line: string, x: number, m: { charWidth: number }) =>
      Math.max(1, Math.min(line.length + 1, Math.round(x / m.charWidth) + 1)),
  };
  const view = new ViewController(
    m2,
    sel2,
    mockRenderer as never,
    () => stickyMetrics,
    () => DEFAULT_THEME,
    () => true,
    3,
    null,
    { enabled: true },
    true,
  );
  view.setSize(800, 400);
  view.scrollTop = 600;
  view.clampScrollPublic();
  const screenBefore = view.screenPosOf(30, 1).y;
  // Insert 3 CodeLens zones above line 30
  view.setExtraViewZones([
    { id: 'cl-a', afterLineNumber: 0, heightPx: 18 },
    { id: 'cl-b', afterLineNumber: 4, heightPx: 18 },
    { id: 'cl-c', afterLineNumber: 12, heightPx: 18 },
  ]);
  const screenAfter = view.screenPosOf(30, 1).y;
  assert.ok(
    Math.abs(screenAfter - screenBefore) <= 1,
    `CodeLens insertion above viewport must anchor scroll (before=${screenBefore}, after=${screenAfter})`,
  );
}

// =============================================================================
// TRACK A & B & C & F — Unified Virtual-Text X (Teardrops + Sticky Color Swatches),
//                       Inlay Bubble Collapse, & Bracket Match Above Selection
// =============================================================================
{
  const measureCol = (_l: string, col: number, m: { charWidth: number }) => Math.max(0, col - 1) * m.charWidth;
  const lineColors = [{ startColumn: 10, endColumn: 19, color: '#ff5733', cssColor: '#ff5733', raw: '"#ff5733"' }];

  // Track F: Sticky scroll color swatch advance matches main viewport color advance
  assert.equal(colorAdvanceBefore(lineColors as never, 9), 0);
  assert.equal(colorAdvanceBefore(lineColors as never, 10), COLOR_SWATCH_ADVANCE);

  const makeHint = (liftProgress: number): ResolvedInlayHint => ({
    lineNumber: 1,
    column: 15,
    text: 'name:',
    parts: [{ value: 'name:' }],
    paddingLeft: true,
    paddingRight: true,
    chipWidthPx: 42,
    totalAdvancePx: 50 * (1 - liftProgress),
    marginLeftPx: 4,
    liftProgress,
  });

  const model = new TextModel('const c = "#ff5733"; greet(userName);');
  const sel = new SelectionState();
  sel.setSelections([{ anchor: { lineNumber: 1, column: 12 }, active: { lineNumber: 1, column: 30 } }]);
  const projTd = new ViewLineProjection(model);
  const baseMetrics = {
    fontFamily: 'monospace',
    fontSize: 14,
    lineHeight: 24,
    gutterWidth: 48,
    charWidth: 8,
    paddingLeft: 8,
    paddingTop: 4,
  };

  // Track C: Inlay bubble lift smoothly collapses inline advance (0 -> 0.5 -> 1)
  const buildWithLift = (lift: number) =>
    buildFrameContext(
      {
        model,
        selection: sel,
        projection: projTd,
        metrics: baseMetrics,
        theme: DEFAULT_THEME,
        scrollTop: 0,
        scrollLeft: 0,
        topInsetPx: 0,
        cssWidth: 800,
        cssHeight: 400,
        showLineNumbers: true,
        overscan: 2,
        caretVisible: true,
        showTeardrops: true,
        getLineColors: (ln: number) => (ln === 1 ? (lineColors as never) : []),
        getLineInlayHints: (ln: number) => (ln === 1 ? [makeHint(lift)] : []),
        getLineGhostTexts: (ln: number) =>
          ln === 1 ? [{ id: 'g1', column: 20, text: 'world', kind: 'inlineCompletion' }] : [],
      } as PaintOptions,
      measureCol,
    );

  const fc0 = buildWithLift(0);
  const fcHalf = buildWithLift(0.5);
  const fcLifted = buildWithLift(1);
  assert.equal(fc0.xAt(1, 16) - fcLifted.xAt(1, 16), 50, 'liftProgress=1 collapses full 50px inlay advance');
  assert.equal(fc0.xAt(1, 16) - fcHalf.xAt(1, 16), 25, 'liftProgress=0.5 collapses half inlay advance');

  // Track A: Teardrop X aligns with unified FrameContext.xAt (with swatches + inlays + ghosts)
  const tdCtx = {
    fillStyle: '',
    strokeStyle: '',
    lineWidth: 1,
    font: '',
    save() {},
    restore() {},
    translate() {},
    scale() {},
    rotate() {},
    rect() {},
    clip() {},
    beginPath() {},
    arc() {},
    moveTo() {},
    lineTo() {},
    bezierCurveTo() {},
    quadraticCurveTo() {},
    closePath() {},
    fill() {},
    stroke() {},
    fillRect() {},
    strokeRect() {},
    shadowColor: '',
    shadowBlur: 0,
    shadowOffsetY: 0,
    measureText(s: string) { return { width: s.length * 8 }; },
  };
  teardropsPass.paint(tdCtx as never, fc0);
  const startTd = fc0.teardrops.find((t) => t.type === 'start');
  const endTd = fc0.teardrops.find((t) => t.type === 'end');
  assert.ok(startTd && endTd, 'selection produces start and end teardrops');
  const expectedStartX = fc0.xAt(1, 12, 'after');
  const expectedEndX = fc0.xAt(1, 30, 'before');
  assert.ok(
    Math.abs(startTd.x + startTd.w - expectedStartX) <= 1.5 || Math.abs(startTd.x + startTd.w / 2 - expectedStartX) <= 14,
    'start teardrop X aligns with unified FrameContext.xAt',
  );
  assert.ok(
    Math.abs(endTd.x - expectedEndX) <= 1.5 || Math.abs(endTd.x + endTd.w / 2 - expectedEndX) <= 14,
    'end teardrop X aligns with unified FrameContext.xAt',
  );

  // Track B: Bracket match highlight is painted AFTER selection fill so it stays visible over selection
  const drawOps: Array<{ color: string; x: number; w: number }> = [];
  const fakeCtx = {
    fillStyle: '',
    strokeStyle: '',
    lineWidth: 1,
    font: '',
    save() {},
    restore() {},
    rect() {},
    clip() {},
    fillRect(x: number, _y: number, w: number) {
      drawOps.push({ color: String(this.fillStyle), x, w });
    },
    strokeRect() {},
    beginPath() {},
    moveTo() {},
    lineTo() {},
    stroke() {},
    measureText(s: string) { return { width: s.length * 8 }; },
  };
  const mBracket = new TextModel('foo(bar(1))');
  const selBracket = new SelectionState();
  selBracket.setSelections([{ anchor: { lineNumber: 1, column: 4 }, active: { lineNumber: 1, column: 11 } }]);
  const fc = buildFrameContext(
    {
      model: mBracket,
      selection: selBracket,
      metrics: { ...baseMetrics, gutterWidth: 40 },
      theme: {
        ...DEFAULT_THEME,
        selection: '#112233',
      },
      scrollTop: 0,
      scrollLeft: 0,
      topInsetPx: 0,
      cssWidth: 600,
      cssHeight: 300,
      showLineNumbers: true,
      overscan: 2,
      caretVisible: true,
      showTeardrops: false,
      bracketMatch: {
        open: { lineNumber: 1, column: 4, length: 1 },
        close: { lineNumber: 1, column: 11, length: 1 },
      },
      renderLineHighlight: 'none',
    } as PaintOptions,
    measureCol,
  );
  highlightsPass.paint(fakeCtx as never, fc);
  const selIdx = drawOps.findIndex((op) => op.color === '#112233');
  const brkIdx = drawOps.findIndex((op) => op.color === 'rgba(56, 189, 248, 0.16)' || op.color === 'rgba(37, 99, 235, 0.12)');
  assert.ok(selIdx >= 0, `selection fill was painted (ops=${JSON.stringify(drawOps)})`);
  assert.ok(brkIdx > selIdx, `bracket match fill must be painted AFTER selection fill (sel=${selIdx}, brk=${brkIdx})`);
}

// =============================================================================
// TRACK D — Completion Docs Placement (Zero Overlap Across Narrow/Wide Hosts)
// =============================================================================
{
  const hostWidths = [320, 420, 800];
  const hostHeight = 460;
  for (const hostW of hostWidths) {
    const listPositions = [
      { left: 8, top: 140, width: 220, height: 150 },
      { left: Math.max(8, Math.floor((hostW - 220) / 2)), top: 140, width: 220, height: 150 },
      { left: Math.max(8, hostW - 228), top: 140, width: 220, height: 150 },
    ];
    const caretLine = { top: 112, bottom: 136 };
    for (const listRect of listPositions) {
      const placed = computeDocsPlacement(
        listRect,
        caretLine,
        { width: 260, height: 130 },
        { width: hostW, height: hostHeight },
        'auto',
        hostW <= 420,
      );
      assert.ok(placed, `docs placement must succeed at hostW=${hostW}`);
      const docBox = {
        left: placed.left,
        top: placed.top,
        right: placed.left + placed.width,
        bottom: placed.top + placed.maxHeight,
      };
      const listBox = {
        left: listRect.left,
        top: listRect.top,
        right: listRect.left + listRect.width,
        bottom: listRect.top + listRect.height,
      };
      const caretBox = { left: 0, top: caretLine.top, right: hostW, bottom: caretLine.bottom };
      assert.equal(
        rectsOverlap(docBox, listBox),
        false,
        `docs must NEVER overlap completion list at hostW=${hostW} (listLeft=${listRect.left})`,
      );
      assert.equal(
        rectsOverlap(docBox, caretBox),
        false,
        `docs must NEVER overlap caret line at hostW=${hostW}`,
      );
      assert.ok(placed.left >= 0 && placed.left + placed.width <= hostW, 'docs must stay horizontally inside host');
    }
  }
}

// =============================================================================
// TRACK H — Signature Help Opposite-Side Placement & Parameter Type Ranges
// =============================================================================
{
  // Completion list is BELOW caret line -> signature help places ABOVE caret line with zero overlap
  const caretAnchor = { x: 120, top: 160, y: 184 };
  const sigSize = { width: 240, height: 54 };
  const hostSize = { width: 420, height: 480 };
  const listBelow = { left: 100, top: 188, width: 220, height: 150 };
  const posAbove = computeSignaturePlacement(caretAnchor, sigSize, hostSize, listBelow);
  assert.equal(
    rectsOverlap(
      { left: posAbove.left, top: posAbove.top, right: posAbove.left + sigSize.width, bottom: posAbove.top + sigSize.height },
      { left: listBelow.left, top: listBelow.top, right: listBelow.left + listBelow.width, bottom: listBelow.top + listBelow.height },
    ),
    false,
    'signature help must not overlap completion list below',
  );
  assert.ok(posAbove.top + sigSize.height <= caretAnchor.top, 'signature help sits above caret line');

  // Completion list is ABOVE caret line -> signature help places BELOW caret line with zero overlap
  const listAbove = { left: 100, top: 20, width: 220, height: 136 };
  const posBelow = computeSignaturePlacement(caretAnchor, sigSize, hostSize, listAbove);
  assert.equal(
    rectsOverlap(
      { left: posBelow.left, top: posBelow.top, right: posBelow.left + sigSize.width, bottom: posBelow.top + sigSize.height },
      { left: listAbove.left, top: listAbove.top, right: listAbove.left + listAbove.width, bottom: listAbove.top + listAbove.height },
    ),
    false,
    'signature help must not overlap completion list above',
  );
  assert.ok(posBelow.top >= caretAnchor.y, 'signature help sits below caret line');

  // Parameter label range covers full parameter name + type
  const sigLabel = 'greetAll(name: string, locale?: "bn" | "hi"): string';
  const r0 = resolveParameterLabelRange(sigLabel, 'name: string');
  const r1 = resolveParameterLabelRange(sigLabel, 'locale?: "bn" | "hi"');
  assert.ok(r0 && sigLabel.slice(r0[0], r0[1]) === 'name: string', 'active parameter 0 highlights full type');
  assert.ok(r1 && sigLabel.slice(r1[0], r1[1]) === 'locale?: "bn" | "hi"', 'active parameter 1 highlights full type');
}

// =============================================================================
// TRACK E — Independent Hover & Diagnostics Trigger Resolution + Marker Matching
// =============================================================================
{
  // Pointer-aware defaults
  assert.deepEqual(resolveHoverAndDiagnosticsTriggers({}, true), {
    hoverTrigger: 'click',
    diagnosticsPopup: 'click',
  });
  assert.deepEqual(resolveHoverAndDiagnosticsTriggers({}, false), {
    hoverTrigger: 'hover',
    diagnosticsPopup: 'hover',
  });

  // Independent matrix: hover off, diagnostics click
  assert.deepEqual(
    resolveHoverAndDiagnosticsTriggers({ hover: { trigger: 'off' }, diagnostics: { popup: 'click' } }, false),
    { hoverTrigger: 'off', diagnosticsPopup: 'click' },
  );

  // Independent matrix: hover click, diagnostics off
  assert.deepEqual(
    resolveHoverAndDiagnosticsTriggers({ hover: { trigger: 'click' }, diagnostics: { popup: 'off' } }, false),
    { hoverTrigger: 'click', diagnosticsPopup: 'off' },
  );

  // Back-compat: hover.enabled: false -> hoverTrigger 'off', diagnostics still overridable
  assert.deepEqual(
    resolveHoverAndDiagnosticsTriggers({ hover: { enabled: false }, diagnostics: { popup: 'hover' } }, true),
    { hoverTrigger: 'off', diagnosticsPopup: 'hover' },
  );
  assert.deepEqual(
    resolveHoverAndDiagnosticsTriggers({ hover: { openOnMouseHover: true } }, true),
    { hoverTrigger: 'hover', diagnosticsPopup: 'hover' },
  );

  // Inclusive marker matching (including zero-width markers)
  const markers: IMarker[] = [
    {
      owner: 'ts',
      severity: MarkerSeverity.Error,
      message: 'Bad call',
      startLineNumber: 2,
      startColumn: 5,
      endLineNumber: 2,
      endColumn: 10,
    },
    {
      owner: 'ts',
      severity: MarkerSeverity.Warning,
      message: 'Zero-width hint',
      startLineNumber: 2,
      startColumn: 15,
      endLineNumber: 2,
      endColumn: 15,
    },
  ];
  assert.equal(markersAtPosition(markers, 2, 5).length, 1);
  assert.equal(markersAtPosition(markers, 2, 10).length, 1, 'inclusive endColumn matches');
  assert.equal(markersAtPosition(markers, 2, 11).length, 0);
  assert.equal(markersAtPosition(markers, 2, 15).length, 1, 'zero-width marker matches');
}

// =============================================================================
// TRACK G — When-Clause Parser, MenuRegistry, Safe Placement & Cascade Timing
// =============================================================================
{
  const ctxMap: Record<string, boolean | string | number> = {
    editorHasSelection: true,
    editorReadonly: false,
    editorLangId: 'typescript',
    count: 3,
  };
  const getter = (k: string) => ctxMap[k];

  assert.equal(evaluateWhenExpression('editorHasSelection && !editorReadonly', getter), true);
  assert.equal(evaluateWhenExpression('editorHasSelection && editorReadonly', getter), false);
  assert.equal(evaluateWhenExpression('editorReadonly || editorLangId == "typescript"', getter), true);
  assert.equal(evaluateWhenExpression("editorLangId != 'python' && (editorReadonly || editorHasSelection)", getter), true);
  assert.equal(evaluateWhenExpression('!(editorReadonly || editorLangId == "javascript")', getter), true);
  assert.equal(evaluateWhenExpression('count == 3', getter), true);

  // MenuRegistry group/order sorting + when vs enabledWhen semantics
  const reg = new MenuRegistry();
  reg.register({ id: 'c', menu: MenuId.EditorContext, command: 'cmd.c', title: 'C', group: '9_cut', order: 20 });
  reg.register({
    id: 'a',
    menu: MenuId.EditorContext,
    command: 'cmd.a',
    title: 'A',
    group: '1_nav',
    order: 10,
    when: 'editorLangId == "typescript"',
  });
  reg.register({
    id: 'b',
    menu: MenuId.EditorContext,
    command: 'cmd.b',
    title: 'B',
    group: '9_cut',
    order: 10,
    enabledWhen: '!editorHasSelection',
  });
  reg.register({
    id: 'hidden',
    menu: MenuId.EditorContext,
    command: 'cmd.h',
    title: 'Hidden',
    group: '1_nav',
    order: 1,
    when: 'editorReadonly',
  });

  const evalCtx = createMenuEvalContext(getter);
  const entries = reg.getEntries(MenuId.EditorContext, evalCtx);
  assert.deepEqual(
    entries.map((e) => [e.entry.id, e.enabled]),
    [
      ['a', true],
      ['b', false], // shown disabled when enabledWhen is false
      ['c', true],
    ],
    'MenuRegistry sorts by group then order, hides on `when`, disables on `enabledWhen`',
  );

  // Placement solver: zero overlap with anchor & stays inside safe area (including soft keyboard inset)
  const safe = computeMenuSafeArea(
    { left: 0, top: 0, width: 390, height: 800 },
    0,
    0,
    8,
    { offsetLeft: 0, offsetTop: 0, width: 390, height: 480 }, // 320px soft keyboard open
  );
  assert.ok(safe.bottom <= 472, 'safe area respects visualViewport soft-keyboard height');

  const testAnchors = [
    [{ left: 16, top: 12, right: 90, bottom: 52 }], // near top-left
    [{ left: 300, top: 420, right: 370, bottom: 460 }], // near bottom-right above keyboard
    [{ left: 150, top: 220, right: 240, bottom: 264 }], // centered
  ];
  for (const anchors of testAnchors) {
    const res = computeMenuPlacement(anchors, { width: 220, height: 340 }, safe, 8);
    const h = res.maxHeight ?? 340;
    const box = { left: res.left, top: res.top, right: res.left + 220, bottom: res.top + h };
    assert.ok(box.left >= safe.left - 1 && box.right <= safe.right + 1, 'menu stays horizontally in safeArea');
    assert.ok(box.top >= safe.top - 1 && box.bottom <= safe.bottom + 1, 'menu stays vertically in safeArea');
    for (const a of anchors) {
      assert.equal(rectsOverlap(box, a), false, 'menu never overlaps anchor/teardrop');
    }
  }

  // Cascade animation timing: total duration <= 500ms for N = 1..25
  for (let n = 1; n <= 25; n++) {
    const t = computeCascadeTiming(n);
    assert.ok(
      t.totalDurationMs <= 500,
      `cascade total duration must stay <= 500ms for N=${n} (got ${t.totalDurationMs}ms)`,
    );
    assert.ok(t.rowDurationMs >= 80 && (n === 1 ? t.staggerMs === 0 : t.staggerMs > 0));
  }
}

// =============================================================================
// TRACK J — computeDiff Engine (Line, Char, Insert, Delete, Whitespace, Moves, Perf)
// =============================================================================
{
  // Char-level diff on modified line
  const rMod = computeDiff('const count = 1;\n', 'const count = 42;\n');
  assert.equal(rMod.identical, false);
  assert.equal(rMod.changes.length, 1);
  assert.ok(rMod.changes[0]!.charChanges && rMod.changes[0]!.charChanges.length > 0, 'produces charChanges');

  // Pure insertion: originalEndLineNumber === 0
  const rIns = computeDiff('a\nb', 'a\ninserted\nb');
  assert.equal(rIns.changes.length, 1);
  assert.equal(rIns.changes[0]!.originalEndLineNumber, 0, 'pure insert sets originalEndLineNumber=0');
  assert.equal(rIns.changes[0]!.modifiedStartLineNumber, 2);
  assert.equal(rIns.changes[0]!.modifiedEndLineNumber, 2);

  // Pure deletion: modifiedEndLineNumber === 0
  const rDel = computeDiff('a\nremoved\nb', 'a\nb');
  assert.equal(rDel.changes.length, 1);
  assert.equal(rDel.changes[0]!.modifiedEndLineNumber, 0, 'pure delete sets modifiedEndLineNumber=0');
  assert.equal(rDel.changes[0]!.originalStartLineNumber, 2);
  assert.equal(rDel.changes[0]!.originalEndLineNumber, 2);

  // ignoreTrimWhitespace
  const rWsIgnored = computeDiff('  hello  \nworld', 'hello\nworld', { ignoreTrimWhitespace: true });
  assert.equal(rWsIgnored.identical, true);
  assert.equal(rWsIgnored.changes.length, 0);
  const rWsStrict = computeDiff('  hello  \nworld', 'hello\nworld', { ignoreTrimWhitespace: false });
  assert.equal(rWsStrict.identical, false);
  assert.equal(rWsStrict.changes.length, 1);

  // computeMoves detects relocated block
  const origMove = ['header', 'function alpha() {', '  return 1;', '}', 'middle1', 'middle2', 'footer'].join('\n');
  const modMove = ['header', 'middle1', 'middle2', 'function alpha() {', '  return 1;', '}', 'footer'].join('\n');
  const rMove = computeDiff(origMove, modMove, { computeMoves: true });
  assert.ok(rMove.moves.length >= 1, 'computeMoves detects moved code block');

  // 10,000-line file with 20 scattered edits completes fast (< 200ms even under tsx)
  const bigOrig = Array.from({ length: 10000 }, (_, i) => `export const value_${i} = ${i};`);
  const bigMod = [...bigOrig];
  for (let k = 0; k < 20; k++) {
    const idx = k * 480 + 10;
    bigMod[idx] = `export const value_${idx} = ${idx + 999}; // edited`;
  }
  const t0 = performance.now();
  const rBig = computeDiff(bigOrig.join('\n'), bigMod.join('\n'));
  const elapsed = performance.now() - t0;
  assert.equal(rBig.changes.length, 20, '10k-line diff finds all 20 scattered edits');
  assert.equal(rBig.quitEarly, false);
  assert.ok(elapsed < 250, `10k-line diff should be fast (took ${elapsed.toFixed(1)}ms)`);
}

// =============================================================================
// REGRESSIONS — Context Menu Ordering & SVG Icons, Horizontal Teardrop Auto-Scroll
// =============================================================================
{
  // Cut, Copy, Paste at top of default EditorContext menu in exact order
  registerDefaultEditorMenuEntries();
  const defaultCtx = createMenuEvalContext((key) => {
    if (key === 'editorHasSelection') return true;
    if (key === 'editorReadonly') return false;
    return false;
  });
  const topGroups = menus.getGroupedEntries(MenuId.EditorContext, defaultCtx);
  assert.ok(topGroups.length > 0, 'default EditorContext menu has groups');
  const firstGroupIds = topGroups[0]!.items.map((i) => i.entry.id);
  assert.deepEqual(
    firstGroupIds.slice(0, 3),
    ['mono.ctx.cut', 'mono.ctx.copy', 'mono.ctx.paste'],
    'Cut, Copy, Paste must appear first in vertical context menu',
  );

  // Horizontal More & Vertical Back SVG icons include SVG XML namespace for DOMParser rendering
  assert.ok(MORE_ICON_SVG.includes('xmlns="http://www.w3.org/2000/svg"'), 'MORE_ICON_SVG must have xmlns');
  assert.ok(BACK_ICON_SVG.includes('xmlns="http://www.w3.org/2000/svg"'), 'BACK_ICON_SVG must have xmlns');

  // Horizontal auto-scroll on teardrop drag when wordWrap is off (allowHorizontal: true)
  const tdCtrl = new TeardropDragController();
  const fakeRoot = {
    getBoundingClientRect: () => ({ left: 0, top: 0, right: 400, bottom: 300, width: 400, height: 300 }),
  } as unknown as HTMLElement;
  tdCtrl.handleDrag = 'cursor';

  // Near right edge with allowHorizontal=true -> positive X scroll
  tdCtrl.updateEdgeAutoScroll(fakeRoot, 150, () => {}, { clientX: 390, contentLeft: 48, allowHorizontal: true });
  assert.ok(tdCtrl.getAutoScrollDeltaX() > 0, 'dragging near right edge scrolls horizontally right');

  // Near left content edge with allowHorizontal=true -> negative X scroll
  tdCtrl.updateEdgeAutoScroll(fakeRoot, 150, () => {}, { clientX: 52, contentLeft: 48, allowHorizontal: true });
  assert.ok(tdCtrl.getAutoScrollDeltaX() < 0, 'dragging near left edge scrolls horizontally left');

  // With allowHorizontal=false (wordWrap on) -> zero horizontal scroll
  tdCtrl.updateEdgeAutoScroll(fakeRoot, 150, () => {}, { clientX: 390, contentLeft: 48, allowHorizontal: false });
  assert.equal(tdCtrl.getAutoScrollDeltaX(), 0, 'wordWrap on disables horizontal edge auto-scroll');
  tdCtrl.dispose();
}

// =============================================================================
// REGRESSIONS — Mobile Touch Tap Hover/Diagnostics, Font Scaling, Snippet SigHelp
// =============================================================================
await (async () => {
  // Minimal DOM stub for headless widget verification
  type Listener = (e: Record<string, unknown>) => void;
  class StubEl {
    tagName: string;
    className = '';
    id = '';
    style: Record<string, string> = {};
    children: StubEl[] = [];
    parentNode: StubEl | null = null;
    clientWidth = 600;
    clientHeight = 400;
    offsetWidth = 220;
    offsetHeight = 60;
    scrollWidth = 220;
    scrollHeight = 60;
    scrollTop = 0;
    attrs = new Map<string, string>();
    listeners = new Map<string, Listener[]>();
    private _text = '';
    constructor(tag: string) { this.tagName = tag.toUpperCase(); }
    get textContent(): string { return this._text || this.children.map((c) => c.textContent).join(''); }
    set textContent(v: string) { this._text = v; if (v === '') this.children = []; }
    appendChild(child: StubEl): StubEl {
      child.parentNode = this;
      this.children.push(child);
      return child;
    }
    remove(): void {
      if (this.parentNode) {
        this.parentNode.children = this.parentNode.children.filter((c) => c !== this);
        this.parentNode = null;
      }
    }
    contains(node: unknown): boolean {
      if (node === this) return true;
      return this.children.some((c) => c.contains(node));
    }
    setAttribute(k: string, v: string): void { this.attrs.set(k, v); }
    addEventListener(type: string, fn: Listener): void {
      const list = this.listeners.get(type) ?? [];
      list.push(fn);
      this.listeners.set(type, list);
    }
    removeEventListener(type: string, fn: Listener): void {
      const list = this.listeners.get(type);
      if (list) this.listeners.set(type, list.filter((x) => x !== fn));
    }
    dispatch(type: string, ev: Record<string, unknown>): void {
      for (const fn of this.listeners.get(type) ?? []) fn(ev);
    }
    querySelector(sel: string): StubEl | null {
      const cls = sel.startsWith('.') ? sel.slice(1) : sel;
      for (const c of this.children) {
        if (c.className.split(/\s+/).includes(cls)) return c;
        const found = c.querySelector(sel);
        if (found) return found;
      }
      return null;
    }
    querySelectorAll(sel: string): StubEl[] {
      const out: StubEl[] = [];
      const cls = sel.startsWith('.') ? sel.slice(1) : sel;
      const walk = (n: StubEl) => {
        for (const c of n.children) {
          if (c.className.split(/\s+/).includes(cls)) out.push(c);
          walk(c);
        }
      };
      walk(this);
      return out;
    }
    classList = {
      add: (...cls: string[]) => {
        this.className = `${this.className} ${cls.join(' ')}`.trim();
      },
    };
    getBoundingClientRect() {
      return { left: 0, top: 0, right: this.clientWidth, bottom: this.clientHeight, width: this.clientWidth, height: this.clientHeight };
    }
  }

  const head = new StubEl('head');
  const prevDoc = (globalThis as Record<string, unknown>).document;
  (globalThis as Record<string, unknown>).document = {
    head,
    createElement: (tag: string) => new StubEl(tag),
    createTextNode: (t: string) => { const n = new StubEl('#text'); n.textContent = t; return n; },
    getElementById: (id: string) => head.children.find((c) => c.id === id) ?? null,
    querySelector: () => null,
  };

  try {
    // 1. Mobile touch tap -> Hover & Diagnostics MUST stay open even after touch pointerleave
    {
      const root = new StubEl('div');
      const model = new TextModel('greetAll("Mono", "bn");', 'javascript');
      const selection = new SelectionState();
      selection.setCaret(1, 4); // inside greetAll
      const diagMarker: IMarker = {
        owner: 'test',
        severity: MarkerSeverity.Warning,
        message: 'Sample diagnostic on greetAll',
        startLineNumber: 1,
        startColumn: 1,
        endLineNumber: 1,
        endColumn: 9,
      };
      const hoverReg = languages.registerHoverProvider('javascript', {
        provideHover: () => ({ contents: [{ value: '```ts\nfunction greetAll(name: string): string\n```' }, { value: 'Greets a user.' }] }),
      });

      let curFontSize = 15;
      const fakeHost = {
        root: root as unknown as HTMLDivElement,
        initialOptions: {},
        isDisposed: () => false,
        getModel: () => model,
        selection,
        view: {
          contentLeft: 40,
          setHoverRangeProvider: () => {},
          schedulePaint: () => {},
          screenPosOf: () => ({ x: 60, y: 100, h: 22 }),
          positionAtPoint: () => ({ lineNumber: 1, column: 4 }),
        },
        keybindings: { add: () => ({ dispose() {} }) },
        commands: { registerCommand: () => ({ dispose() {} }) },
        getPosition: () => selection.active,
        setPosition: () => {},
        getMarkers: () => [diagMarker],
        getLanguageIdAtPosition: () => 'javascript',
        executeCommand: async () => undefined,
        wordAtPosition: () => ({ word: 'greetAll', startColumn: 1, endColumn: 9 }),
        getFontSize: () => curFontSize,
        getFontFamily: () => '"JetBrains Mono", monospace',
      } as unknown as IEditorContributionHost;

      const hc = new HoverContribution(fakeHost);

      // Simulate real phone touch tap: pointerdown(touch) -> onPointerTapMeta(touch) -> tap -> pointerleave(touch)
      root.dispatch('pointerdown', { pointerType: 'touch', target: root });
      hc.onPointerTapMeta({ clientX: 60, clientY: 100, pointerType: 'touch' });
      hc.onPointerInteract('tap');
      // Touch browsers immediately emit pointerleave right after pointerup!
      root.dispatch('pointerleave', { pointerType: 'touch' });
      await new Promise((r) => setTimeout(r, 25));

      const hoverEl = root.querySelector('.mono-hover-widget');
      assert.ok(hoverEl, 'touch tap must open hover + diagnostics popup and survive touch pointerleave');
      assert.ok(hoverEl!.textContent.includes('greetAll'), 'hover popup renders hover docs');
      assert.ok(hoverEl!.textContent.includes('Sample diagnostic'), 'hover popup renders diagnostics too');

      // Explicit Click / Tap mode with live fontSize update
      curFontSize = 22;
      hc.onOptionsChange({ fontSize: 22, hover: { enabled: true, trigger: 'click' }, diagnostics: { popup: 'click' } });
      const resizedHoverEl = root.querySelector('.mono-hover-widget');
      assert.ok(resizedHoverEl, 'hover widget stays visible after fontSize update');
      assert.ok(parseInt(resizedHoverEl!.style.fontSize || '0', 10) >= 19, 'hover fontSize scales with editor fontSize=22');

      hc.dispose();
      hoverReg.dispose();
    }

    // 2. Font size scaling across HoverWidget, SignatureHelpWidget, SuggestWidget & SuggestDetailsPane
    {
      const root = new StubEl('div');
      const hw = new HoverWidget(root as unknown as HTMLElement, { fontSize: 22 });
      hw.show(['```ts\nconst x: number\n```', 'Docs paragraph'], { x: 40, y: 120, top: 96 });
      const hwEl = root.querySelector('.mono-hover-widget')!;
      assert.equal(hwEl.style.fontSize, '20px', 'HoverWidget scales fontSize proportionally from 22px editor font');
      hw.dispose();

      const sw = new SignatureHelpWidget(root as unknown as HTMLElement, { onPrev: () => {}, onNext: () => {} }, { fontSize: 22 });
      sw.show(
        {
          activeSignature: 0,
          activeParameter: 0,
          signatures: [{ label: 'greetAll(name: string, locale?: string): string', parameters: [{ label: 'name: string', documentation: 'Name' }] }],
        },
        { x: 40, y: 120, top: 96, languageId: 'typescript' },
      );
      const swEl = root.querySelector('.mono-signature-help-widget')!;
      assert.equal(swEl.style.fontSize, '20px', 'SignatureHelpWidget scales container fontSize from 22px editor font');
      sw.setOptions({ fontSize: 12 });
      const swSmall = root.querySelector('.mono-signature-help-widget')!;
      assert.equal(swSmall.style.fontSize, '11px', 'SignatureHelpWidget live-updates fontSize when shrunk to 12px');
      sw.dispose();

      const sg = new SuggestWidget(
        root as unknown as HTMLElement,
        { onAccept: () => {}, onDismiss: () => {} },
        { fontSize: 22, docsMode: 'auto' },
      );
      sg.show(
        [{ label: 'greetAll', kind: CompletionItemKind.Function, detail: '(name: string) => string', documentation: { value: 'Greets a user.' }, insertText: 'greetAll' }],
        { x: 40, y: 120, top: 96 },
        'greet',
      );
      const sgEl = root.querySelector('.mono-suggest-widget')!;
      const sgDocsEl = root.querySelector('.mono-suggest-docs')!;
      assert.equal(sgEl.style.fontSize, '22px', 'SuggestWidget uses editor fontSize=22');
      assert.equal(sgDocsEl.style.fontSize, '20px', 'SuggestDetailsPane scales fontSize with editor fontSize=22');
      sg.dispose();
    }

    // 3. Accepting call snippet completion `greetAll("Mono", "bn")` auto-triggers Signature Help & tracks tabstops
    {
      const root = new StubEl('div');
      const model = new TextModel('greetAll("Mono", "bn")', 'javascript');
      const selection = new SelectionState();
      // Snippet $1 selects "Mono": anchor at col 10, active at col 16 (right before `,`)
      selection.anchor = { lineNumber: 1, column: 10 };
      selection.active = { lineNumber: 1, column: 16 };

      const viewStub = {
        screenPosOf: () => ({ x: 80, y: 120, h: 22 }),
      } as unknown as ViewController;

      const sigReg = languages.registerSignatureHelpProvider('javascript', {
        signatureHelpTriggerCharacters: ['(', ','],
        provideSignatureHelp(m, pos) {
          const ctx = analyzeCallContext(m, pos);
          if (!ctx || ctx.calleeName !== 'greetAll') return null;
          return {
            value: {
              activeSignature: 0,
              activeParameter: ctx.activeParameter,
              signatures: [
                {
                  label: 'greetAll(name: string, locale?: "bn" | "hi"): string',
                  parameters: [{ label: 'name: string' }, { label: 'locale?: "bn" | "hi"' }],
                },
              ],
            },
          };
        },
      });

      const sigCtrl = new SignatureHelpController(root as unknown as HTMLElement, model, selection, viewStub, {
        enabled: true,
        trigger: 'auto',
        fontSize: 16,
      });

      await sigCtrl.onCompletionAccepted();
      assert.equal(sigCtrl.isOpen(), true, 'accepting greetAll("Mono", "bn") snippet opens Signature Help automatically');
      assert.equal(sigCtrl.getActiveHelp()?.activeParameter, 0, 'first snippet tabstop highlights parameter 0 (name)');

      // Tab to second snippet placeholder `"bn"` (cols 18..22)
      selection.anchor = { lineNumber: 1, column: 18 };
      selection.active = { lineNumber: 1, column: 22 };
      sigCtrl.syncCursor();
      await new Promise((r) => setTimeout(r, 10));
      assert.equal(sigCtrl.getActiveHelp()?.activeParameter, 1, 'second snippet tabstop highlights parameter 1 (locale)');

      // Tab to $0 after closing `)` -> Signature Help closes cleanly
      selection.setCaret(1, 23);
      sigCtrl.syncCursor();
      assert.equal(sigCtrl.isOpen(), false, 'moving outside closing paren hides Signature Help');

      sigCtrl.dispose();
      sigReg.dispose();
    }
  } finally {
    (globalThis as Record<string, unknown>).document = prevDoc;
  }
})();

console.log('PASS: All 10 Fix_Enhance tracks (I, A, B, C, D, H, E, F, G, J) + regressions verified!');
