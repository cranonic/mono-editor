/**
 * Pure DOM-free Myers / LCS line + character diff engine powering MonoDiffEditor.
 * Produces legacy LineDiffResult (inlineRows + sideBySideRows + hunks) as well as
 * Monaco-compatible IDiffComputationResult (ILineChange[] with ICharChange[], moves, quitEarly).
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

export interface ICharChange {
  readonly originalStartLineNumber: number;
  readonly originalStartColumn: number;
  readonly originalEndLineNumber: number;
  readonly originalEndColumn: number;
  readonly modifiedStartLineNumber: number;
  readonly modifiedStartColumn: number;
  readonly modifiedEndLineNumber: number;
  readonly modifiedEndColumn: number;
}

export interface ILineChange {
  readonly originalStartLineNumber: number;
  /** 0 for pure insertion (Monaco convention). */
  readonly originalEndLineNumber: number;
  readonly modifiedStartLineNumber: number;
  /** 0 for pure deletion (Monaco convention). */
  readonly modifiedEndLineNumber: number;
  readonly charChanges?: readonly ICharChange[];
}

export interface IMovedText {
  readonly originalStartLineNumber: number;
  readonly originalEndLineNumber: number;
  readonly modifiedStartLineNumber: number;
  readonly modifiedEndLineNumber: number;
}

export interface IDiffComputationOptions {
  /** Ignore leading & trailing whitespace differences per line. Default `true`. */
  ignoreTrimWhitespace?: boolean;
  /** Time budget in ms before setting `quitEarly = true`. Default `5000` (0 = unlimited). */
  maxComputationTime?: number;
  /** Alias for `maxComputationTime`. */
  maxComputationTimeMs?: number;
  /** Diff algorithm selector. Default `'advanced'`. */
  diffAlgorithm?: 'legacy' | 'advanced';
  /** Detect moved code blocks (>= 2 lines). Default `false`. */
  computeMoves?: boolean;
  /** Compute character-level highlights inside modified blocks. Default `true`. */
  computeCharChanges?: boolean;
}

export interface IDiffComputationResult {
  readonly identical: boolean;
  readonly quitEarly: boolean;
  readonly changes: readonly ILineChange[];
  readonly moves: readonly IMovedText[];
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

function nowMs(): number {
  return typeof performance !== 'undefined' && typeof performance.now === 'function'
    ? performance.now()
    : Date.now();
}

/**
 * Computes shortest edit script (Myers O((N+M)D)) between two string arrays.
 * Supports a wall-clock deadline (`deadlineMs`) and gracefully reports `quitEarly`.
 */
function myersDiffSeq(
  a: readonly string[],
  b: readonly string[],
  maxSteps = 4000,
  deadlineMs = Infinity,
): { ops: RawOp[]; quitEarly: boolean } {
  const n = a.length;
  const m = b.length;

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
  const maxD = Math.min(N + M, maxSteps);
  let quitEarly = false;

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
      if ((d & 31) === 0 && deadlineMs < Infinity && nowMs() > deadlineMs) {
        quitEarly = true;
        break outer;
      }
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
      quitEarly = true;
      for (let i = 0; i < N; i++) ops.push({ kind: 'delete', origIdx: prefix + i });
      for (let j = 0; j < M; j++) ops.push({ kind: 'insert', modIdx: prefix + j });
    } else {
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

  return { ops, quitEarly };
}

/**
 * Splits a line into compact tokens (identifiers, numbers, whitespace runs, punctuation)
 * so character-level diffs stay crisp and fast even on long lines.
 */
function tokenizeForCharDiff(line: string): { text: string; startCol: number; endCol: number }[] {
  const tokens: { text: string; startCol: number; endCol: number }[] = [];
  const re = /[A-Za-z0-9_$]+|\s+|[^\w\s]/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(line)) !== null) {
    tokens.push({
      text: m[0],
      startCol: m.index + 1,
      endCol: m.index + m[0].length + 1,
    });
  }
  return tokens;
}

function computeLineCharChanges(
  origLine: string,
  origLineNumber: number,
  modLine: string,
  modLineNumber: number,
): ICharChange[] {
  if (origLine === modLine) return [];
  // Fast path for very long lines: common prefix/suffix highlight
  if (origLine.length > 1500 || modLine.length > 1500) {
    let p = 0;
    const minLen = Math.min(origLine.length, modLine.length);
    while (p < minLen && origLine.charCodeAt(p) === modLine.charCodeAt(p)) p++;
    let s = 0;
    while (
      s < origLine.length - p &&
      s < modLine.length - p &&
      origLine.charCodeAt(origLine.length - 1 - s) === modLine.charCodeAt(modLine.length - 1 - s)
    ) {
      s++;
    }
    return [
      {
        originalStartLineNumber: origLineNumber,
        originalStartColumn: p + 1,
        originalEndLineNumber: origLineNumber,
        originalEndColumn: origLine.length - s + 1,
        modifiedStartLineNumber: modLineNumber,
        modifiedStartColumn: p + 1,
        modifiedEndLineNumber: modLineNumber,
        modifiedEndColumn: modLine.length - s + 1,
      },
    ];
  }

  const origToks = tokenizeForCharDiff(origLine);
  const modToks = tokenizeForCharDiff(modLine);
  const { ops } = myersDiffSeq(
    origToks.map((t) => t.text),
    modToks.map((t) => t.text),
    256,
  );

  const out: ICharChange[] = [];
  let i = 0;
  let lastOrigEndCol = 1;
  let lastModEndCol = 1;

  while (i < ops.length) {
    const op = ops[i]!;
    if (op.kind === 'equal') {
      lastOrigEndCol = origToks[op.origIdx!]!.endCol;
      lastModEndCol = modToks[op.modIdx!]!.endCol;
      i++;
      continue;
    }
    let oStart = 0;
    let oEnd = 0;
    let mStart = 0;
    let mEnd = 0;
    while (i < ops.length && ops[i]!.kind !== 'equal') {
      const cur = ops[i]!;
      if (cur.kind === 'delete') {
        const tok = origToks[cur.origIdx!]!;
        if (oStart === 0) oStart = tok.startCol;
        oEnd = tok.endCol;
        lastOrigEndCol = tok.endCol;
      } else {
        const tok = modToks[cur.modIdx!]!;
        if (mStart === 0) mStart = tok.startCol;
        mEnd = tok.endCol;
        lastModEndCol = tok.endCol;
      }
      i++;
    }
    // Refine single-token replacements down to exact changed characters inside the token
    if (oStart > 0 && mStart > 0) {
      const oSub = origLine.slice(oStart - 1, oEnd - 1);
      const mSub = modLine.slice(mStart - 1, mEnd - 1);
      let cp = 0;
      const ml = Math.min(oSub.length, mSub.length);
      while (cp < ml && oSub[cp] === mSub[cp]) cp++;
      let cs = 0;
      while (cs < oSub.length - cp && cs < mSub.length - cp && oSub[oSub.length - 1 - cs] === mSub[mSub.length - 1 - cs]) {
        cs++;
      }
      oStart += cp;
      oEnd -= cs;
      mStart += cp;
      mEnd -= cs;
    }
    out.push({
      originalStartLineNumber: origLineNumber,
      originalStartColumn: oStart > 0 ? oStart : lastOrigEndCol,
      originalEndLineNumber: origLineNumber,
      originalEndColumn: oEnd > 0 ? oEnd : lastOrigEndCol,
      modifiedStartLineNumber: modLineNumber,
      modifiedStartColumn: mStart > 0 ? mStart : lastModEndCol,
      modifiedEndLineNumber: modLineNumber,
      modifiedEndColumn: mEnd > 0 ? mEnd : lastModEndCol,
    });
  }
  return out;
}

/**
 * Computes Monaco-compatible line & character diffs with timeout guard,
 * optional trimmed-whitespace comparison, and optional moved-block detection.
 */
export function computeDiff(
  originalText: string,
  modifiedText: string,
  options: IDiffComputationOptions = {},
): IDiffComputationResult {
  const ignoreTrimWhitespace = options.ignoreTrimWhitespace ?? true;
  const maxTime = options.maxComputationTime ?? options.maxComputationTimeMs ?? 5000;
  const computeCharChanges = options.computeCharChanges ?? true;
  const computeMoves = options.computeMoves ?? false;

  const rawA = originalText.replace(/\r\n/g, '\n').split('\n');
  const rawB = modifiedText.replace(/\r\n/g, '\n').split('\n');
  const cmpA = ignoreTrimWhitespace ? rawA.map((l) => l.trim()) : rawA;
  const cmpB = ignoreTrimWhitespace ? rawB.map((l) => l.trim()) : rawB;

  const deadlineMs = maxTime > 0 ? nowMs() + maxTime : Infinity;
  const { ops, quitEarly } = myersDiffSeq(cmpA, cmpB, 4000, deadlineMs);

  const changes: ILineChange[] = [];
  let addedCount = 0;
  let removedCount = 0;
  let lastOrigLine = 0;
  let lastModLine = 0;
  let i = 0;

  while (i < ops.length) {
    const op = ops[i]!;
    if (op.kind === 'equal') {
      lastOrigLine = op.origIdx! + 1;
      lastModLine = op.modIdx! + 1;
      i++;
      continue;
    }

    const dels: number[] = [];
    const ins: number[] = [];
    while (i < ops.length && ops[i]!.kind !== 'equal') {
      if (ops[i]!.kind === 'delete') dels.push(ops[i]!.origIdx!);
      else ins.push(ops[i]!.modIdx!);
      i++;
    }

    removedCount += dels.length;
    addedCount += ins.length;

    const origStart = dels.length > 0 ? dels[0]! + 1 : lastOrigLine;
    const origEnd = dels.length > 0 ? dels[dels.length - 1]! + 1 : 0;
    const modStart = ins.length > 0 ? ins[0]! + 1 : lastModLine;
    const modEnd = ins.length > 0 ? ins[ins.length - 1]! + 1 : 0;

    let charChanges: ICharChange[] | undefined;
    if (computeCharChanges && dels.length > 0 && ins.length > 0) {
      const pairCount = Math.min(dels.length, ins.length, 64);
      const cc: ICharChange[] = [];
      for (let p = 0; p < pairCount; p++) {
        const oi = dels[p]!;
        const mi = ins[p]!;
        cc.push(...computeLineCharChanges(rawA[oi]!, oi + 1, rawB[mi]!, mi + 1));
      }
      if (cc.length > 0) charChanges = cc;
    }

    changes.push({
      originalStartLineNumber: origStart,
      originalEndLineNumber: origEnd,
      modifiedStartLineNumber: modStart,
      modifiedEndLineNumber: modEnd,
      ...(charChanges ? { charChanges } : {}),
    });

    if (dels.length > 0) lastOrigLine = dels[dels.length - 1]! + 1;
    if (ins.length > 0) lastModLine = ins[ins.length - 1]! + 1;
  }

  const moves: IMovedText[] = [];
  if (computeMoves && changes.length > 1) {
    const pureDeletes = changes.filter((c) => c.originalEndLineNumber > 0 && c.modifiedEndLineNumber === 0);
    const pureInserts = changes.filter((c) => c.modifiedEndLineNumber > 0 && c.originalEndLineNumber === 0);
    const usedIns = new Set<ILineChange>();
    for (const del of pureDeletes) {
      const delCount = del.originalEndLineNumber - del.originalStartLineNumber + 1;
      if (delCount < 2) continue;
      const delKey = cmpA.slice(del.originalStartLineNumber - 1, del.originalEndLineNumber).join('\n');
      if (!delKey.trim()) continue;
      for (const ins of pureInserts) {
        if (usedIns.has(ins)) continue;
        const insCount = ins.modifiedEndLineNumber - ins.modifiedStartLineNumber + 1;
        if (insCount !== delCount) continue;
        const insKey = cmpB.slice(ins.modifiedStartLineNumber - 1, ins.modifiedEndLineNumber).join('\n');
        if (insKey === delKey) {
          usedIns.add(ins);
          moves.push({
            originalStartLineNumber: del.originalStartLineNumber,
            originalEndLineNumber: del.originalEndLineNumber,
            modifiedStartLineNumber: ins.modifiedStartLineNumber,
            modifiedEndLineNumber: ins.modifiedEndLineNumber,
          });
          break;
        }
      }
    }
  }

  return {
    identical: changes.length === 0,
    quitEarly,
    changes,
    moves,
    addedCount,
    removedCount,
  };
}

export function computeLineDiff(originalText: string, modifiedText: string): LineDiffResult {
  const a = originalText.replace(/\r\n/g, '\n').split('\n');
  const b = modifiedText.replace(/\r\n/g, '\n').split('\n');
  const { ops } = myersDiffSeq(a, b);

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
