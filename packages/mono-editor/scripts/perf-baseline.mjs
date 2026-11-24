#!/usr/bin/env node
/**
 * Phase 5.0 Performance Baseline (Node, DOM-free core benchmarks)
 * Measures TextModel open/edit, tokenization, folding, and ViewLineProjection.
 */
import { performance } from 'node:perf_hooks';
import { TextModel } from '../src/common/model/TextModel';
import { TokenizationSupport } from '../src/common/languages/tokenization/TokenizationSupport';
import { registerDefaultLanguages } from '../src/common/languages/defaults/registerDefaults';
import { FoldingModel } from '../src/common/viewModel/FoldingModel';
import { ViewLineProjection } from '../src/common/viewModel/ViewLineProjection';

registerDefaultLanguages();

function makeLines(count) {
  const lines = [];
  for (let i = 0; i < count; i++) {
    if (i % 20 === 0) lines.push(`export function computeBatch_${i}(items: number[]): number {`);
    else if (i % 20 === 19) lines.push('}');
    else lines.push(`  const value_${i} = items[${i % 10}] * 3.14 + ${i}; // color #0ea5e9`);
  }
  return lines.join('\n');
}

const src10k = makeLines(10_000);
const src100k = makeLines(100_000);

const t0 = performance.now();
const m10k = new TextModel(src10k, 'typescript');
const open10k = performance.now() - t0;

const t1 = performance.now();
const m100k = new TextModel(src100k, 'typescript');
const open100k = performance.now() - t1;

const t2 = performance.now();
for (let i = 0; i < 200; i++) {
  const off = m10k.getOffsetAt((i % 500) + 1, 10);
  m10k.insert(off, 'x');
}
const edits200 = performance.now() - t2;

const tok = new TokenizationSupport();
const t3 = performance.now();
for (let ln = 1; ln <= 1000; ln++) tok.getLineTokens(m10k, ln);
const tok1k = performance.now() - t3;

const t4 = performance.now();
const fold = new FoldingModel(m10k);
fold.updateSync();
const fold10k = performance.now() - t4;

const t5 = performance.now();
const proj = new ViewLineProjection(m10k, fold);
proj.getVisualLineCount();
const proj10k = performance.now() - t5;

console.log(
  JSON.stringify(
    {
      open10kMs: Number(open10k.toFixed(2)),
      open100kMs: Number(open100k.toFixed(2)),
      edits200Ms: Number(edits200.toFixed(2)),
      tokenize1kLinesMs: Number(tok1k.toFixed(2)),
      fold10kLinesMs: Number(fold10k.toFixed(2)),
      projection10kLinesMs: Number(proj10k.toFixed(2)),
    },
    null,
    2,
  ),
);
