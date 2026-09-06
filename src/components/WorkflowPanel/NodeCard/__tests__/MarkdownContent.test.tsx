import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { MarkdownContent } from '../MarkdownContent';

describe('MarkdownContent', () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(async () => {
    await act(async () => root.unmount());
    container.remove();
  });

  const render = async (text: string) => {
    await act(async () => {
      root.render(<MarkdownContent text={text} />);
    });
  };

  it('renders headings, emphasis and lists as real elements', async () => {
    await render('# Setup\n\nUse the **big** model.\n\n- first\n- second');

    const heading = container.querySelector('h1');
    expect(heading?.textContent).toBe('Setup');
    expect(container.querySelector('strong')?.textContent).toBe('big');

    const items = container.querySelectorAll('ul > li');
    expect(items).toHaveLength(2);
    expect(items[0].textContent).toBe('first');

    // The raw syntax must not survive into the rendered output.
    expect(container.textContent).not.toContain('**');
    expect(container.textContent).not.toContain('# Setup');
  });

  it('renders fenced code blocks with their content untouched', async () => {
    await render('```json\n{"a": *1*}\n```');

    const code = container.querySelector('pre code');
    expect(code?.textContent).toBe('{"a": *1*}');
    expect(container.querySelector('pre')?.getAttribute('data-lang')).toBe('json');
  });

  it('renders links that open in a new tab', async () => {
    await render('[docs](https://example.com/guide)');

    const link = container.querySelector('a');
    expect(link?.getAttribute('href')).toBe('https://example.com/guide');
    expect(link?.getAttribute('target')).toBe('_blank');
    expect(link?.textContent).toBe('docs');
  });

  it('renders a table with aligned cells', async () => {
    await render('| name | size |\n| --- | ---: |\n| sd15 | 4 GB |');

    expect(container.querySelectorAll('th')).toHaveLength(2);
    const cells = container.querySelectorAll('tbody td');
    expect(cells[0].textContent).toBe('sd15');
    expect((cells[1] as HTMLElement).style.textAlign).toBe('right');
  });

  it('never renders an unsafe link target as a link', async () => {
    await render('[click](javascript:alert(1))');

    expect(container.querySelector('a')).toBeNull();
    expect(container.textContent).toContain('click');
  });

  it('keeps blank-line-separated paragraphs apart and single newlines as breaks', async () => {
    await render('one\ntwo\n\nthree');

    const paragraphs = container.querySelectorAll('p');
    expect(paragraphs).toHaveLength(2);
    expect(paragraphs[0].querySelectorAll('br')).toHaveLength(1);
    expect(paragraphs[1].textContent).toBe('three');
  });
});
