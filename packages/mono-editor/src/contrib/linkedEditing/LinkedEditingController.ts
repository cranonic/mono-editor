import type { MonoEditorOptions } from '../../common/config/editorOptions';
import type { IRange } from '../../common/core/types';
import { languageFeatures } from '../../common/languages/languageFeaturesService';
import type { InputChangeEvent } from '../../browser/input/InputController';
import {
  ContributionIds,
  type IEditorContribution,
  type IEditorContributionHost,
} from '../../browser/editor/editorTypes';

const TAG_LANGUAGES = new Set(['html', 'xml', 'javascript', 'typescript', 'jsx', 'tsx', 'php', 'markdown']);
const VOID_TAGS = new Set(['area', 'base', 'br', 'col', 'embed', 'hr', 'img', 'input', 'link', 'meta', 'param', 'source', 'track', 'wbr']);

interface TagToken {
  name: string;
  isClose: boolean;
  selfClosing: boolean;
  startOff: number;
  endOff: number;
}

function scanTags(text: string): TagToken[] {
  const out: TagToken[] = [];
  const re = /<(\/?)([A-Za-z][A-Za-z0-9._:-]*)([^<>]*?)(\/?)>/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text))) {
    const isClose = m[1] === '/';
    const name = m[2]!;
    const selfClosing = m[4] === '/' || (!isClose && VOID_TAGS.has(name.toLowerCase()));
    const nameStart = m.index + 1 + (isClose ? 1 : 0);
    out.push({ name, isClose, selfClosing, startOff: nameStart, endOff: nameStart + name.length });
  }
  return out;
}

function findMatchingTag(tags: TagToken[], index: number): TagToken | null {
  const cur = tags[index]!;
  if (cur.selfClosing) return null;
  if (!cur.isClose) {
    let depth = 0;
    for (let i = index + 1; i < tags.length; i++) {
      const t = tags[i]!;
      if (t.selfClosing) continue;
      if (!t.isClose) depth++;
      else {
        if (depth === 0) return t;
        depth--;
      }
    }
  } else {
    let depth = 0;
    for (let i = index - 1; i >= 0; i--) {
      const t = tags[i]!;
      if (t.selfClosing) continue;
      if (t.isClose) depth++;
      else {
        if (depth === 0) return t;
        depth--;
      }
    }
  }
  return null;
}

/**
 * Linked Editing Ranges contribution:
 * Auto-renames matching HTML/XML/JSX opening & closing tags as you type,
 * and supports registered `LinkedEditingRangeProvider`s.
 */
export class LinkedEditingController implements IEditorContribution {
  readonly id = ContributionIds.LinkedEditing;
  private readonly host: IEditorContributionHost;
  private enabled: boolean;
  private applying = false;

  constructor(host: IEditorContributionHost) {
    this.host = host;
    this.enabled = host.initialOptions.linkedEditing !== false;
  }

  onOptionsChange(patch: Partial<MonoEditorOptions>): void {
    if (patch.linkedEditing !== undefined) this.enabled = patch.linkedEditing;
  }

  onInputChange(ev: InputChangeEvent): void {
    if (!this.enabled || this.applying || this.host.isReadOnly()) return;
    if (ev.kind !== 'type' && ev.kind !== 'backspace' && ev.kind !== 'delete') return;
    void this.syncLinkedEdit();
  }

  private async syncLinkedEdit(): Promise<void> {
    const model = this.host.getModel();
    const pos = this.host.getPosition();
    const langId = this.host.getLanguageIdAtPosition(pos.lineNumber, pos.column);

    // 1) Custom registered LinkedEditingRangeProviders
    const providers = languageFeatures.getLinkedEditingRangeProviders(langId);
    if (providers.length > 0) {
      const modelLike = this.host.modelAsFeatureLike();
      const token = { isCancellationRequested: false };
      for (const p of providers) {
        try {
          const res = await Promise.resolve(p.provideLinkedEditingRanges(modelLike, pos, token));
          if (res?.ranges && res.ranges.length >= 2) {
            this.syncProviderRanges(res.ranges, pos);
            return;
          }
        } catch { /* ignore provider error */ }
      }
    }

    // 2) Built-in HTML/XML/JSX paired tag auto-rename
    if (!TAG_LANGUAGES.has(langId)) return;
    const text = model.getValue();
    if (text.length > 150_000) return;

    const caretOff = model.getOffsetAt(pos.lineNumber, pos.column);
    const tags = scanTags(text);
    const idx = tags.findIndex((t) => caretOff >= t.startOff && caretOff <= t.endOff);
    if (idx < 0) return;

    const current = tags[idx]!;
    const pair = findMatchingTag(tags, idx);
    if (!pair || pair.name === current.name) return;

    const pairStart = model.getPositionAt(pair.startOff);
    const pairEnd = model.getPositionAt(pair.endOff);
    const savedPos = this.host.getPosition();

    this.applying = true;
    try {
      const sOff = model.getOffsetAt(pairStart.lineNumber, pairStart.column);
      const eOff = model.getOffsetAt(pairEnd.lineNumber, pairEnd.column);
      const delta = current.name.length - pair.name.length;
      model.replaceRange(sOff, eOff, current.name);
      const adjustedCaretOff = sOff < caretOff ? caretOff + delta : caretOff;
      const nextCaret = model.getPositionAt(Math.max(0, Math.min(model.getValue().length, adjustedCaretOff)));
      this.host.selection.setCaret(nextCaret.lineNumber, nextCaret.column);
      this.host.view.paint();
      this.host.syncTextarea();
      if (savedPos.lineNumber !== nextCaret.lineNumber || savedPos.column !== nextCaret.column) {
        this.host.emitCursorEvents('linkedEditing');
      }
    } finally {
      this.applying = false;
    }
  }

  private syncProviderRanges(ranges: readonly IRange[], pos: { lineNumber: number; column: number }): void {
    const model = this.host.getModel();
    const activeIdx = ranges.findIndex(
      (r) =>
        pos.lineNumber >= r.startLineNumber &&
        pos.lineNumber <= r.endLineNumber &&
        (pos.lineNumber !== r.startLineNumber || pos.column >= r.startColumn) &&
        (pos.lineNumber !== r.endLineNumber || pos.column <= r.endColumn),
    );
    if (activeIdx < 0) return;
    const activeText = model.getValueInRange(ranges[activeIdx]!);
    const edits = ranges
      .filter((r, i) => i !== activeIdx && model.getValueInRange(r) !== activeText)
      .map((r) => ({ range: r, text: activeText }));
    if (!edits.length) return;
    this.applying = true;
    try {
      const saved = this.host.getPosition();
      model.applyEdits(edits);
      this.host.selection.setCaret(saved.lineNumber, saved.column);
      this.host.view.paint();
    } finally {
      this.applying = false;
    }
  }

  dispose(): void {
    /* stateless */
  }
}
