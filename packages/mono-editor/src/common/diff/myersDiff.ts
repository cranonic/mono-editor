/**
 * Pure DOM-free Myers / LCS line-diff engine powering MonoDiffEditor.
 * Produces both unified inline rows (mobile default) and aligned side-by-side rows (desktop).
 */

export type DiffRowKind = 'equal' | 'insert' | 'delete' | 'modify';

export interface DiffChangeHunk {
  readonly originalStartLineNumber: number;
  readonly originalEndLineNumber: number;
  readonly modifiedStartLineNumber: number;
  readonly modifiedEndLineNumber: number;
}

export interface InlineDiffRow {
  readonly kind: 'equal' | 'insert' | 'delete';
  readonly originalLineNumber: number | null;
  readonly modifiedLineNumber: number | null;
  readonly text: string;
}

export interface SideBySideDiffRow {
  readonly kind: DiffRowKind;
  readonly originalLineNumber: number | null;
  readonly originalText: string | null;
  readonly modifiedLineNumber: number | null;
  readonly modifiedText: string | null;
}

export interface LineDiffResult {
  readonly hunks: readonly DiffChangeHunk[];
  readonly inlineRows: readonly InlineDiffRow[];
  readonly sideBySideRows: readonly SideBySideDiffRow[];
  readonly addedCount: number;
  readonly removedCount: number;
}

export type DiffHunk = DiffChangeHunk;
export type DiffInlineRow = InlineDiffRow;
export type DiffSideBySideRow = SideBySideDiffRow;

interface RawOp {
  kind: 'equal' | 'delete' | 'insert';
  origIdx?: number;
  modIdx?: number;
}

/**
 * Computes shortest edit script (Myers O((N+M)D)) between two line arrays.
 * Gracefully falls back to prefix/suffix diff for extreme file sizes (> 4000 changed lines).
 */
function myersDiffLines(a: readonly string[], b: readonly string[]): RawOp[] {
  const n = a.length;
  const m = b.length;

  // Trim shared prefix & suffix first for massive real-world speedups
  let prefix = 0;
  while (prefix < n && prefix < m && a[prefix] === b[prefix]) prefix++;
  let suffix = 0;
  while (
    suffix < n - prefix &&
    suffix < m - prefix &&
    a[n - 1 - suffix] === b[m - 1 - suffix]
  ) {
    suffix++;
  }

  const midA = a.slice(prefix, n - suffix);
  const midB = b.slice(prefix, m - suffix);
  const ops: RawOp[] = [];

  for (let i = 0; i < prefix; i++) {
    ops.push({ kind: 'equal', origIdx: i, modIdx: i });
  }

  const N = midA.length;
  const M = midB.length;
  const maxD = Math.min(N + M, 4000);

  if (N === 0) {
    for (let j = 0; j < M; j++) ops.push({ kind: 'insert', modIdx: prefix + j });
  } else if (M === 0) {
    for (let i = 0; i < N; i++) ops.push({ kind: 'delete', origIdx: prefix + i });
  } else {
    const offset = maxD;
    const v = new Int32Array(2 * maxD + 1);
    const trace: Int32Array[] = [];
    let foundD = -1;

    outer: for (let d = 0; d <= maxD; d++) {
      trace.push(v.slice());
      for (let k = -d; k <= d; k += 2) {
        let x: number;
        if (k === -d || (k !== d && v[offset + k - 1]! < v[offset + k + 1]!)) {
          x = v[offset + k + 1]!;
        } else {
          x = v[offset + k - 1]! + 1;
        }
        let y = x - k;
        while (x < N && y < M && midA[x] === midB[y]) {
          x++;
          y++;
        }
        v[offset + k] = x;
        if (x >= N && y >= M) {
          foundD = d;
          break outer;
        }
      }
    }

    if (foundD === -1) {
      // Budget exceeded fallback
      for (let i = 0; i < N; i++) ops.push({ kind: 'delete', origIdx: prefix + i });
      for (let j = 0; j < M; j++) ops.push({ kind: 'insert', modIdx: prefix + j });
    } else {
      // Backtrack Myers trace
      const midOps: RawOp[] = [];
      let x = N;
      let y = M;
      for (let d = foundD; d > 0; d--) {
        const prev = trace[d]!;
        const k = x - y;
        let prevK: number;
        if (k === -d || (k !== d && prev[offset + k - 1]! < prev[offset + k + 1]!)) {
          prevK = k + 1;
        } else {
          prevK = k - 1;
        }
        const prevX = prev[offset + prevK]!;
        const prevY = prevX - prevK;
        while (x > prevX && y > prevY) {
          midOps.push({ kind: 'equal', origIdx: prefix + x - 1, modIdx: prefix + y - 1 });
          x--;
          y--;
        }
        if (x === prevX) {
          midOps.push({ kind: 'insert', modIdx: prefix + y - 1 });
          y--;
        } else {
          midOps.push({ kind: 'delete', origIdx: prefix + x - 1 });
          x--;
        }
      }
      while (x > 0 && y > 0) {
        midOps.push({ kind: 'equal', origIdx: prefix + x - 1, modIdx: prefix + y - 1 });
        x--;
        y--;
      }
      for (let i = midOps.length - 1; i >= 0; i--) ops.push(midOps[i]!);
    }
  }

  for (let s = 0; s < suffix; s++) {
    ops.push({
      kind: 'equal',
      origIdx: n - suffix + s,
      modIdx: m - suffix + s,
    });
  }

  return ops;
}

export function computeLineDiff(originalText: string, modifiedText: string): LineDiffResult {
  const a = originalText.replace(/\r\n/g, '\n').split('\n');
  const b = modifiedText.replace(/\r\n/g, '\n').split('\n');
  const ops = myersDiffLines(a, b);

  const inlineRows: InlineDiffRow[] = [];
  const sideBySideRows: SideBySideDiffRow[] = [];
  const hunks: DiffChangeHunk[] = [];
  let addedCount = 0;
  let removedCount = 0;

  let i = 0;
  while (i < ops.length) {
    const op = ops[i]!;
    if (op.kind === 'equal') {
      const lnA = op.origIdx! + 1;
      const lnB = op.modIdx! + 1;
      const text = a[op.origIdx!]!;
      inlineRows.push({ kind: 'equal', originalLineNumber: lnA, modifiedLineNumber: lnB, text });
      sideBySideRows.push({
        kind: 'equal',
        originalLineNumber: lnA,
        originalText: text,
        modifiedLineNumber: lnB,
        modifiedText: text,
      });
      i++;
      continue;
    }

    // Collect contiguous delete/insert block into one hunk
    const dels: number[] = [];
    const ins: number[] = [];
    while (i < ops.length && ops[i]!.kind !== 'equal') {
      if (ops[i]!.kind === 'delete') dels.push(ops[i]!.origIdx!);
      else ins.push(ops[i]!.modIdx!);
      i++;
    }

    removedCount += dels.length;
    addedCount += ins.length;

    for (const d of dels) {
      inlineRows.push({
        kind: 'delete',
        originalLineNumber: d + 1,
        modifiedLineNumber: null,
        text: a[d]!,
      });
    }
    for (const k of ins) {
      inlineRows.push({
        kind: 'insert',
        originalLineNumber: null,
        modifiedLineNumber: k + 1,
        text: b[k]!,
      });
    }

    const pairLen = Math.max(dels.length, ins.length);
    for (let p = 0; p < pairLen; p++) {
      const d = dels[p];
      const k = ins[p];
      const kind: DiffRowKind =
        d !== undefined && k !== undefined ? 'modify' : d !== undefined ? 'delete' : 'insert';
      sideBySideRows.push({
        kind,
        originalLineNumber: d !== undefined ? d + 1 : null,
        originalText: d !== undefined ? a[d]! : null,
        modifiedLineNumber: k !== undefined ? k + 1 : null,
        modifiedText: k !== undefined ? b[k]! : null,
      });
    }

    hunks.push({
      originalStartLineNumber: dels.length ? dels[0]! + 1 : 0,
      originalEndLineNumber: dels.length ? dels[dels.length - 1]! + 1 : 0,
      modifiedStartLineNumber: ins.length ? ins[0]! + 1 : 0,
      modifiedEndLineNumber: ins.length ? ins[ins.length - 1]! + 1 : 0,
    });
  }

  return { hunks, inlineRows, sideBySideRows, addedCount, removedCount };
}
