import type { MonoTokensProvider } from '../tokenization/TokensProvider';

export function createPlaintextTokensProvider(): MonoTokensProvider {
  return {
    languageId: 'plaintext',
    getInitialState: () => 0,
    tokenizeLine() {
      return { tokens: [], endState: 0 };
    },
  };
}
