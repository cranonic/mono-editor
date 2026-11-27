import type {
  MonoSuggestOptions,
  SnippetSuggestionsMode,
} from '../../common/config/editorOptions';
import { languageFeatures } from '../../common/languages/languageFeaturesService';
import {
  CompletionItemKind,
  type CompletionItem,
} from '../../common/languages/providers/types';

let defaultProvidersRegistered = false;

const JS_KEYWORDS = [
  'function', 'const', 'let', 'var', 'if', 'else', 'return', 'for', 'while',
  'switch', 'case', 'break', 'continue', 'class', 'extends', 'new', 'this',
  'import', 'export', 'default', 'from', 'async', 'await', 'try', 'catch',
  'finally', 'throw', 'typeof', 'instanceof', 'true', 'false', 'null', 'undefined',
  'console', 'document', 'window', 'Promise', 'Array', 'Object', 'Map', 'Set',
];

const TS_EXTRA_KEYWORDS = [
  'interface', 'type', 'readonly', 'enum', 'implements', 'private', 'public',
  'protected', 'abstract', 'unknown', 'never', 'keyof', 'Record', 'Partial', 'Readonly',
];

const CSS_PROPERTIES = [
  'display', 'flex-direction', 'justify-content', 'align-items', 'flex-wrap', 'gap',
  'grid-template-columns', 'grid-template-rows', 'position', 'top', 'right', 'bottom', 'left',
  'z-index', 'width', 'height', 'min-width', 'max-width', 'min-height', 'max-height',
  'margin', 'padding', 'border', 'border-radius', 'outline', 'box-sizing', 'box-shadow',
  'background', 'background-color', 'background-image', 'color', 'opacity', 'overflow',
  'font-family', 'font-size', 'font-weight', 'line-height', 'letter-spacing', 'text-align',
  'text-decoration', 'white-space', 'cursor', 'pointer-events', 'user-select',
  'transition', 'transform', 'animation', 'backdrop-filter', 'filter',
];

const CSS_VALUES = [
  'flex', 'inline-flex', 'grid', 'block', 'inline-block', 'none', 'relative', 'absolute',
  'fixed', 'sticky', 'center', 'space-between', 'space-around', 'stretch', 'nowrap', 'wrap',
  'hidden', 'auto', 'scroll', 'transparent', 'currentColor', 'inherit', 'pointer', 'border-box',
  'var(--)', 'calc()', 'rgb()', 'rgba()', 'hsl()', 'linear-gradient()',
];

const HTML_TAGS = [
  'div', 'span', 'section', 'header', 'main', 'footer', 'nav', 'article', 'aside',
  'h1', 'h2', 'h3', 'h4', 'p', 'a', 'button', 'input', 'textarea', 'select', 'option',
  'form', 'label', 'ul', 'ol', 'li', 'table', 'thead', 'tbody', 'tr', 'th', 'td',
  'img', 'svg', 'canvas', 'pre', 'code', 'style', 'script', 'link', 'meta',
];

const HTML_ATTRS = [
  'class', 'id', 'style', 'href', 'src', 'type', 'value', 'name', 'placeholder',
  'aria-label', 'role', 'tabindex', 'rel', 'lang', 'defer', 'async', 'disabled',
];

export function ensureDefaultCompletionProviders(): void {
  if (defaultProvidersRegistered) return;
  defaultProvidersRegistered = true;

  languageFeatures.registerCompletionItemProvider('css', {
    triggerCharacters: [':', '-'],
    provideCompletionItems(model, pos) {
      const line = model.getLineContent(pos.lineNumber).slice(0, Math.max(0, pos.column - 1));
      const afterColon = /:[^;{}]*$/.test(line);
      if (afterColon) {
        return {
          suggestions: CSS_VALUES.map((v) => ({
            label: v,
            kind: 11,
            detail: 'CSS value',
            insertText: v,
          })),
        };
      }
      return {
        suggestions: CSS_PROPERTIES.map((prop) => ({
          label: prop,
          kind: 9,
          detail: 'CSS property',
          insertText: `${prop}: `,
        })),
      };
    },
  });

  languageFeatures.registerCompletionItemProvider('html', {
    triggerCharacters: ['<', ' '],
    provideCompletionItems(model, pos) {
      const before = model.getLineContent(pos.lineNumber).slice(0, Math.max(0, pos.column - 1));
      const inTagAttrs = /<[a-zA-Z][\w-]*\s+[^>]*$/.test(before);
      if (inTagAttrs) {
        return {
          suggestions: HTML_ATTRS.map((attr) => ({
            label: attr,
            kind: 9,
            detail: 'HTML attribute',
            insertText: `${attr}="$1"`,
          })),
        };
      }
      return {
        suggestions: HTML_TAGS.map((tag) => ({
          label: tag,
          kind: 13,
          detail: 'HTML tag',
          insertText: tag,
        })),
      };
    },
  });

  const jsProvider = {
    provideCompletionItems() {
      return {
        suggestions: JS_KEYWORDS.map((k) => ({
          label: k,
          kind: 13,
          detail: 'keyword',
          insertText: k,
        })),
      };
    },
  };
  languageFeatures.registerCompletionItemProvider('javascript', jsProvider);
  languageFeatures.registerCompletionItemProvider('plaintext', jsProvider);
  languageFeatures.registerCompletionItemProvider('typescript', {
    provideCompletionItems() {
      return {
        suggestions: [...JS_KEYWORDS, ...TS_EXTRA_KEYWORDS].map((k) => ({
          label: k,
          kind: 13,
          detail: 'keyword',
          insertText: k,
        })),
      };
    },
  });
}

export function labelOfCompletion(item: CompletionItem): string {
  return typeof item.label === 'string' ? item.label : item.label?.label || '';
}

function isWordBoundary(text: string, idx: number): boolean {
  if (idx <= 0) return true;
  const prev = text[idx - 1]!;
  const cur = text[idx]!;
  if (prev === '_' || prev === '-' || prev === '.' || prev === '$' || prev === ' ') return true;
  return /[a-z]/.test(prev) && /[A-Z]/.test(cur);
}

export interface SuggestMatchOptions {
  filterGraceful?: boolean;
  matchOnWordStartOnly?: boolean;
}

export interface SuggestFilterOptions extends SuggestMatchOptions {
  localityBonus?: boolean;
  localityScores?: ReadonlyMap<string, number>;
  snippetSuggestions?: SnippetSuggestionsMode;
  kindVisibility?: Readonly<Partial<Record<number, boolean>>>;
}

export function buildKindVisibilityMap(
  suggest?: MonoSuggestOptions,
): Partial<Record<number, boolean>> {
  if (!suggest) return {};
  const map: Partial<Record<number, boolean>> = {};
  const pairs: ReadonlyArray<[keyof MonoSuggestOptions, number]> = [
    ['showWords', CompletionItemKind.Text],
    ['showMethods', CompletionItemKind.Method],
    ['showFunctions', CompletionItemKind.Function],
    ['showConstructors', CompletionItemKind.Constructor],
    ['showFields', CompletionItemKind.Field],
    ['showVariables', CompletionItemKind.Variable],
    ['showClasses', CompletionItemKind.Class],
    ['showInterfaces', CompletionItemKind.Interface],
    ['showModules', CompletionItemKind.Module],
    ['showProperties', CompletionItemKind.Property],
    ['showUnits', CompletionItemKind.Unit],
    ['showValues', CompletionItemKind.Value],
    ['showEnums', CompletionItemKind.Enum],
    ['showKeywords', CompletionItemKind.Keyword],
    ['showSnippets', CompletionItemKind.Snippet],
    ['showColors', CompletionItemKind.Color],
    ['showFiles', CompletionItemKind.File],
    ['showReferences', CompletionItemKind.Reference],
    ['showFolders', CompletionItemKind.Folder],
    ['showEnumMembers', CompletionItemKind.EnumMember],
    ['showConstants', CompletionItemKind.Constant],
    ['showStructs', CompletionItemKind.Struct],
    ['showEvents', CompletionItemKind.Event],
    ['showOperators', CompletionItemKind.Operator],
    ['showTypeParameters', CompletionItemKind.TypeParameter],
    ['showUsers', CompletionItemKind.User],
    ['showIssues', CompletionItemKind.Issue],
  ];
  for (const [key, kind] of pairs) {
    const val = suggest[key];
    if (typeof val === 'boolean') map[kind] = val;
  }
  return map;
}

/**
 * Score how well `candidate` matches typed `prefix`.
 * Returns `-1` when it does not match (filtered out). Higher score = better match.
 */
export function scoreCompletionMatch(
  candidate: string,
  prefix: string,
  opts?: SuggestMatchOptions,
): number {
  if (!prefix) return 0;
  if (!candidate) return -1;
  const filterGraceful = opts?.filterGraceful !== false;
  const matchOnWordStartOnly = opts?.matchOnWordStartOnly !== false;
  const cLow = candidate.toLowerCase();
  const pLow = prefix.toLowerCase();

  if (candidate.startsWith(prefix)) {
    return 1000 - Math.min(200, candidate.length - prefix.length);
  }
  if (cLow.startsWith(pLow)) {
    return 900 - Math.min(200, candidate.length - prefix.length);
  }

  // Contiguous substring match
  let subIdx = cLow.indexOf(pLow);
  if (matchOnWordStartOnly) {
    while (subIdx >= 0 && !isWordBoundary(candidate, subIdx)) {
      subIdx = cLow.indexOf(pLow, subIdx + 1);
    }
  }
  if (subIdx >= 0) {
    const boundaryBonus = isWordBoundary(candidate, subIdx) ? 200 : 0;
    return 500 + boundaryBonus - Math.min(200, subIdx * 4 + (candidate.length - prefix.length));
  }

  if (!filterGraceful) return -1;

  // Non-contiguous subsequence fuzzy match
  const startFrom = matchOnWordStartOnly
    ? (() => {
        for (let i = 0; i < cLow.length; i++) {
          if (cLow[i] === pLow[0] && isWordBoundary(candidate, i)) return i;
        }
        return -1;
      })()
    : 0;
  if (startFrom < 0) return -1;

  let j = 0;
  let firstHit = -1;
  let lastHit = -1;
  let boundaryHits = 0;
  for (let i = startFrom; i < cLow.length && j < pLow.length; i++) {
    if (cLow[i] === pLow[j]) {
      if (firstHit < 0) firstHit = i;
      lastHit = i;
      if (isWordBoundary(candidate, i)) boundaryHits++;
      j++;
    }
  }
  if (j === pLow.length) {
    const span = Math.max(0, lastHit - firstHit);
    return 200 + boundaryHits * 25 - Math.min(180, span * 3 + firstHit);
  }
  return -1;
}

/** Filter and sort completion items against `prefix` (Monaco/VS Code semantics). */
export function filterAndSortSuggestions(
  items: CompletionItem[],
  prefix: string,
  opts?: SuggestFilterOptions,
): CompletionItem[] {
  const snippetMode = opts?.snippetSuggestions ?? 'inline';
  const kindVis = opts?.kindVisibility;
  const useLocality = Boolean(opts?.localityBonus && opts.localityScores);
  const localityScores = opts?.localityScores;

  const scored: { item: CompletionItem; score: number; sortKey: string; isSnippet: boolean }[] = [];
  for (const item of items) {
    const kind = item.kind ?? CompletionItemKind.Text;
    if (kindVis && kindVis[kind] === false) continue;
    const isSnippet = kind === CompletionItemKind.Snippet;
    if (isSnippet && snippetMode === 'none') continue;

    const filterTarget = item.filterText ?? labelOfCompletion(item);
    let score = scoreCompletionMatch(filterTarget, prefix, opts);
    if (score < 0) continue;

    if (useLocality && localityScores) {
      const bonus = localityScores.get(labelOfCompletion(item)) ?? 0;
      score += bonus;
    }

    scored.push({
      item,
      score,
      sortKey: (item.sortText ?? labelOfCompletion(item)).toLowerCase(),
      isSnippet,
    });
  }
  scored.sort((a, b) => {
    if (snippetMode === 'top' && a.isSnippet !== b.isSnippet) {
      return a.isSnippet ? -1 : 1;
    }
    if (snippetMode === 'bottom' && a.isSnippet !== b.isSnippet) {
      return a.isSnippet ? 1 : -1;
    }
    const preA = a.item.preselect ? 1 : 0;
    const preB = b.item.preselect ? 1 : 0;
    if (preA !== preB) return preB - preA;
    if (a.score !== b.score) return b.score - a.score;
    return a.sortKey < b.sortKey ? -1 : a.sortKey > b.sortKey ? 1 : 0;
  });
  return scored.map((s) => s.item);
}
