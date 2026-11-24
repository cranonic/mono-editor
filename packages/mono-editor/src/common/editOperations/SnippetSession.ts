import type { TextModel } from '../model/TextModel';
import type { SelectionState } from '../core/SelectionState';

export interface ParsedTabstop {
  /** Tabstop number: 1, 2, ... and 0 for final exit position */
  index: number;
  /** Offset relative to start of expanded snippet text */
  startOffset: number;
  /** End offset relative to start of expanded snippet text */
  endOffset: number;
  placeholder: string;
  choices?: string[];
}

export interface ParsedSnippet {
  text: string;
  tabstops: ParsedTabstop[];
}

/**
 * Parses a VS Code / TextMate snippet template into plain expanded text + tabstop offsets.
 * Supports:
 *  - `$1`, `$2`, `$0`
 *  - `${1:placeholder}`
 *  - `${1|choiceA,choiceB,choiceC|}`
 *  - Escaped `\$`, `\}`, `\\`
 */
export function parseSnippet(template: string): ParsedSnippet {
  let out = '';
  const tabstops: ParsedTabstop[] = [];
  let i = 0;

  while (i < template.length) {
    const ch = template[i]!;

    // Escaped characters
    if (ch === '\\' && i + 1 < template.length) {
      const next = template[i + 1]!;
      if (next === '$' || next === '}' || next === '\\') {
        out += next;
        i += 2;
        continue;
      }
    }

    // Tabstop / placeholder
    if (ch === '$') {
      // Simple $0, $1, $2 ...
      const simple = /^\$(\d+)/.exec(template.slice(i));
      if (simple) {
        const idx = parseInt(simple[1]!, 10);
        const startOffset = out.length;
        tabstops.push({ index: idx, startOffset, endOffset: startOffset, placeholder: '' });
        i += simple[0].length;
        continue;
      }

      // Braced ${1:placeholder} or ${1|a,b,c|} or ${1}
      if (template[i + 1] === '{') {
        let j = i + 2;
        let numStr = '';
        while (j < template.length && /\d/.test(template[j]!)) {
          numStr += template[j]!;
          j++;
        }
        if (numStr) {
          const idx = parseInt(numStr, 10);
          // Choice placeholder ${1|a,b,c|}
          if (template[j] === '|') {
            const closeIdx = template.indexOf('|}', j + 1);
            if (closeIdx >= 0) {
              const rawChoices = template.slice(j + 1, closeIdx);
              const choices = rawChoices.split(',').map((s) => s.trim()).filter(Boolean);
              const first = choices[0] ?? '';
              const startOffset = out.length;
              out += first;
              tabstops.push({
                index: idx,
                startOffset,
                endOffset: out.length,
                placeholder: first,
                choices,
              });
              i = closeIdx + 2;
              continue;
            }
          }
          // Default value placeholder ${1:default}
          if (template[j] === ':') {
            let depth = 1;
            let k = j + 1;
            let body = '';
            while (k < template.length && depth > 0) {
              if (template[k] === '\\' && k + 1 < template.length) {
                body += template[k + 1]!;
                k += 2;
                continue;
              }
              if (template[k] === '{') depth++;
              else if (template[k] === '}') {
                depth--;
                if (depth === 0) break;
              }
              body += template[k]!;
              k++;
            }
            if (depth === 0) {
              const startOffset = out.length;
              out += body;
              tabstops.push({
                index: idx,
                startOffset,
                endOffset: out.length,
                placeholder: body,
              });
              i = k + 1;
              continue;
            }
          }
          // Bare ${1}
          if (template[j] === '}') {
            const startOffset = out.length;
            tabstops.push({ index: idx, startOffset, endOffset: startOffset, placeholder: '' });
            i = j + 1;
            continue;
          }
        }
      }
    }

    out += ch;
    i++;
  }

  return { text: out, tabstops };
}

/** Returns true if a completion string contains snippet tabstop syntax (`$0`, `$1`, `${1:...}`). */
export function hasSnippetSyntax(text: string): boolean {
  return /\$(?:\d+|\{\d+(?::[^}]*|\|[^|]*\|)?\})/.test(text);
}

interface LiveStop {
  index: number;
  startOffset: number;
  endOffset: number;
}

/**
 * Interactive snippet tabstop session for `@mono/editor`.
 * Inserts expanded text in one undo step, tracks live offsets across edits,
 * and navigates tabstops via `Tab` / `Shift+Tab` / `Escape`.
 */
export class SnippetSession {
  private model: TextModel | null = null;
  private selection: SelectionState | null = null;
  private stops: LiveStop[] = [];
  private orderedIndices: number[] = [];
  private currentOrderPos = -1;
  private lastModelLength = 0;
  private onUpdate?: () => void;

  constructor(onUpdate?: () => void) {
    this.onUpdate = onUpdate;
  }

  isActive(): boolean {
    return this.currentOrderPos >= 0 && this.orderedIndices.length > 0 && this.model != null;
  }

  getActiveIndex(): number | null {
    if (!this.isActive()) return null;
    return this.orderedIndices[this.currentOrderPos] ?? null;
  }

  /**
   * Expand `template` into `[replaceStart, replaceEnd)` in `model`, indenting multi-line
   * snippet lines to match the insertion line's leading whitespace.
   */
  insert(
    model: TextModel,
    selection: SelectionState,
    replaceStart: number,
    replaceEnd: number,
    template: string,
    lineIndent = '',
  ): void {
    this.cancel();

    // Apply base indentation to subsequent lines of multi-line snippet templates
    const indentedTemplate =
      lineIndent && template.includes('\n')
        ? template.replace(/\r\n/g, '\n').replace(/\n/g, `\n${lineIndent}`)
        : template;

    const parsed = parseSnippet(indentedTemplate);
    const eol = model.getEOL();
    const expanded = eol === '\r\n' ? parsed.text.replace(/\n/g, '\r\n') : parsed.text;

    // Map LF-relative offsets from parseSnippet to CRLF-relative offsets when needed
    const mapOffset = (lfOff: number): number => {
      if (eol === '\n') return replaceStart + lfOff;
      let extra = 0;
      for (let i = 0; i < lfOff && i < parsed.text.length; i++) {
        if (parsed.text[i] === '\n') extra++;
      }
      return replaceStart + lfOff + extra;
    };

    model.replaceRange(replaceStart, replaceEnd, expanded);

    if (!parsed.tabstops.length) {
      const pos = model.getPositionAt(replaceStart + expanded.length);
      selection.setCaret(pos.lineNumber, pos.column);
      this.onUpdate?.();
      return;
    }

    this.model = model;
    this.selection = selection;
    this.lastModelLength = model.getValue().length;
    this.stops = parsed.tabstops.map((t) => ({
      index: t.index,
      startOffset: mapOffset(t.startOffset),
      endOffset: mapOffset(t.endOffset),
    }));

    // Order: 1, 2, 3, ..., then 0 (final cursor stop)
    const positive = [...new Set(this.stops.map((s) => s.index).filter((n) => n > 0))].sort(
      (a, b) => a - b,
    );
    const hasZero = this.stops.some((s) => s.index === 0);
    if (!hasZero) {
      const endOff = replaceStart + expanded.length;
      this.stops.push({ index: 0, startOffset: endOff, endOffset: endOff });
    }
    this.orderedIndices = [...positive, 0];
    this.currentOrderPos = 0;
    this.selectCurrentStop();

    // If only $0 existed, session finishes immediately after positioning caret
    if (this.orderedIndices[this.currentOrderPos] === 0) {
      this.cancel();
    }
  }

  /** Called right after the user types/deletes inside the active tabstop so subsequent stop offsets stay aligned. */
  syncAfterEdit(): void {
    if (!this.isActive() || !this.model || !this.selection) return;
    const newLen = this.model.getValue().length;
    const delta = newLen - this.lastModelLength;
    this.lastModelLength = newLen;
    if (delta === 0) return;

    const activeStop = this.primaryStopFor(this.orderedIndices[this.currentOrderPos]!);
    if (!activeStop) {
      this.cancel();
      return;
    }

    const caretOff = this.model.getOffsetAt(
      this.selection.active.lineNumber,
      this.selection.active.column,
    );

    // If edit happened outside the active stop range, cancel snippet mode gracefully
    if (caretOff < activeStop.startOffset || caretOff > activeStop.endOffset + Math.max(0, delta) + 1) {
      this.cancel();
      return;
    }

    const prevEnd = activeStop.endOffset;
    activeStop.endOffset = Math.max(activeStop.startOffset, activeStop.endOffset + delta);
    for (const s of this.stops) {
      if (s === activeStop) continue;
      if (s.startOffset >= prevEnd) {
        s.startOffset = Math.max(0, s.startOffset + delta);
        s.endOffset = Math.max(s.startOffset, s.endOffset + delta);
      } else if (s.endOffset >= prevEnd) {
        s.endOffset = Math.max(s.startOffset, s.endOffset + delta);
      }
    }
  }

  next(): boolean {
    if (!this.isActive()) return false;
    if (this.currentOrderPos + 1 >= this.orderedIndices.length) {
      this.cancel();
      return false;
    }
    this.currentOrderPos++;
    this.selectCurrentStop();
    if (this.orderedIndices[this.currentOrderPos] === 0) {
      this.cancel();
    }
    this.onUpdate?.();
    return true;
  }

  prev(): boolean {
    if (!this.isActive()) return false;
    if (this.currentOrderPos <= 0) return true;
    this.currentOrderPos--;
    this.selectCurrentStop();
    this.onUpdate?.();
    return true;
  }

  handleKey(e: { key: string; shiftKey?: boolean; ctrlKey?: boolean; metaKey?: boolean; altKey?: boolean }): boolean {
    if (!this.isActive()) return false;
    if (e.key === 'Tab' && !e.ctrlKey && !e.metaKey && !e.altKey) {
      return e.shiftKey ? this.prev() : this.next();
    }
    if (e.key === 'Escape') {
      this.cancel();
      this.onUpdate?.();
      return true;
    }
    return false;
  }

  cancel(): void {
    this.stops = [];
    this.orderedIndices = [];
    this.currentOrderPos = -1;
    this.model = null;
    this.selection = null;
  }

  private primaryStopFor(index: number): LiveStop | undefined {
    return this.stops.find((s) => s.index === index);
  }

  private selectCurrentStop(): void {
    if (!this.model || !this.selection) return;
    const idx = this.orderedIndices[this.currentOrderPos];
    if (idx === undefined) return;
    const stop = this.primaryStopFor(idx);
    if (!stop) return;
    const sPos = this.model.getPositionAt(stop.startOffset);
    const ePos = this.model.getPositionAt(stop.endOffset);
    this.selection.anchor = { lineNumber: sPos.lineNumber, column: sPos.column };
    this.selection.active = { lineNumber: ePos.lineNumber, column: ePos.column };
  }
}
