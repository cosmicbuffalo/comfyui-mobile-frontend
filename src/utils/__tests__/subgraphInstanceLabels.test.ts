import { describe, expect, it } from 'vitest';
import { interpolateInstanceLabel } from '@/utils/subgraphInstanceLabels';

describe('interpolateInstanceLabel', () => {
  it('returns token-free templates unchanged', () => {
    expect(interpolateInstanceLabel('Prompt', 3)).toBe('Prompt');
    expect(interpolateInstanceLabel('Prompt', undefined)).toBe('Prompt');
  });

  it('substitutes the instance number for {n}', () => {
    expect(interpolateInstanceLabel('Prompt {n}', 2)).toBe('Prompt 2');
    expect(interpolateInstanceLabel('{n}. pass', 1)).toBe('1. pass');
  });

  it('substitutes every occurrence', () => {
    expect(interpolateInstanceLabel('{n} of {n}', 4)).toBe('4 of 4');
  });

  it('drops the token and its adjacent space when no number is assigned', () => {
    expect(interpolateInstanceLabel('Prompt {n}', undefined)).toBe('Prompt');
    expect(interpolateInstanceLabel('{n} Prompt', undefined)).toBe('Prompt');
    expect(interpolateInstanceLabel('Layer {n} seed', undefined)).toBe('Layer seed');
  });

  it('returns empty for a template that is only the token, so callers can fall back', () => {
    expect(interpolateInstanceLabel('{n}', undefined)).toBe('');
  });

  it('leaves other braces alone', () => {
    expect(interpolateInstanceLabel('{x} {n}', 5)).toBe('{x} 5');
  });
});

describe('the {n+1} token', () => {
  const render = (template: string, n?: number) => interpolateInstanceLabel(template, n);

  it('renders the number after this instance', () => {
    expect(render('Segment {n+1}', 1)).toBe('Segment 2');
    expect(render('Segment {n+1}', 11)).toBe('Segment 12');
  });

  it('ignores whitespace inside the braces', () => {
    // Nobody should have to remember which spacing the app wanted.
    expect(render('Segment {n + 1}', 1)).toBe('Segment 2');
    expect(render('Segment { n+1 }', 1)).toBe('Segment 2');
    expect(render('Segment { n }', 4)).toBe('Segment 4');
    expect(render('Segment {\tn\t}', 4)).toBe('Segment 4');
    // And still drops cleanly when there is no number to render.
    expect(render('Segment { n + 1 }', undefined)).toBe('Segment');
  });

  it('renders both tokens in one label', () => {
    expect(render('{n} to {n+1}', 2)).toBe('2 to 3');
  });

  it('drops with no instance number, like a bare token', () => {
    expect(render('Segment {n+1}', undefined)).toBe('Segment');
    expect(render('{n+1} Segment', undefined)).toBe('Segment');
    // Still separating two words.
    expect(render('A {n+1} B', undefined)).toBe('A B');
  });

  it('leaves anything else between braces exactly as written', () => {
    // A name is allowed to contain braces; only the two tokens are ours.
    expect(render('Segment {n+2}', 1)).toBe('Segment {n+2}');
    expect(render('Segment {2}', 1)).toBe('Segment {2}');
    expect(render('Config {json}', 1)).toBe('Config {json}');
    expect(render('Segment {}', 1)).toBe('Segment {}');
    expect(render('Segment {n+2}', undefined)).toBe('Segment {n+2}');
  });

  it('leaves a label with no braces untouched', () => {
    expect(render('Segment', 1)).toBe('Segment');
  });
});
