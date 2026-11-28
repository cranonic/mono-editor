import { describe, it, expect } from 'bun:test';
import {
  htmlEmmetSuggestions,
  htmlLocationAt,
  HTML_EMMET_TRIGGER_CHARACTERS,
} from '../src/core/services/lsp/providers/htmlEmmet';

/** `|` marks the caret. Returns Emmet suggestions the way completion.ts asks for them. */
function at(src: string) {
  const offset = src.indexOf('|');
  const text = src.replace('|', '');
  const loc = htmlLocationAt(text, offset);
  const line = text.slice(text.lastIndexOf('\n', offset - 1) + 1).split('\n')[0]!;
  const col = offset - (text.lastIndexOf('\n', offset - 1) + 1) + 1;
  return { loc, items: htmlEmmetSuggestions(line, col, loc) };
}

describe('htmlLocationAt', () => {
  it('classifies caret positions', () => {
    expect(at('<p>|</p>').loc).toBe('text');
    expect(at('<p |>').loc).toBe('tag');
    expect(at('<p id|>').loc).toBe('tag');
    expect(at('<p id="a|">').loc).toBe('attr-value');
    expect(at('<!-- x| -->').loc).toBe('comment');
    expect(at('<script>var a|</script>').loc).toBe('script');
    expect(at('<style>a{}|</style>').loc).toBe('style');
    expect(at('<script>1</script><p>|').loc).toBe('text');
    expect(at('a < b|').loc).toBe('text');
  });
});

describe('htmlEmmetSuggestions (VS Code parity)', () => {
  it('`!` offers the html:5 boilerplate', () => {
    const { items } = at('!|');
    expect(items.length).toBeGreaterThan(0);
    expect(items.some((i) => i.insertText.includes('<!DOCTYPE html>'))).toBe(true);
  });
  it('`div.` expands to a class div', () => {
    const { items } = at('div.|');
    expect(items[0]!.insertText).toContain('<div class="');
  });
  it('`p#foo` and `div#pokemon` give id expansions', () => {
    expect(at('p#foo|').items[0]!.insertText).toContain('<p id="foo">');
    expect(at('div#pokemon|').items[0]!.insertText).toContain('<div id="pokemon">');
  });
  it('`div#` keeps an id tab stop instead of a bare div', () => {
    expect(at('div#|').items[0]!.insertText).toContain('id="');
  });
  it('`ul>li*3` expands', () => {
    expect(at('ul>li*3|').items[0]!.insertText).toContain('<li');
  });
  it('nothing inside tags, attribute values, comments, script, style', () => {
    for (const s of ['<p id|>', '<p id="a|">', '<!-- div| -->', '<script>div|</script>', '<style>div|</style>']) {
      expect(at(s).items).toEqual([]);
    }
  });
  it('nothing for `>`, spaces and empty text', () => {
    expect(at('<p>hello |</p>').items).toEqual([]);
    expect(at('<p>|</p>').items).toEqual([]);
    expect(at('>|').items).toEqual([]);
    expect(at('   |').items).toEqual([]);
  });
  it('trigger characters match VS Code', () => {
    expect([...HTML_EMMET_TRIGGER_CHARACTERS].sort()).toEqual(['!', '$', '*', '+', '.', '/', ':', '>', ']', '}'].sort());
  });
});
