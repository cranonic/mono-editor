import type { SuggestPreviewMode, SuggestSelectionMode } from '../../common/config/editorOptions';
import type { CompletionItem, GhostTextItem } from '../../common/languages/providers/types';
import { labelOfCompletion } from './suggestFilter';
import { computePreviewSuffix, previewTextForGhost } from './suggestWordCollector';

export const SUGGEST_GHOST_OWNER = 'suggest-ghost';

export interface SuggestGhostCallbacks {
  setGhostTexts?: (items: readonly GhostTextItem[]) => void;
  clearGhostTexts?: (owner?: string) => void;
  getGhostTexts?: (owner?: string) => readonly GhostTextItem[];
}

export class SuggestGhostManager {
  private candidates: Array<{ item: CompletionItem; suffix: string }> = [];
  private index = 0;
  private hasPalettePreview = false;
  private callbacks: SuggestGhostCallbacks = {};

  setCallbacks(cb: SuggestGhostCallbacks): void {
    if (cb.setGhostTexts !== undefined) this.callbacks.setGhostTexts = cb.setGhostTexts;
    if (cb.clearGhostTexts !== undefined) this.callbacks.clearGhostTexts = cb.clearGhostTexts;
    if (cb.getGhostTexts !== undefined) this.callbacks.getGhostTexts = cb.getGhostTexts;
  }

  hasCandidates(): boolean {
    return this.candidates.length > 0;
  }

  candidateCount(): number {
    return this.candidates.length;
  }

  hasHigherPriorityGhost(): boolean {
    const active = this.callbacks.getGhostTexts?.() ?? [];
    return active.some((g) => (g.owner ?? 'default') !== SUGGEST_GHOST_OWNER);
  }

  updatePalettePreview(
    open: boolean,
    previewEnabled: boolean,
    item: CompletionItem | null,
    anchorPos: { lineNumber: number; column: number } | null,
    prefix: string,
    previewMode: SuggestPreviewMode,
  ): void {
    if (!open || !previewEnabled || !item || !anchorPos || this.hasHigherPriorityGhost()) {
      if (this.hasPalettePreview) {
        this.hasPalettePreview = false;
        this.callbacks.clearGhostTexts?.(SUGGEST_GHOST_OWNER);
      }
      return;
    }
    const suffix = computePreviewSuffix(previewTextForGhost(item), prefix, previewMode);
    if (!suffix) {
      if (this.hasPalettePreview) {
        this.hasPalettePreview = false;
        this.callbacks.clearGhostTexts?.(SUGGEST_GHOST_OWNER);
      }
      return;
    }
    this.hasPalettePreview = true;
    this.callbacks.setGhostTexts?.([
      {
        id: 'suggest-palette-preview',
        owner: SUGGEST_GHOST_OWNER,
        lineNumber: anchorPos.lineNumber,
        column: anchorPos.column,
        text: suffix,
      },
    ]);
  }

  showCandidates(
    items: readonly CompletionItem[],
    prefix: string,
    pos: { lineNumber: number; column: number },
    previewMode: SuggestPreviewMode,
  ): boolean {
    if (this.hasHigherPriorityGhost()) {
      this.clear();
      return false;
    }
    const candidates: Array<{ item: CompletionItem; suffix: string }> = [];
    for (const item of items) {
      const suffix = computePreviewSuffix(previewTextForGhost(item), prefix, previewMode);
      if (suffix) candidates.push({ item, suffix });
    }
    if (!candidates.length) {
      this.clear();
      return false;
    }
    this.candidates = candidates;
    this.index = 0;
    this.publishActive(pos);
    return true;
  }

  cycle(delta: 1 | -1, anchorPos: { lineNumber: number; column: number } | null): boolean {
    if (this.candidates.length <= 1 || !anchorPos) return false;
    this.index = (this.index + delta + this.candidates.length) % this.candidates.length;
    this.publishActive(anchorPos);
    return true;
  }

  takeActiveCandidate(): CompletionItem | null {
    const cur = this.candidates[this.index];
    if (!cur) return null;
    this.clear();
    return cur.item;
  }

  clear(): void {
    const had = this.candidates.length > 0 || this.hasPalettePreview;
    this.candidates = [];
    this.index = 0;
    this.hasPalettePreview = false;
    if (had) this.callbacks.clearGhostTexts?.(SUGGEST_GHOST_OWNER);
  }

  private publishActive(anchorPos: { lineNumber: number; column: number }): void {
    if (!this.candidates.length || this.hasHigherPriorityGhost()) {
      this.clear();
      return;
    }
    const cur = this.candidates[this.index];
    if (!cur) return;
    this.callbacks.setGhostTexts?.([
      {
        id: 'suggest-ghost-active',
        owner: SUGGEST_GHOST_OWNER,
        lineNumber: anchorPos.lineNumber,
        column: anchorPos.column,
        text: cur.suffix,
      },
    ]);
  }
}

export class SuggestMruTracker {
  private recent: string[] = [];
  private byPrefix = new Map<string, string>();

  record(item: CompletionItem, prefix: string): void {
    const label = labelOfCompletion(item);
    if (!label) return;
    const existing = this.recent.indexOf(label);
    if (existing >= 0) this.recent.splice(existing, 1);
    this.recent.unshift(label);
    if (this.recent.length > 64) this.recent.length = 64;
    if (prefix) {
      this.byPrefix.set(prefix.toLowerCase(), label);
      if (this.byPrefix.size > 128) {
        const firstKey = this.byPrefix.keys().next().value;
        if (firstKey !== undefined) this.byPrefix.delete(firstKey);
      }
    }
  }

  resolveInitialIndex(
    items: readonly CompletionItem[],
    prefix: string,
    mode: SuggestSelectionMode,
  ): number {
    const preIdx = items.findIndex((i) => i.preselect);
    if (preIdx >= 0) return preIdx;

    if (mode === 'recentlyUsedByPrefix' && prefix) {
      const byPref = this.byPrefix.get(prefix.toLowerCase());
      if (byPref) {
        const idx = items.findIndex((it) => labelOfCompletion(it) === byPref);
        if (idx >= 0) return idx;
      }
    }
    if (mode === 'recentlyUsed' || mode === 'recentlyUsedByPrefix') {
      for (const recentLabel of this.recent) {
        const idx = items.findIndex((it) => labelOfCompletion(it) === recentLabel);
        if (idx >= 0) return idx;
      }
    }
    return 0;
  }
}
