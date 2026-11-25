import type { ILanguageExtensionPoint, LanguageConfiguration } from './languageConfigurationTypes';
import { JS_TS_CONFIG } from './configurations/javascript';
import { JSON_CONFIG } from './configurations/json';
import { CSS_CONFIG } from './configurations/css';
import { HTML_CONFIG } from './configurations/html';
import { JAVA_CONFIG } from './configurations/java';
import { PYTHON_CONFIG } from './configurations/python';
import { MARKDOWN_CONFIG } from './configurations/markdown';
import { YAML_CONFIG } from './configurations/yaml';
import { SHELL_CONFIG } from './configurations/shell';
import { SQL_CONFIG } from './configurations/sql';
import { C_CPP_CONFIG } from './configurations/cpp';
import { PLAINTEXT_CONFIG } from './configurations/plaintext';

const extensionPoints = new Map<string, ILanguageExtensionPoint>();
const aliasToCanonical = new Map<string, string>();
const configs = new Map<string, LanguageConfiguration>();
let defaultsRegistered = false;

function norm(id: string): string {
  return (id || '').trim().toLowerCase();
}

export function registerLanguage(language: ILanguageExtensionPoint): void {
  const key = norm(language.id);
  if (!key) return;
  extensionPoints.set(key, { ...language, id: key });
  if (language.aliases) {
    for (const a of language.aliases) {
      const ak = norm(a);
      if (ak && ak !== key) aliasToCanonical.set(ak, key);
    }
  }
}

export function getLanguages(): ILanguageExtensionPoint[] {
  return [...extensionPoints.values()].map((l) => ({
    ...l,
    extensions: l.extensions ? [...l.extensions] : undefined,
    filenames: l.filenames ? [...l.filenames] : undefined,
    aliases: l.aliases ? [...l.aliases] : undefined,
    mimetypes: l.mimetypes ? [...l.mimetypes] : undefined,
  }));
}

export function setLanguageConfiguration(
  languageId: string,
  configuration: LanguageConfiguration,
): { dispose(): void } {
  const key = norm(languageId);
  configs.set(key, configuration);
  return {
    dispose: () => {
      if (configs.get(key) === configuration) configs.delete(key);
    },
  };
}

export function getLanguageConfiguration(languageId: string): LanguageConfiguration | undefined {
  const key = norm(languageId);
  const direct = configs.get(key);
  if (direct) return direct;
  const canonical = aliasToCanonical.get(key);
  if (canonical) return configs.get(canonical);
  return undefined;
}

export function clearLanguageConfigurations(): void {
  configs.clear();
  extensionPoints.clear();
  aliasToCanonical.clear();
  defaultsRegistered = false;
}

/**
 * Registers Monaco-compatible language extension points and LanguageConfigurations
 * for all 11 built-in language families (plus plaintext). Idempotent.
 */
export function registerDefaultLanguageConfigurations(): void {
  if (defaultsRegistered) return;
  defaultsRegistered = true;

  registerLanguage({ id: 'plaintext', extensions: ['.txt'], aliases: ['Plain Text', 'text'] });
  setLanguageConfiguration('plaintext', PLAINTEXT_CONFIG);

  registerLanguage({
    id: 'javascript',
    extensions: ['.js', '.mjs', '.cjs', '.jsx'],
    aliases: ['JavaScript', 'js', 'jsx'],
  });
  registerLanguage({
    id: 'typescript',
    extensions: ['.ts', '.mts', '.cts', '.tsx'],
    aliases: ['TypeScript', 'ts', 'tsx'],
  });
  setLanguageConfiguration('javascript', JS_TS_CONFIG);
  setLanguageConfiguration('typescript', JS_TS_CONFIG);

  registerLanguage({ id: 'json', extensions: ['.json', '.jsonc'], aliases: ['JSON', 'jsonc'] });
  setLanguageConfiguration('json', JSON_CONFIG);

  registerLanguage({ id: 'css', extensions: ['.css', '.scss', '.less'], aliases: ['CSS', 'scss', 'less'] });
  setLanguageConfiguration('css', CSS_CONFIG);

  registerLanguage({ id: 'html', extensions: ['.html', '.htm', '.xml'], aliases: ['HTML', 'htm', 'xml'] });
  setLanguageConfiguration('html', HTML_CONFIG);

  registerLanguage({ id: 'java', extensions: ['.java'], aliases: ['Java'] });
  setLanguageConfiguration('java', JAVA_CONFIG);

  registerLanguage({ id: 'python', extensions: ['.py', '.pyw'], aliases: ['Python', 'py'] });
  setLanguageConfiguration('python', PYTHON_CONFIG);

  registerLanguage({ id: 'markdown', extensions: ['.md', '.markdown'], aliases: ['Markdown', 'md'] });
  setLanguageConfiguration('markdown', MARKDOWN_CONFIG);

  registerLanguage({ id: 'yaml', extensions: ['.yaml', '.yml'], aliases: ['YAML', 'yml'] });
  setLanguageConfiguration('yaml', YAML_CONFIG);

  registerLanguage({
    id: 'shell',
    extensions: ['.sh', '.bash', '.zsh'],
    aliases: ['Shell', 'bash', 'sh', 'zsh', 'shellscript'],
  });
  setLanguageConfiguration('shell', SHELL_CONFIG);

  registerLanguage({ id: 'sql', extensions: ['.sql'], aliases: ['SQL'] });
  setLanguageConfiguration('sql', SQL_CONFIG);

  registerLanguage({ id: 'c', extensions: ['.c', '.h'], aliases: ['C'] });
  registerLanguage({
    id: 'cpp',
    extensions: ['.cpp', '.cc', '.cxx', '.hpp', '.hh', '.hxx'],
    aliases: ['C++', 'c++', 'cc', 'cxx'],
  });
  setLanguageConfiguration('c', C_CPP_CONFIG);
  setLanguageConfiguration('cpp', C_CPP_CONFIG);

  // Phase 8 extra built-in languages
  registerLanguage({ id: 'rust', extensions: ['.rs'], aliases: ['Rust', 'rs'] });
  setLanguageConfiguration('rust', C_CPP_CONFIG);

  registerLanguage({ id: 'go', extensions: ['.go'], aliases: ['Go', 'golang'] });
  setLanguageConfiguration('go', C_CPP_CONFIG);

  registerLanguage({ id: 'kotlin', extensions: ['.kt', '.kts'], aliases: ['Kotlin', 'kt'] });
  setLanguageConfiguration('kotlin', JAVA_CONFIG);

  registerLanguage({ id: 'swift', extensions: ['.swift'], aliases: ['Swift'] });
  setLanguageConfiguration('swift', JAVA_CONFIG);

  registerLanguage({ id: 'php', extensions: ['.php', '.phtml'], aliases: ['PHP'] });
  setLanguageConfiguration('php', JAVA_CONFIG);

  registerLanguage({ id: 'ruby', extensions: ['.rb', '.rake'], aliases: ['Ruby', 'rb'] });
  setLanguageConfiguration('ruby', PYTHON_CONFIG);

  registerLanguage({ id: 'xml', extensions: ['.xml', '.svg', '.plist'], aliases: ['XML'] });
  setLanguageConfiguration('xml', HTML_CONFIG);

  registerLanguage({ id: 'toml', extensions: ['.toml'], aliases: ['TOML'] });
  setLanguageConfiguration('toml', YAML_CONFIG);

  registerLanguage({
    id: 'dockerfile',
    extensions: ['.dockerfile'],
    filenames: ['Dockerfile'],
    aliases: ['Dockerfile', 'docker'],
  });
  setLanguageConfiguration('dockerfile', SHELL_CONFIG);
}
