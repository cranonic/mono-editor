import { languages } from '../tokenization/TokensProvider';
import { registerDefaultLanguageConfigurations } from '../languageConfigurationRegistry';
import { createJavaScriptTokensProvider, createTypeScriptTokensProvider } from './javascript';
import { createJsonTokensProvider } from './json';
import { createCssTokensProvider } from './css';
import { createHtmlTokensProvider } from './html';
import { createPythonTokensProvider } from './python';
import { createPlaintextTokensProvider } from './plaintext';
import { createJavaTokensProvider } from './java';
import { createCppTokensProvider } from './cpp';
import { createMarkdownTokensProvider } from './markdown';
import { createYamlTokensProvider } from './yaml';
import { createShellTokensProvider } from './shell';
import { createSqlTokensProvider } from './sql';
import {
  createDockerfileTokensProvider,
  createGoTokensProvider,
  createKotlinTokensProvider,
  createPhpTokensProvider,
  createRubyTokensProvider,
  createRustTokensProvider,
  createSwiftTokensProvider,
  createTomlTokensProvider,
  createXmlTokensProvider,
} from './extraLanguages';

let registered = false;

/** Idempotent — call once at app boot or from createMonoEditor. */
export function registerDefaultLanguages(): void {
  registerDefaultLanguageConfigurations();
  if (registered) return;
  registered = true;
  languages.registerTokensProvider(createPlaintextTokensProvider());
  languages.registerTokensProvider(createJavaScriptTokensProvider('javascript'));
  languages.registerTokensProvider(createJavaScriptTokensProvider('js'));
  languages.registerTokensProvider(createTypeScriptTokensProvider());
  languages.registerTokensProvider(createJavaScriptTokensProvider('ts'));
  languages.registerTokensProvider(createJavaScriptTokensProvider('tsx'));
  languages.registerTokensProvider(createJavaScriptTokensProvider('jsx'));
  languages.registerTokensProvider(createJsonTokensProvider());
  languages.registerTokensProvider(createCssTokensProvider());
  languages.registerTokensProvider(createHtmlTokensProvider());
  languages.registerTokensProvider(createPythonTokensProvider());
  languages.registerTokensProvider(createPythonTokensProvider('py'));
  languages.registerTokensProvider(createJavaTokensProvider('java'));
  languages.registerTokensProvider(createCppTokensProvider('cpp'));
  languages.registerTokensProvider(createCppTokensProvider('c'));
  languages.registerTokensProvider(createCppTokensProvider('c++'));
  languages.registerTokensProvider(createMarkdownTokensProvider('markdown'));
  languages.registerTokensProvider(createMarkdownTokensProvider('md'));
  languages.registerTokensProvider(createYamlTokensProvider('yaml'));
  languages.registerTokensProvider(createYamlTokensProvider('yml'));
  languages.registerTokensProvider(createShellTokensProvider('shell'));
  languages.registerTokensProvider(createShellTokensProvider('bash'));
  languages.registerTokensProvider(createShellTokensProvider('sh'));
  languages.registerTokensProvider(createSqlTokensProvider('sql'));
  // Phase 8 extra languages
  languages.registerTokensProvider(createRustTokensProvider('rust'));
  languages.registerTokensProvider(createRustTokensProvider('rs'));
  languages.registerTokensProvider(createGoTokensProvider('go'));
  languages.registerTokensProvider(createGoTokensProvider('golang'));
  languages.registerTokensProvider(createKotlinTokensProvider('kotlin'));
  languages.registerTokensProvider(createKotlinTokensProvider('kt'));
  languages.registerTokensProvider(createSwiftTokensProvider('swift'));
  languages.registerTokensProvider(createPhpTokensProvider('php'));
  languages.registerTokensProvider(createRubyTokensProvider('ruby'));
  languages.registerTokensProvider(createRubyTokensProvider('rb'));
  languages.registerTokensProvider(createXmlTokensProvider('xml'));
  languages.registerTokensProvider(createTomlTokensProvider('toml'));
  languages.registerTokensProvider(createDockerfileTokensProvider('dockerfile'));
}
