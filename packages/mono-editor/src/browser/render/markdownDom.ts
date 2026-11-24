import { languages as tokenLanguages } from '../../common/languages/tokenization/TokensProvider';
import { DEFAULT_TOKEN_COLORS, type MonoTokenTheme } from '../../common/languages/tokenization/tokenTypes';
import { monoThemeService } from '../../platform/theme/ThemeService';
import type { ResolvedWidgetTheme } from '../../platform/theme/widgetTheme';

const SAFE_URL_RE = /^https?:\/\//i;

const LANG_ALIASES: Record<string, string> = {
  js: 'javascript',
  jsx: 'javascript',
  mjs: 'javascript',
  ts: 'typescript',
  tsx: 'typescript',
  py: 'python',
  sh: 'shell',
  bash: 'shell',
  zsh: 'shell',
  yml: 'yaml',
  md: 'markdown',
  'c++': 'cpp',
  cc: 'cpp',
  c: 'cpp',
  htm: 'html',
};

/**
 * Safely renders syntax-highlighted code lines into `target` using Mono's active
 * tokenizer and theme colors (zero `innerHTML`).
 */
export function renderHighlightedCodeToDom(
  target: HTMLElement,
  codeText: string,
  languageHint?: string,
  fallbackForeground?: string,
  tokenColorsOverride?: MonoTokenTheme,
): void {
  const normLang = languageHint ? (LANG_ALIASES[languageHint.toLowerCase()] ?? languageHint.toLowerCase()) : '';
  const provider = normLang ? tokenLanguages.getTokensProvider(normLang) : undefined;
  let tokenColors: Record<string, string | undefined> = { ...DEFAULT_TOKEN_COLORS };
  try {
    tokenColors = { ...tokenColors, ...(monoThemeService.resolve().tokenColors ?? {}) };
  } catch {
    /* fallback to default token colors */
  }
  if (tokenColorsOverride) {
    tokenColors = { ...tokenColors, ...tokenColorsOverride };
  }

  const lines = codeText.replace(/\r\n/g, '\n').split('\n');
  let state = provider?.getInitialState();

  lines.forEach((line, lineIdx) => {
    if (lineIdx > 0) target.appendChild(document.createTextNode('\n'));
    if (!provider || !line.length) {
      if (line.length) target.appendChild(document.createTextNode(line));
      return;
    }
    const res = provider.tokenizeLine(line, state);
    state = res.endState;
    if (!res.tokens.length) {
      target.appendChild(document.createTextNode(line));
      return;
    }
    let col = 1;
    for (const tok of res.tokens) {
      if (tok.startColumn > col) {
        target.appendChild(document.createTextNode(line.slice(col - 1, tok.startColumn - 1)));
      }
      const slice = line.slice(tok.startColumn - 1, tok.endColumn - 1);
      if (slice) {
        const span = document.createElement('span');
        span.textContent = slice;
        const color = tokenColors[tok.type];
        if (color) span.style.color = color;
        else if (fallbackForeground) span.style.color = fallbackForeground;
        target.appendChild(span);
      }
      col = Math.max(col, tok.endColumn);
    }
    if (col <= line.length) {
      target.appendChild(document.createTextNode(line.slice(col - 1)));
    }
  });
}

function appendInlineMarkdown(
  parent: HTMLElement,
  text: string,
  theme: ResolvedWidgetTheme,
): void {
  // Match inline code (`...`), bold (**...**), italic (*...*), or links ([label](url))
  const tokenRe = /`([^`]+)`|\*\*([^*]+)\*\*|\*([^*]+)\*|\[([^\]]+)\]\(([^)]+)\)/g;
  let lastIndex = 0;
  let match: RegExpExecArray | null;

  while ((match = tokenRe.exec(text)) !== null) {
    if (match.index > lastIndex) {
      parent.appendChild(document.createTextNode(text.slice(lastIndex, match.index)));
    }
    if (match[1] !== undefined) {
      const code = document.createElement('code');
      code.textContent = match[1];
      Object.assign(code.style, {
        fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace',
        fontSize: '0.92em',
        padding: '1px 4px',
        borderRadius: '3px',
        background: theme.codeBackground,
        color: theme.foreground,
      });
      parent.appendChild(code);
    } else if (match[2] !== undefined) {
      const strong = document.createElement('strong');
      strong.textContent = match[2];
      strong.style.fontWeight = '600';
      parent.appendChild(strong);
    } else if (match[3] !== undefined) {
      const em = document.createElement('em');
      em.textContent = match[3];
      parent.appendChild(em);
    } else if (match[4] !== undefined && match[5] !== undefined) {
      const label = match[4];
      const href = match[5].trim();
      if (SAFE_URL_RE.test(href)) {
        const a = document.createElement('a');
        a.textContent = label;
        a.href = href;
        a.target = '_blank';
        a.rel = 'noopener noreferrer';
        a.style.color = theme.focusBorder;
        a.style.textDecoration = 'underline';
        parent.appendChild(a);
      } else {
        parent.appendChild(document.createTextNode(label));
      }
    }
    lastIndex = match.index + match[0].length;
  }

  if (lastIndex < text.length) {
    parent.appendChild(document.createTextNode(text.slice(lastIndex)));
  }
}

/**
 * Safely renders Markdown into DOM elements (zero `innerHTML` usage).
 * Supports syntax-highlighted fenced code blocks, headings, bullet lists, dividers,
 * inline code, bold/italic emphasis, and validated http(s) links.
 */
export function renderMarkdownToDom(
  container: HTMLElement,
  markdown: string,
  theme: ResolvedWidgetTheme,
  defaultCodeLang?: string,
): void {
  const lines = markdown.replace(/\r\n/g, '\n').split('\n');
  let i = 0;

  while (i < lines.length) {
    const line = lines[i]!;

    // Fenced code block ```lang ... ```
    const trimmedFence = line.trimStart();
    if (trimmedFence.startsWith('```')) {
      const langHint = trimmedFence.slice(3).trim().split(/\s+/)[0] || defaultCodeLang;
      const codeLines: string[] = [];
      i++;
      while (i < lines.length && !lines[i]!.trimStart().startsWith('```')) {
        codeLines.push(lines[i]!);
        i++;
      }
      i++; // consume closing fence
      const pre = document.createElement('pre');
      Object.assign(pre.style, {
        margin: '4px 0',
        padding: '6px 8px',
        borderRadius: '4px',
        background: theme.codeBackground,
        border: `1px solid ${theme.border}`,
        overflowX: 'auto',
        fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace',
        fontSize: '12px',
        lineHeight: '1.45',
        color: theme.foreground,
        whiteSpace: 'pre',
      });
      const code = document.createElement('code');
      renderHighlightedCodeToDom(code, codeLines.join('\n'), langHint, theme.foreground);
      pre.appendChild(code);
      container.appendChild(pre);
      continue;
    }

    // Horizontal rule
    if (/^\s*([-*_])\1\1+\s*$/.test(line)) {
      const hr = document.createElement('hr');
      Object.assign(hr.style, {
        border: 'none',
        borderTop: `1px solid ${theme.border}`,
        margin: '6px 0',
      });
      container.appendChild(hr);
      i++;
      continue;
    }

    // Heading (#, ##, ###)
    const heading = /^(#{1,3})\s+(.+)$/.exec(line.trim());
    if (heading) {
      const level = heading[1]!.length;
      const h = document.createElement('div');
      Object.assign(h.style, {
        fontWeight: '600',
        fontSize: level === 1 ? '14px' : level === 2 ? '13px' : '12px',
        margin: '4px 0 2px',
        color: theme.foreground,
      });
      appendInlineMarkdown(h, heading[2]!, theme);
      container.appendChild(h);
      i++;
      continue;
    }

    // Bullet list
    if (/^\s*[-*]\s+/.test(line)) {
      const ul = document.createElement('ul');
      Object.assign(ul.style, {
        margin: '3px 0',
        paddingLeft: '16px',
      });
      while (i < lines.length && /^\s*[-*]\s+/.test(lines[i]!)) {
        const li = document.createElement('li');
        li.style.margin = '2px 0';
        appendInlineMarkdown(li, lines[i]!.replace(/^\s*[-*]\s+/, ''), theme);
        ul.appendChild(li);
        i++;
      }
      container.appendChild(ul);
      continue;
    }

    // Blank line
    if (!line.trim()) {
      i++;
      continue;
    }

    // Paragraph (join consecutive plain lines)
    const paraLines: string[] = [];
    while (
      i < lines.length &&
      lines[i]!.trim() !== '' &&
      !lines[i]!.trimStart().startsWith('```') &&
      !/^(#{1,3})\s+/.test(lines[i]!.trim()) &&
      !/^\s*[-*]\s+/.test(lines[i]!) &&
      !/^\s*([-*_])\1\1+\s*$/.test(lines[i]!)
    ) {
      paraLines.push(lines[i]!);
      i++;
    }
    const p = document.createElement('div');
    Object.assign(p.style, {
      margin: '3px 0',
      lineHeight: '1.45',
    });
    appendInlineMarkdown(p, paraLines.join(' '), theme);
    container.appendChild(p);
  }
}
