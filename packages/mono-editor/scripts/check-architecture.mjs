#!/usr/bin/env node
/**
 * Phase 5 Architecture & Layering Guard (PLAN.md §2.2, §2.3, §5.7)
 *
 * Enforces:
 * 1. Strict layering:
 *    - common   → common only (and ZERO DOM/browser globals)
 *    - platform → common, platform
 *    - browser  → common, platform, browser
 *    - contrib  → common, platform, browser, same contrib/<feature> (no cross-contrib imports)
 *    - preview  → common, platform, preview (optional entry; NEVER imported by editor core)
 *    - api      → any layer except preview (nothing imports api/ except src/index.ts and src/react/)
 * 2. Zero KaTeX/Mermaid imports anywhere outside src/preview/ (keeps core bundle lean)
 * 3. Zero circular imports across src/**
 * 3. Size budgets:
 *    - logic files ≤ 600 lines (pure data files ≤ 900 lines)
 *    - browser/editor/MonoEditor.ts ≤ 400 lines
 *    - CanvasRenderer.paint() ≤ 80 lines
 * 4. Zero raw innerHTML in src/
 */
import fs from 'node:fs';
import path from 'node:path';

const ROOT = path.resolve(import.meta.dirname, '..');
const SRC = path.join(ROOT, 'src');

const DATA_FILE_PATTERNS = [
  /namedColors\.ts$/,
  /defaultKeybindings\.ts$/,
  /configurations\/[^/]+\.ts$/,
  /builtins\/[^/]+\.ts$/,
  /keyCode\.ts$/,
];

const DOM_FORBIDDEN_RE =
  /\b(document|window|HTMLElement|HTMLDivElement|HTMLCanvasElement|HTMLTextAreaElement|HTMLInputElement|HTMLButtonElement|HTMLSpanElement|CanvasRenderingContext2D|MouseEvent|PointerEvent|KeyboardEvent|TouchEvent|ResizeObserver|getComputedStyle)\b/;

function walkTs(dir) {
  const out = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      out.push(...walkTs(full));
    } else if (/\.(ts|tsx)$/.test(entry.name) && !entry.name.endsWith('.d.ts')) {
      out.push(full);
    }
  }
  return out.sort();
}

function relSrc(abs) {
  return path.relative(SRC, abs).replace(/\\/g, '/');
}

function layerOf(rel) {
  if (rel === 'index.ts' || rel === 'index.exports-snippet.ts') return 'root';
  const top = rel.split('/')[0];
  return top;
}

function contribSliceOf(rel) {
  const parts = rel.split('/');
  return parts[0] === 'contrib' && parts.length > 2 ? parts[1] : null;
}

function extractImports(code) {
  const specs = [];
  const re = /(?:import|export)\s+(?:type\s+)?(?:[\s\S]*?\s+from\s+)?['"]([^'"]+)['"]|import\(\s*['"]([^'"]+)['"]\s*\)/g;
  let m;
  while ((m = re.exec(code)) !== null) {
    const spec = m[1] || m[2];
    if (spec) specs.push(spec);
  }
  return specs;
}

function resolveImport(fromAbs, spec) {
  if (!spec.startsWith('.') && !spec.startsWith('@')) return null;
  let base;
  if (spec.startsWith('@common/')) base = path.join(SRC, 'common', spec.slice(8));
  else if (spec.startsWith('@platform/')) base = path.join(SRC, 'platform', spec.slice(10));
  else if (spec.startsWith('@browser/')) base = path.join(SRC, 'browser', spec.slice(9));
  else if (spec.startsWith('@contrib/')) base = path.join(SRC, 'contrib', spec.slice(9));
  else if (spec.startsWith('@api/')) base = path.join(SRC, 'api', spec.slice(5));
  else base = path.resolve(path.dirname(fromAbs), spec);

  const candidates = [
    base,
    `${base}.ts`,
    `${base}.tsx`,
    path.join(base, 'index.ts'),
    path.join(base, 'index.tsx'),
  ];
  for (const c of candidates) {
    if (fs.existsSync(c) && fs.statSync(c).isFile()) return c;
  }
  return null;
}

function stripCommentsAndStrings(code) {
  return code
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/\/\/.*$/gm, '')
    .replace(/'(?:\\.|[^'\\])*'/g, "''")
    .replace(/"(?:\\.|[^"\\])*"/g, '""');
}

const files = walkTs(SRC);
const errors = [];
const graph = new Map();

for (const abs of files) {
  const rel = relSrc(abs);
  const code = fs.readFileSync(abs, 'utf8');
  const lines = code.split('\n').length;
  const layer = layerOf(rel);
  const isData = DATA_FILE_PATTERNS.some((re) => re.test(rel));

  // 1. Size budgets
  if (rel === 'browser/editor/MonoEditor.ts' && lines > 400) {
    errors.push(`[SIZE] ${rel}: ${lines} lines > 400 (composition root budget)`);
  } else {
    const limit = isData ? 900 : 600;
    if (lines > limit) {
      errors.push(`[SIZE] ${rel}: ${lines} lines > ${limit}`);
    }
  }

  // CanvasRenderer.paint() budget
  if (rel === 'browser/render/CanvasRenderer.ts') {
    const paintMatch = /paint\([^)]*\)\s*:\s*void\s*\{([\s\S]*?)\n  \}/.exec(code);
    if (paintMatch) {
      const paintLines = paintMatch[0].split('\n').length;
      if (paintLines > 80) {
        errors.push(`[SIZE] ${rel} paint(): ${paintLines} lines > 80`);
      }
    }
  }

  // 2. No raw innerHTML
  if (/\.\s*innerHTML\s*=/.test(stripCommentsAndStrings(code))) {
    errors.push(`[CSP] ${rel}: raw innerHTML assignment forbidden`);
  }

  // 3. common/ must be DOM-free
  if (layer === 'common') {
    const stripped = stripCommentsAndStrings(code);
    const dm = DOM_FORBIDDEN_RE.exec(stripped);
    if (dm) {
      errors.push(`[DOM-FREE] ${rel}: common/ references browser/DOM symbol "${dm[1]}"`);
    }
  }

  // 3b. View-zone row-Y geometry guard: raw `paddingTop + <row> * lineHeight` belongs in viewLayout.ts
  if (
    layer === 'browser' &&
    rel !== 'browser/view/viewLayout.ts' &&
    rel !== 'browser/view/viewParts/MinimapController.ts' &&
    rel !== 'browser/view/viewParts/OverlayScrollbar.ts' &&
    rel !== 'browser/render/frameContext.ts'
  ) {
    const stripped = stripCommentsAndStrings(code);
    const rawRowY = /\bpaddingTop\s*\+\s*[^;\n]*\*\s*(?:[A-Za-z_]\w*\.)?lineHeight\b/;
    if (rawRowY.test(stripped)) {
      errors.push(`[GEOMETRY] ${rel}: raw "paddingTop + ... * lineHeight" bypasses RowGeometry (use viewLayout.ts createRowGeometry)`);
    }
  }

  // 4. Layering edges, core bundle guard, & graph building
  const deps = [];
  for (const spec of extractImports(code)) {
    // 4a. Core bundle guard: KaTeX and Mermaid MUST live strictly inside src/preview/
    if (layer !== 'preview' && /^(?:katex|mermaid)(?:\/|$)/.test(spec)) {
      errors.push(`[BUNDLE] ${rel}: editor core must NEVER import "${spec}" (keep inside src/preview/)`);
    }

    const targetAbs = resolveImport(abs, spec);
    if (!targetAbs) continue;
    const targetRel = relSrc(targetAbs);
    if (!targetRel.endsWith('.ts') && !targetRel.endsWith('.tsx')) continue;
    deps.push(targetRel);

    const targetLayer = layerOf(targetRel);
    const allowed = (() => {
      if (layer === 'preview') {
        return targetLayer === 'common' || targetLayer === 'platform' || targetLayer === 'preview';
      }
      if (targetLayer === 'preview') {
        // Editor core, api, and react entries must never statically depend on optional preview entry.
        return false;
      }
      if (layer === 'root' || layer === 'api' || layer === 'react') return true;
      if (layer === 'common') return targetLayer === 'common';
      if (layer === 'platform') return targetLayer === 'common' || targetLayer === 'platform';
      if (layer === 'browser') {
        return targetLayer === 'common' || targetLayer === 'platform' || targetLayer === 'browser';
      }
      if (layer === 'contrib') {
        if (rel === 'contrib/index.ts') {
          return (
            targetLayer === 'common' ||
            targetLayer === 'platform' ||
            targetLayer === 'browser' ||
            targetLayer === 'contrib'
          );
        }
        if (targetLayer === 'common' || targetLayer === 'platform' || targetLayer === 'browser') {
          return true;
        }
        if (targetLayer === 'contrib') {
          const fromSlice = contribSliceOf(rel);
          const toSlice = contribSliceOf(targetRel);
          return fromSlice !== null && fromSlice === toSlice;
        }
        return false;
      }
      return true;
    })();

    if (!allowed) {
      errors.push(`[LAYER] ${rel} (${layer}) must not import ${targetRel} (${targetLayer})`);
    }
  }
  graph.set(rel, deps);
}

// 5. Cycle detection (DFS)
const state = new Map(); // 0=unvisited, 1=visiting, 2=done
const stack = [];
const cycles = [];

function dfs(node) {
  state.set(node, 1);
  stack.push(node);
  for (const next of graph.get(node) || []) {
    const st = state.get(next) || 0;
    if (st === 1) {
      const idx = stack.indexOf(next);
      cycles.push([...stack.slice(idx), next].join(' -> '));
    } else if (st === 0 && graph.has(next)) {
      dfs(next);
    }
  }
  stack.pop();
  state.set(node, 2);
}

for (const node of graph.keys()) {
  if (!state.get(node)) dfs(node);
}
for (const c of cycles) {
  errors.push(`[CYCLE] ${c}`);
}

const maxLines = files
  .map((f) => ({ rel: relSrc(f), lines: fs.readFileSync(f, 'utf8').split('\n').length }))
  .sort((a, b) => b.lines - a.lines);

if (errors.length > 0) {
  console.error(`Architecture check FAILED with ${errors.length} issue(s):\n`);
  for (const e of errors) console.error('  ' + e);
  process.exit(1);
}

console.log(
  `PASS: Architecture guard green (${files.length} files, 0 cycles, 0 layering violations, largest file: ${maxLines[0].rel} @ ${maxLines[0].lines} lines).`,
);
