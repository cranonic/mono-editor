import type { IRange } from '../core/types';
import type { InlineCompletionItem } from '../languages/providers/extendedTypes';
import {
  extractNextGhostLine,
  extractNextGhostWord,
  splitGhostText,
  type GhostTextItem,
  type InlineGhostRun,
  type NormalizedGhostText,
  type VirtualGhostRow,
} from './ghostTextTypes';
import { buildWrappedGhostRows } from './InlineVirtualLayout';

export interface GhostAcceptResult {
  readonly range: IRange;
  readonly text: string;
  readonly item: NormalizedGhostText;
  readonly remainingText: string;
}

const PROVIDER_OWNER = '__inlineCompletions__';

/**
 * Pure DOM-free state model for Universal Multiline Ghost Text.
 *
 * Supports two complementary workflows simultaneously:
 *  1. Standard Monaco/Copilot `InlineCompletionsProvider` suggestions (with cycling `next`/`prev`,
 *     partial word/line accept, and automatic clear on unrelated edits).
 *  2. Direct imperative plugin API `setGhostTexts(items, owner)` / `clearGhostTexts(owner)`
 *     allowing Copilot, Codex, or multi-hunk edit-preview plugins to place multiline ghost text
 *     at ANY line and ANY column simultaneously.
 */
export class GhostTextModel {
  private ownerItems = new Map<string, NormalizedGhostText[]>();
  private providerCandidates: NormalizedGhostText[] = [];
  private providerIndex = 0;
  private version = 0;
  private nextId = 1;

  getVersion(): number {
    return this.version;
  }

  hasAny(): boolean {
    if (this.providerCandidates.length > 0) return true;
    for (const list of this.ownerItems.values()) {
      if (list.length > 0) return true;
    }
    return false;
  }

  getCandidateCount(): number {
    return this.providerCandidates.length;
  }

  getActiveCandidateIndex(): number {
    return this.providerIndex;
  }

  /** Sets imperative ghost text items for `owner` (default `'default'`). */
  setGhostTexts(items: readonly GhostTextItem[], owner = 'default'): void {
    const normalized = items
      .filter((it) => it && typeof it.text === 'string' && it.text.length > 0)
      .map((it) => this.normalize(it, it.owner ?? owner));
    if (normalized.length === 0) {
      if (!this.ownerItems.has(owner)) return;
      this.ownerItems.delete(owner);
    } else {
      this.ownerItems.set(owner, normalized);
    }
    this.version++;
  }

  /** Clears ghost texts for a specific owner, or ALL ghost texts (including provider items) when omitted. */
  clearGhostTexts(owner?: string): void {
    let changed = false;
    if (owner !== undefined) {
      if (owner === PROVIDER_OWNER) {
        if (this.providerCandidates.length > 0) {
          this.providerCandidates = [];
          this.providerIndex = 0;
          changed = true;
        }
      } else if (this.ownerItems.delete(owner)) {
        changed = true;
      }
    } else {
      if (this.ownerItems.size > 0 || this.providerCandidates.length > 0) {
        this.ownerItems.clear();
        this.providerCandidates = [];
        this.providerIndex = 0;
        changed = true;
      }
    }
    if (changed) this.version++;
  }

  /** Sets inline completion candidates returned by `InlineCompletionsProvider`. */
  setProviderCandidates(
    items: readonly InlineCompletionItem[],
    fallbackPos: { lineNumber: number; column: number },
  ): void {
    const normalized: NormalizedGhostText[] = [];
    for (const item of items) {
      if (!item.insertText) continue;
      const pos = item.position ?? (item.range ? {
        lineNumber: item.range.startLineNumber,
        column: item.range.startColumn,
      } : fallbackPos);
      normalized.push(
        this.normalize(
          {
            lineNumber: pos.lineNumber,
            column: pos.column,
            text: item.insertText,
            range: item.range,
            filterText: item.filterText,
            command: item.command,
            kind: 'completion',
            autoClearOnEdit: true,
          },
          PROVIDER_OWNER,
        ),
      );
    }
    this.providerCandidates = normalized;
    this.providerIndex = 0;
    this.version++;
  }

  nextCandidate(): boolean {
    if (this.providerCandidates.length <= 1) return false;
    this.providerIndex = (this.providerIndex + 1) % this.providerCandidates.length;
    this.version++;
    return true;
  }

  prevCandidate(): boolean {
    if (this.providerCandidates.length <= 1) return false;
    const len = this.providerCandidates.length;
    this.providerIndex = (this.providerIndex - 1 + len) % len;
    this.version++;
    return true;
  }

  /** Returns all currently visible ghost texts (active provider candidate + all imperative owner items). */
  getAllActive(): NormalizedGhostText[] {
    const out: NormalizedGhostText[] = [];
    const activeProv = this.providerCandidates[this.providerIndex];
    if (activeProv) out.push(activeProv);
    for (const list of this.ownerItems.values()) {
      for (const item of list) out.push(item);
    }
    out.sort((a, b) => a.lineNumber - b.lineNumber || a.column - b.column || a.priority - b.priority);
    return out;
  }

  /** Returns the primary ghost text item to accept (prefers active provider item, then item at caret, then first). */
  getPrimaryAcceptTarget(caret?: { lineNumber: number; column: number }): NormalizedGhostText | null {
    const activeProv = this.providerCandidates[this.providerIndex];
    if (activeProv) return activeProv;
    const all = this.getAllActive();
    if (!all.length) return null;
    if (caret) {
      const atCaret = all.find(
        (it) => it.lineNumber === caret.lineNumber && it.column === caret.column,
      );
      if (atCaret) return atCaret;
      const sameLine = all.find((it) => it.lineNumber === caret.lineNumber);
      if (sameLine) return sameLine;
    }
    return all[0]!;
  }

  /** Inline first-line ghost runs anchored on `lineNumber`. */
  getInlineRunsForLine(lineNumber: number): InlineGhostRun[] {
    const out: InlineGhostRun[] = [];
    for (const item of this.getAllActive()) {
      if (item.lineNumber !== lineNumber || !item.firstLine) continue;
      out.push({
        id: item.id,
        column: item.column,
        text: item.firstLine,
        italic: item.italic,
        kind: item.kind,
      });
    }
    return out;
  }

  /** Wrapped virtual continuation rows inserted immediately beneath `lineNumber`. */
  getVirtualRowsForLine(params: {
    lineNumber: number;
    effectiveWrap: boolean;
    wrapWidthPx: number;
    charWidth: number;
    measureText: (text: string) => number;
  }): VirtualGhostRow[] {
    const rows: VirtualGhostRow[] = [];
    for (const item of this.getAllActive()) {
      if (item.lineNumber !== params.lineNumber || !item.extraLines.length) continue;
      rows.push(
        ...buildWrappedGhostRows({
          itemId: item.id,
          extraLines: item.extraLines,
          italic: item.italic,
          kind: item.kind,
          effectiveWrap: params.effectiveWrap,
          wrapWidthPx: params.wrapWidthPx,
          charWidth: params.charWidth,
          measureText: params.measureText,
        }),
      );
    }
    return rows;
  }

  /** Computes the full, word, or line acceptance edit and updates remaining ghost text cleanly. */
  consumeAccept(
    mode: 'full' | 'word' | 'line',
    caret?: { lineNumber: number; column: number },
  ): GhostAcceptResult | null {
    const target = this.getPrimaryAcceptTarget(caret);
    if (!target) return null;

    let accepted = target.text;
    let remaining = '';
    if (mode === 'word') {
      const res = extractNextGhostWord(target.text);
      accepted = res.accepted;
      remaining = res.remaining;
    } else if (mode === 'line') {
      const res = extractNextGhostLine(target.text);
      accepted = res.accepted;
      remaining = res.remaining;
    }

    const range: IRange =
      mode === 'full' && target.range
        ? target.range
        : {
            startLineNumber: target.lineNumber,
            startColumn: target.column,
            endLineNumber: target.lineNumber,
            endColumn: target.column,
          };

    if (!remaining) {
      this.removeItem(target);
    } else {
      const nextPos = advancePositionByText(range.startLineNumber, range.startColumn, accepted);
      const updated = this.normalize(
        {
          ...target,
          lineNumber: nextPos.lineNumber,
          column: nextPos.column,
          text: remaining,
          range: undefined,
        },
        target.owner,
      );
      this.replaceItem(target, updated);
    }

    return { range, text: accepted, item: target, remainingText: remaining };
  }

  /**
   * Handles a document edit: clears `autoClearOnEdit` items and shifts persistent
   * (`autoClearOnEdit: false`) preview anchors below the edit by `lineDelta`.
   */
  onDocumentEdit(startLine: number, lineDelta: number): void {
    let changed = false;
    if (this.providerCandidates.length > 0) {
      this.providerCandidates = [];
      this.providerIndex = 0;
      changed = true;
    }
    for (const [owner, list] of this.ownerItems.entries()) {
      const kept: NormalizedGhostText[] = [];
      for (const item of list) {
        if (item.autoClearOnEdit) {
          changed = true;
          continue;
        }
        if (lineDelta !== 0 && item.lineNumber > startLine) {
          kept.push({ ...item, lineNumber: Math.max(1, item.lineNumber + lineDelta) });
          changed = true;
        } else {
          kept.push(item);
        }
      }
      if (kept.length === 0) this.ownerItems.delete(owner);
      else this.ownerItems.set(owner, kept);
    }
    if (changed) this.version++;
  }

  private normalize(item: GhostTextItem, owner: string): NormalizedGhostText {
    const { firstLine, extraLines } = splitGhostText(item.text);
    return {
      ...item,
      id: item.id ?? `ghost_${this.nextId++}`,
      owner,
      lineNumber: Math.max(1, item.lineNumber),
      column: Math.max(1, item.column),
      firstLine,
      extraLines,
      kind: item.kind ?? 'completion',
      priority: item.priority ?? 0,
      autoClearOnEdit: item.autoClearOnEdit !== false,
    };
  }

  private removeItem(target: NormalizedGhostText): void {
    if (target.owner === PROVIDER_OWNER) {
      this.providerCandidates = [];
      this.providerIndex = 0;
    } else {
      const list = this.ownerItems.get(target.owner);
      if (list) {
        const next = list.filter((it) => it.id !== target.id);
        if (next.length) this.ownerItems.set(target.owner, next);
        else this.ownerItems.delete(target.owner);
      }
    }
    this.version++;
  }

  private replaceItem(oldItem: NormalizedGhostText, nextItem: NormalizedGhostText): void {
    if (oldItem.owner === PROVIDER_OWNER) {
      this.providerCandidates = [nextItem];
      this.providerIndex = 0;
    } else {
      const list = this.ownerItems.get(oldItem.owner);
      if (list) {
        this.ownerItems.set(
          oldItem.owner,
          list.map((it) => (it.id === oldItem.id ? nextItem : it)),
        );
      }
    }
    this.version++;
  }
}

function advancePositionByText(
  lineNumber: number,
  column: number,
  text: string,
): { lineNumber: number; column: number } {
  const parts = text.replace(/\r\n/g, '\n').split('\n');
  if (parts.length === 1) {
    return { lineNumber, column: column + parts[0]!.length };
  }
  return {
    lineNumber: lineNumber + parts.length - 1,
    column: parts[parts.length - 1]!.length + 1,
  };
}
