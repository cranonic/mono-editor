import { createRegexTokensProvider } from '../tokenization/createRegexTokensProvider';
import type { MonoTokensProvider } from '../tokenization/TokensProvider';

const SHELL_KEYWORDS = [
  'if', 'then', 'else', 'elif', 'fi', 'for', 'in', 'do', 'done', 'while',
  'until', 'case', 'esac', 'select', 'function', 'return', 'exit', 'break',
  'continue', 'local', 'export', 'readonly', 'declare', 'typeset', 'unset',
  'shift', 'source', 'eval', 'exec', 'trap', 'set', 'echo', 'printf', 'read',
  'test', 'true', 'false', 'cd', 'pwd', 'ls', 'grep', 'sed', 'awk', 'find',
  'curl', 'chmod', 'mkdir', 'rm', 'cp', 'mv', 'cat', 'git', 'npm', 'npx', 'node',
];

export function createShellTokensProvider(languageId = 'shell'): MonoTokensProvider {
  return createRegexTokensProvider({
    languageId,
    keywords: SHELL_KEYWORDS,
    initialState: 0,
    rules: [
      // shebang
      { pattern: /^#!.*$/, type: 'attribute' },
      // comments
      { pattern: /#.*/, type: 'comment' },
      // strings
      { pattern: /"(?:\\.|[^"\\])*"/, type: 'string' },
      { pattern: /'[^']*'/, type: 'string' },
      { pattern: /`(?:\\.|[^`\\])*`/, type: 'string' },
      // variables ($VAR, ${VAR}, $1, $@, $?)
      { pattern: /\$\{[^}]+\}/, type: 'variable' },
      { pattern: /\$[A-Za-z_]\w*|\$[0-9@#?$!*_-]/, type: 'variable' },
      // flags (--flag, -f)
      { pattern: /--?[A-Za-z0-9_-]+/, type: 'attribute' },
      // numbers
      { pattern: /\b\d+(?:\.\d+)?\b/, type: 'number' },
      // redirections and pipes
      { pattern: /&&|\|\||;;|<<-?|>>|[|&<>!=]=?/, type: 'operator' },
    ],
  });
}
