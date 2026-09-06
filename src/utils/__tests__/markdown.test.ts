import { describe, it, expect } from 'vitest';
import { parseMarkdown, parseInline, type MdBlock, type MdInline } from '../markdown';

/** Flattens a token tree back to its visible text, for concise assertions. */
function textOf(nodes: MdInline[]): string {
  return nodes
    .map((node) => {
      switch (node.type) {
        case 'text':
        case 'codeSpan':
          return node.value;
        case 'image':
          return node.alt;
        case 'break':
          return '\n';
        default:
          return textOf(node.children);
      }
    })
    .join('');
}

describe('parseMarkdown blocks', () => {
  it('parses ATX headings with their level', () => {
    const blocks = parseMarkdown('# Title\n\n### Sub');
    expect(blocks).toHaveLength(2);
    expect(blocks[0]).toMatchObject({ type: 'heading', level: 1 });
    expect(textOf((blocks[0] as Extract<MdBlock, { type: 'heading' }>).children)).toBe('Title');
    expect(blocks[1]).toMatchObject({ type: 'heading', level: 3 });
  });

  it('keeps single newlines inside a paragraph as hard breaks', () => {
    const blocks = parseMarkdown('line one\nline two');
    expect(blocks).toHaveLength(1);
    const paragraph = blocks[0] as Extract<MdBlock, { type: 'paragraph' }>;
    expect(paragraph.children.some((child) => child.type === 'break')).toBe(true);
    expect(textOf(paragraph.children)).toBe('line one\nline two');
  });

  it('parses fenced code blocks verbatim, with the language tag', () => {
    const blocks = parseMarkdown('```python\nprint("*hi*")\n\nx = 1\n```');
    expect(blocks).toEqual([
      { type: 'codeBlock', lang: 'python', value: 'print("*hi*")\n\nx = 1' },
    ]);
  });

  it('closes an unterminated fence at the end of the note', () => {
    const blocks = parseMarkdown('```\nunclosed');
    expect(blocks).toEqual([{ type: 'codeBlock', lang: null, value: 'unclosed' }]);
  });

  it('parses bullet and ordered lists', () => {
    const bullets = parseMarkdown('- one\n- two') as Extract<MdBlock, { type: 'list' }>[];
    expect(bullets[0]).toMatchObject({ type: 'list', ordered: false, loose: false });
    expect(bullets[0].items).toHaveLength(2);

    const ordered = parseMarkdown('3. three\n4. four') as Extract<MdBlock, { type: 'list' }>[];
    expect(ordered[0]).toMatchObject({ type: 'list', ordered: true, start: 3 });
    expect(ordered[0].items).toHaveLength(2);
  });

  it('nests indented list items under their parent', () => {
    const [list] = parseMarkdown('- outer\n  - inner\n- second') as Extract<MdBlock, { type: 'list' }>[];
    expect(list.items).toHaveLength(2);
    const [paragraph, nested] = list.items[0];
    expect(textOf((paragraph as Extract<MdBlock, { type: 'paragraph' }>).children)).toBe('outer');
    expect(nested).toMatchObject({ type: 'list', ordered: false });
    expect((nested as Extract<MdBlock, { type: 'list' }>).items).toHaveLength(1);
  });

  it('marks a list loose when its items are separated by blank lines', () => {
    const [list] = parseMarkdown('- one\n\n- two') as Extract<MdBlock, { type: 'list' }>[];
    expect(list).toMatchObject({ type: 'list', loose: true });
    expect(list.items).toHaveLength(2);
  });

  it('parses blockquotes as nested blocks', () => {
    const [quote] = parseMarkdown('> quoted **text**') as Extract<MdBlock, { type: 'blockquote' }>[];
    expect(quote.type).toBe('blockquote');
    expect(quote.children[0].type).toBe('paragraph');
  });

  it('parses thematic breaks', () => {
    expect(parseMarkdown('---')).toEqual([{ type: 'thematicBreak' }]);
    expect(parseMarkdown('***')).toEqual([{ type: 'thematicBreak' }]);
  });

  it('parses GFM tables with column alignment', () => {
    const [table] = parseMarkdown(
      '| a | b |\n| :-- | --: |\n| 1 | 2 |'
    ) as Extract<MdBlock, { type: 'table' }>[];
    expect(table.type).toBe('table');
    expect(table.align).toEqual(['left', 'right']);
    expect(table.header.map(textOf)).toEqual(['a', 'b']);
    expect(table.rows).toHaveLength(1);
    expect(table.rows[0].map(textOf)).toEqual(['1', '2']);
  });

  it('leaves a lone pipe line as a paragraph', () => {
    const blocks = parseMarkdown('a | b');
    expect(blocks[0].type).toBe('paragraph');
  });
});

describe('parseInline', () => {
  it('parses bold, italic and strikethrough', () => {
    expect(parseInline('**b**')[0]).toMatchObject({ type: 'strong' });
    expect(parseInline('*i*')[0]).toMatchObject({ type: 'em' });
    expect(parseInline('_i_')[0]).toMatchObject({ type: 'em' });
    expect(parseInline('~~s~~')[0]).toMatchObject({ type: 'del' });
    expect(parseInline('***bi***')[0]).toMatchObject({
      type: 'strong',
      children: [{ type: 'em' }],
    });
  });

  it('pairs nested emphasis instead of closing on the inner marker', () => {
    const nodes = parseInline('*optional, needed when **prompt_enhance** is on*');
    expect(nodes).toHaveLength(1);
    expect(nodes[0]).toMatchObject({ type: 'em' });
    const inner = (nodes[0] as Extract<MdInline, { type: 'em' }>).children;
    expect(inner.some((child) => child.type === 'strong')).toBe(true);
    expect(textOf(nodes)).toBe('optional, needed when prompt_enhance is on');
  });

  it('ignores emphasis markers that only appear inside code spans', () => {
    const nodes = parseInline('**`a*b`**');
    expect(nodes[0]).toMatchObject({ type: 'strong' });
    expect(textOf(nodes)).toBe('a*b');
  });

  it('renders a bare <br> as a line break', () => {
    const nodes = parseInline('one<br>two');
    expect(nodes.some((node) => node.type === 'break')).toBe(true);
    expect(textOf(nodes)).toBe('one\ntwo');
  });

  it('collapses a <br> and the newline right after it into one break', () => {
    const nodes = parseInline('one<br>\ntwo');
    expect(nodes.filter((node) => node.type === 'break')).toHaveLength(1);
    expect(textOf(nodes)).toBe('one\ntwo');
  });

  it('leaves non-<br> angle-bracket text literal', () => {
    expect(textOf(parseInline('describe <the scene> here'))).toBe('describe <the scene> here');
  });

  it('does not treat underscores inside a word as emphasis', () => {
    expect(textOf(parseInline('ckpt_name_here'))).toBe('ckpt_name_here');
    expect(parseInline('ckpt_name_here').every((node) => node.type === 'text')).toBe(true);
  });

  it('parses inline code without interpreting markup inside it', () => {
    expect(parseInline('`a *b* c`')).toEqual([{ type: 'codeSpan', value: 'a *b* c' }]);
  });

  it('parses inline links and keeps bare URLs clickable', () => {
    expect(parseInline('[docs](https://example.com/a)')[0]).toMatchObject({
      type: 'link',
      href: 'https://example.com/a',
    });
    const bare = parseInline('see https://example.com/a. done');
    const link = bare.find((node) => node.type === 'link');
    expect(link).toMatchObject({ type: 'link', href: 'https://example.com/a' });
    expect(textOf(bare)).toBe('see https://example.com/a. done');
  });

  it('parses images with an allowed source', () => {
    expect(parseInline('![alt](https://example.com/a.png)')[0]).toMatchObject({
      type: 'image',
      src: 'https://example.com/a.png',
      alt: 'alt',
    });
  });

  it('drops javascript: and other unsafe URLs, keeping the label as text', () => {
    const link = parseInline('[click](javascript:alert(1))');
    expect(link.every((node) => node.type !== 'link')).toBe(true);
    expect(textOf(link)).toBe('click');

    const image = parseInline('![x](javascript:alert(1))');
    expect(image.every((node) => node.type !== 'image')).toBe(true);
  });

  it('honours backslash escapes', () => {
    expect(textOf(parseInline('\\*not italic\\*'))).toBe('*not italic*');
    expect(parseInline('\\*not italic\\*').every((node) => node.type === 'text')).toBe(true);
  });

  it('leaves unmatched markers as literal text', () => {
    expect(textOf(parseInline('2 * 3 * 4'))).toBe('2 * 3 * 4');
    expect(textOf(parseInline('a ` b'))).toBe('a ` b');
  });
});
