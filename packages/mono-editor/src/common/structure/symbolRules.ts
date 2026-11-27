import type { IRange } from '../core/types';
import { SymbolKind, type DocumentSymbol } from '../languages/providers/types';
import type { TextModel } from '../model/TextModel';
import { StructureKind, type StructureTree } from './types';

interface MatchedHeader {
  name: string;
  detail: string;
  kind: SymbolKind;
  selectionCol: number;
  selectionEndCol: number;
}

const SKIP_KEYWORDS = new Set([
  'if', 'else', 'for', 'while', 'do', 'switch', 'case', 'default',
  'return', 'break', 'continue', 'try', 'catch', 'finally', 'throw',
  'new', 'delete', 'sizeof', 'typeof', 'yield', 'await', 'assert', 'synchronized',
]);

function makeSelectionRange(line: number, raw: string, name: string): IRange {
  const idx = raw.indexOf(name);
  const startColumn = idx >= 0 ? idx + 1 : 1;
  return {
    startLineNumber: line,
    startColumn,
    endLineNumber: line,
    endColumn: startColumn + name.length,
  };
}

function matchJsTs(clean: string, inClass: boolean): MatchedHeader | null {
  let m = clean.match(/^\s*(?:export\s+)?(?:default\s+)?(?:abstract\s+)?class\s+([A-Za-z_$][\w$]*)/);
  if (m) return { name: m[1]!, detail: 'class', kind: SymbolKind.Class, selectionCol: 1, selectionEndCol: 1 };

  m = clean.match(/^\s*(?:export\s+)?interface\s+([A-Za-z_$][\w$]*)/);
  if (m) return { name: m[1]!, detail: 'interface', kind: SymbolKind.Interface, selectionCol: 1, selectionEndCol: 1 };

  m = clean.match(/^\s*(?:export\s+)?(?:const\s+)?enum\s+([A-Za-z_$][\w$]*)/);
  if (m) return { name: m[1]!, detail: 'enum', kind: SymbolKind.Enum, selectionCol: 1, selectionEndCol: 1 };

  m = clean.match(/^\s*(?:export\s+)?type\s+([A-Za-z_$][\w$]*)\s*(?:<[^>]*>)?\s*=/);
  if (m) return { name: m[1]!, detail: 'type', kind: SymbolKind.TypeParameter, selectionCol: 1, selectionEndCol: 1 };

  m = clean.match(/^\s*(?:export\s+)?(?:declare\s+)?namespace\s+([A-Za-z_$][\w$.]*)/);
  if (m) return { name: m[1]!, detail: 'namespace', kind: SymbolKind.Namespace, selectionCol: 1, selectionEndCol: 1 };

  m = clean.match(/^\s*(?:export\s+)?(?:default\s+)?(?:async\s+)?function\s*\*?\s+([A-Za-z_$][\w$]*)/);
  if (m) return { name: m[1]!, detail: 'function', kind: SymbolKind.Function, selectionCol: 1, selectionEndCol: 1 };

  m = clean.match(/^\s*(?:export\s+)?(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*(?::[^=]+)?=\s*(?:async\s+)?(?:\([^)]*\)|[A-Za-z_$][\w$]*)\s*=>/);
  if (m) return { name: m[1]!, detail: 'arrow function', kind: SymbolKind.Function, selectionCol: 1, selectionEndCol: 1 };

  m = clean.match(/^\s*(?:public|private|protected|static|readonly|override|abstract|async|get|set|\s)*\*?([A-Za-z_$][\w$]*)\s*(?:<[^>]*>)?\s*\([^)]*\)\s*(?::[^{;]+)?\{/);
  if (m && !SKIP_KEYWORDS.has(m[1]!)) {
    const name = m[1]!;
    const kind = name === 'constructor' ? SymbolKind.Constructor : inClass ? SymbolKind.Method : SymbolKind.Function;
    return { name, detail: name === 'constructor' ? 'constructor' : inClass ? 'method' : 'function', kind, selectionCol: 1, selectionEndCol: 1 };
  }

  m = clean.match(/^\s*(?:export\s+)?(const|let|var)\s+([A-Za-z_$][\w$]*)\s*(?::[^=]+)?=\s*(.*)/);
  if (m) {
    const rhs = (m[3] ?? '').trim();
    const kind = rhs.startsWith('[') ? SymbolKind.Array : rhs.startsWith('{') ? SymbolKind.Object : m[1] === 'const' ? SymbolKind.Constant : SymbolKind.Variable;
    return { name: m[2]!, detail: m[1]!, kind, selectionCol: 1, selectionEndCol: 1 };
  }

  m = clean.match(/^\s*['"]?([A-Za-z_$][\w$]*)['"]?\s*:\s*\{/);
  if (m && !SKIP_KEYWORDS.has(m[1]!)) {
    return { name: m[1]!, detail: 'object', kind: SymbolKind.Object, selectionCol: 1, selectionEndCol: 1 };
  }
  return null;
}

function matchPython(raw: string, inClass: boolean): MatchedHeader | null {
  let m = raw.match(/^\s*class\s+([A-Za-z_]\w*)\s*(?:\(([^)]*)\))?\s*:/);
  if (m) return { name: m[1]!, detail: m[2] ? `class(${m[2].trim()})` : 'class', kind: SymbolKind.Class, selectionCol: 1, selectionEndCol: 1 };

  m = raw.match(/^\s*(async\s+)?def\s+([A-Za-z_]\w*)\s*\(/);
  if (m) {
    const name = m[2]!;
    const kind = inClass
      ? (name === '__init__' ? SymbolKind.Constructor : SymbolKind.Method)
      : SymbolKind.Function;
    return { name, detail: m[1] ? 'async def' : 'def', kind, selectionCol: 1, selectionEndCol: 1 };
  }

  m = raw.match(/^\s*(self\.)?([A-Za-z_]\w*)\s*(?::\s*[\w[\], |.]+)?\s*=\s*(.*)/);
  if (m && !SKIP_KEYWORDS.has(m[2]!)) {
    const isSelf = !!m[1];
    const name = m[2]!;
    const rhs = (m[3] ?? '').trim();
    const kind = isSelf
      ? SymbolKind.Property
      : rhs.startsWith('[')
        ? SymbolKind.Array
        : rhs.startsWith('{')
          ? SymbolKind.Object
          : /^[A-Z][A-Z0-9_]+$/.test(name)
            ? SymbolKind.Constant
            : SymbolKind.Variable;
    return { name, detail: isSelf ? 'property' : 'variable', kind, selectionCol: 1, selectionEndCol: 1 };
  }
  return null;
}

function matchJava(clean: string, parentName: string | null): MatchedHeader | null {
  let m = clean.match(/^\s*package\s+([\w.]+)\s*;/);
  if (m) return { name: m[1]!, detail: 'package', kind: SymbolKind.Package, selectionCol: 1, selectionEndCol: 1 };

  m = clean.match(/^\s*(?:(?:public|protected|private|abstract|static|final|sealed|non-sealed)\s+)*(class|interface|enum|record|@interface)\s+([A-Za-z_$][\w$]*)/);
  if (m) {
    const t = m[1]!;
    const kind = t === 'enum' ? SymbolKind.Enum : t === 'interface' || t === '@interface' ? SymbolKind.Interface : t === 'record' ? SymbolKind.Struct : SymbolKind.Class;
    return { name: m[2]!, detail: t, kind, selectionCol: 1, selectionEndCol: 1 };
  }

  m = clean.match(/^\s*(?:(?:public|protected|private)\s+)*([A-Z][A-Za-z_$][\w$]*)\s*\([^)]*\)\s*(?:throws\s+[\w$,\s]+)?\s*\{/);
  if (m && parentName && m[1] === parentName) {
    return { name: m[1]!, detail: 'constructor', kind: SymbolKind.Constructor, selectionCol: 1, selectionEndCol: 1 };
  }

  m = clean.match(/^\s*(?:(?:public|protected|private|abstract|static|final|synchronized|native|<[^>]+>)\s+)*([\w$<>[\]?,\s]+)\s+([A-Za-z_$][\w$]*)\s*\([^)]*\)\s*(?:throws\s+[\w$,\s]+)?\s*(?:\{|;)/);
  if (m && !SKIP_KEYWORDS.has(m[2]!) && !SKIP_KEYWORDS.has(m[1]!.trim())) {
    return { name: m[2]!, detail: m[1]!.trim(), kind: SymbolKind.Method, selectionCol: 1, selectionEndCol: 1 };
  }
  return null;
}

function matchCpp(clean: string, parentName: string | null): MatchedHeader | null {
  let m = clean.match(/^\s*#\s*define\s+([A-Za-z_]\w*)\s*\(/);
  if (m) return { name: m[1]!, detail: '#define', kind: SymbolKind.Function, selectionCol: 1, selectionEndCol: 1 };

  m = clean.match(/^\s*#\s*define\s+([A-Za-z_]\w*)(?!\s*\()\s/);
  if (m) return { name: m[1]!, detail: '#define', kind: SymbolKind.Constant, selectionCol: 1, selectionEndCol: 1 };

  m = clean.match(/^\s*namespace\s+([A-Za-z_][\w:]*)?\s*\{?/);
  if (m) return { name: m[1]?.trim() || '(anonymous)', detail: 'namespace', kind: SymbolKind.Namespace, selectionCol: 1, selectionEndCol: 1 };

  m = clean.match(/^\s*(?:template\s*<[^>]*>\s*)?(?:export\s+)?(class|struct|union)\s+([A-Za-z_]\w*)/);
  if (m) {
    return { name: m[2]!, detail: m[1]!, kind: m[1] === 'class' ? SymbolKind.Class : SymbolKind.Struct, selectionCol: 1, selectionEndCol: 1 };
  }

  m = clean.match(/^\s*enum\s+(?:class\s+)?([A-Za-z_]\w*)/);
  if (m) return { name: m[1]!, detail: 'enum', kind: SymbolKind.Enum, selectionCol: 1, selectionEndCol: 1 };

  m = clean.match(/^\s*(?:(?:static|inline|virtual|explicit|constexpr|extern|friend)\s+)*(?:const\s+)?(?:[\w:<>*&, \t[\]]+?)\s+\*{0,2}([A-Za-z_]\w*(?:::[A-Za-z_]\w*)*)\s*\([^;{]*\)\s*(?:const\s*)?(?:noexcept[^{;]*)?\s*(?:->\s*[\w:<>*& \t]+\s*)?\{/);
  if (m && !SKIP_KEYWORDS.has(m[1]!)) {
    const isCtor = parentName != null && m[1] === parentName;
    return { name: m[1]!, detail: isCtor ? 'constructor' : 'function', kind: isCtor ? SymbolKind.Constructor : SymbolKind.Function, selectionCol: 1, selectionEndCol: 1 };
  }
  return null;
}

function matchRust(clean: string): MatchedHeader | null {
  let m = clean.match(/\bmod\s+([A-Za-z_]\w*)/);
  if (m) return { name: m[1]!, detail: 'mod', kind: SymbolKind.Namespace, selectionCol: 1, selectionEndCol: 1 };
  m = clean.match(/\bstruct\s+([A-Za-z_]\w*)/);
  if (m) return { name: m[1]!, detail: 'struct', kind: SymbolKind.Struct, selectionCol: 1, selectionEndCol: 1 };
  m = clean.match(/\benum\s+([A-Za-z_]\w*)/);
  if (m) return { name: m[1]!, detail: 'enum', kind: SymbolKind.Enum, selectionCol: 1, selectionEndCol: 1 };
  m = clean.match(/\btrait\s+([A-Za-z_]\w*)/);
  if (m) return { name: m[1]!, detail: 'trait', kind: SymbolKind.Interface, selectionCol: 1, selectionEndCol: 1 };
  m = clean.match(/\bfn\s+([A-Za-z_]\w*)/);
  if (m) return { name: m[1]!, detail: 'fn', kind: SymbolKind.Function, selectionCol: 1, selectionEndCol: 1 };
  m = clean.match(/\bimpl\b(.*)$/);
  if (m) return { name: m[1]!.split('{')[0]!.split(';')[0]!.trim() || 'impl', detail: 'impl', kind: SymbolKind.Class, selectionCol: 1, selectionEndCol: 1 };
  return null;
}

function matchCss(raw: string): MatchedHeader | null {
  const idx = raw.indexOf('{');
  if (idx === -1) return null;
  const sel = raw.slice(0, idx).replace(/\/\*.*?\*\//g, '').trim().replace(/\s+/g, ' ');
  if (!sel) return null;
  if (sel.startsWith('@media') || sel.startsWith('@supports') || sel.startsWith('@layer')) {
    return { name: sel, detail: 'at-rule', kind: SymbolKind.Module, selectionCol: 1, selectionEndCol: 1 };
  }
  if (sel.startsWith('@keyframes')) {
    return { name: sel, detail: 'animation', kind: SymbolKind.Function, selectionCol: 1, selectionEndCol: 1 };
  }
  if (sel === ':root') return { name: sel, detail: 'global variables', kind: SymbolKind.Variable, selectionCol: 1, selectionEndCol: 1 };
  if (sel.startsWith('&')) return { name: sel, detail: 'nested rule', kind: SymbolKind.Property, selectionCol: 1, selectionEndCol: 1 };
  return { name: sel, detail: 'selector', kind: sel.startsWith('#') ? SymbolKind.Field : SymbolKind.Class, selectionCol: 1, selectionEndCol: 1 };
}

function matchHtml(raw: string): MatchedHeader | null {
  const m = raw.match(/<([A-Za-z][\w:-]*)([^>]*)>/);
  if (!m) return null;
  const tag = m[1]!.toLowerCase();
  const attrs = m[2] ?? '';
  const idM = attrs.match(/\bid\s*=\s*["']([^"']+)["']/);
  const clsM = attrs.match(/\bclass\s*=\s*["']([^"']+)["']/);
  let name = tag;
  if (idM) name += `#${idM[1]}`;
  if (clsM) {
    const classes = clsM[1]!.trim().split(/\s+/).filter(Boolean);
    if (classes.length) name += `.${classes.join('.')}`;
  }
  return {
    name,
    detail: `<${tag}>`,
    kind: tag === 'script' || tag === 'style' ? SymbolKind.Module : SymbolKind.Class,
    selectionCol: 1,
    selectionEndCol: 1,
  };
}

function matchMarkdown(raw: string): MatchedHeader | null {
  const m = /^ {0,3}(#{1,6})[ \t]+(.+?)\s*#*$/.exec(raw);
  if (!m) return null;
  const level = m[1]!.length;
  const name = m[2]!.replace(/<[^>]*>/g, '').trim();
  if (!name) return null;
  return { name, detail: `H${level}`, kind: SymbolKind.Module, selectionCol: 1, selectionEndCol: 1 };
}

function matchShell(raw: string): MatchedHeader | null {
  const m = raw.match(/^\s*(?:function\s+)?([A-Za-z_]\w*)\s*\(\s*\)\s*\{?/) ?? raw.match(/^\s*function\s+([A-Za-z_]\w*)\s*\{?/);
  if (!m) return null;
  return { name: m[1]!, detail: 'function', kind: SymbolKind.Function, selectionCol: 1, selectionEndCol: 1 };
}

function matchJson(raw: string): MatchedHeader | null {
  const m = raw.match(/^\s*"([^"]+)"\s*:\s*(\{|\[)?/);
  if (!m) return null;
  const rhs = m[2];
  const kind = rhs === '[' ? SymbolKind.Array : rhs === '{' ? SymbolKind.Object : SymbolKind.Property;
  return { name: m[1]!, detail: rhs === '[' ? 'array' : rhs === '{' ? 'object' : 'property', kind, selectionCol: 1, selectionEndCol: 1 };
}

/**
 * Extracts hierarchical `DocumentSymbol[]` by matching language symbol rules
 * against the pre-computed `StructureTree` node spans (so block end lines and
 * parent-child nesting are syntax-accurate).
 */
export function buildSymbolsFromTree(
  model: TextModel,
  tree: StructureTree,
  languageId: string,
): DocumentSymbol[] {
  const lang = languageId.toLowerCase();
  const lineCount = model.getLineCount();

  // Map startLine -> best structural node (preferring Block/Offside/Tag/Heading/Keyword over Comment/Imports)
  const blockEndByStartLine = new Map<number, number>();
  for (let i = 0; i < tree.count; i++) {
    const k = tree.kind[i] as StructureKind;
    if (k === StructureKind.Comment || k === StructureKind.Imports) continue;
    const s = tree.startLine[i]!;
    const e = tree.endLine[i]!;
    const prev = blockEndByStartLine.get(s);
    if (prev === undefined || e > prev) blockEndByStartLine.set(s, e);
  }

  const isJs = lang === 'javascript' || lang === 'typescript' || lang === 'javascriptreact' || lang === 'typescriptreact' || lang === 'js' || lang === 'ts';
  const isPy = lang === 'python' || lang === 'py';
  const isJava = lang === 'java';
  const isCpp = lang === 'c' || lang === 'cpp' || lang === 'c++' || lang === 'h' || lang === 'hpp';
  const isRust = lang === 'rust' || lang === 'rs';
  const isCss = lang === 'css' || lang === 'scss' || lang === 'less';
  const isHtml = lang === 'html' || lang === 'xml' || lang === 'svg' || lang === 'vue' || lang === 'svelte';
  const isMd = lang === 'markdown' || lang === 'md';
  const isShell = lang === 'shell' || lang === 'bash' || lang === 'sh' || lang === 'zsh';
  const isJson = lang === 'json' || lang === 'jsonc';

  if (!isJs && !isPy && !isJava && !isCpp && !isRust && !isCss && !isHtml && !isMd && !isShell && !isJson) {
    return [];
  }

  interface MutableSym {
    name: string;
    detail?: string;
    kind: SymbolKind;
    range: IRange;
    selectionRange: IRange;
    children: MutableSym[];
  }

  const roots: MutableSym[] = [];
  const stack: MutableSym[] = [];
  // Track comment lines from tree so we don't match symbols inside block comments
  const commentLines = new Uint8Array(lineCount + 1);
  for (let i = 0; i < tree.count; i++) {
    if ((tree.kind[i] as StructureKind) === StructureKind.Comment) {
      const s = Math.max(1, tree.startLine[i]!);
      const e = Math.min(lineCount, tree.endLine[i]!);
      for (let ln = s; ln <= e; ln++) commentLines[ln] = 1;
    }
  }

  for (let ln = 1; ln <= lineCount; ln++) {
    // Pop scopes that ended before this line
    while (stack.length > 0 && stack[stack.length - 1]!.range.endLineNumber < ln) {
      stack.pop();
    }
    if (commentLines[ln] === 1) continue;

    const raw = model.getLineContent(ln);
    const trimmed = raw.trim();
    if (!trimmed) continue;

    const clean = (isJs || isJava || isCpp || isRust)
      ? raw.replace(/\/\/.*$/, '').replace(/\/\*.*?\*\//g, '')
      : raw;

    const parent = stack.length > 0 ? stack[stack.length - 1]! : null;
    const inClass = parent != null && (parent.kind === SymbolKind.Class || parent.kind === SymbolKind.Struct || parent.kind === SymbolKind.Interface);

    let matched: MatchedHeader | null = null;
    if (isJs) matched = matchJsTs(clean, inClass);
    else if (isPy) matched = matchPython(raw, inClass);
    else if (isJava) matched = matchJava(clean, parent?.name ?? null);
    else if (isCpp) matched = matchCpp(clean, parent?.name ?? null);
    else if (isRust) matched = matchRust(clean);
    else if (isCss) matched = matchCss(raw);
    else if (isHtml) matched = blockEndByStartLine.has(ln) ? matchHtml(raw) : null;
    else if (isMd) matched = matchMarkdown(raw);
    else if (isShell) matched = matchShell(raw);
    else if (isJson) matched = matchJson(raw);

    if (!matched) continue;

    // Determine endLine: prefer block range starting on `ln` (or `ln + 1` for Allman-style `{` on next line)
    let endLine = blockEndByStartLine.get(ln);
    if (endLine === undefined && ln + 1 <= lineCount) {
      const nextTrim = model.getLineContent(ln + 1).trim();
      if (nextTrim.startsWith('{') && blockEndByStartLine.has(ln + 1)) {
        endLine = blockEndByStartLine.get(ln + 1);
      }
    }
    if (endLine === undefined) endLine = ln;

    const endCol = Math.max(1, model.getLineContent(endLine).length + 1);
    const sym: MutableSym = {
      name: matched.name,
      detail: matched.detail,
      kind: matched.kind,
      range: { startLineNumber: ln, startColumn: 1, endLineNumber: endLine, endColumn: endCol },
      selectionRange: makeSelectionRange(ln, raw, matched.name),
      children: [],
    };

    if (parent) parent.children.push(sym);
    else roots.push(sym);

    if (endLine > ln) {
      stack.push(sym);
    }
  }

  return roots;
}
