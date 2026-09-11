import { describe, expect, it } from 'vitest';
import { promptReferencesHiddenFile } from '@/utils/hiddenReferences';

const loadImage = (image: string) => ({
  class_type: 'LoadImage',
  inputs: { image, upload: 'image' },
});

describe('promptReferencesHiddenFile', () => {
  it('catches an input the user hid', () => {
    expect(promptReferencesHiddenFile(
      { '1': loadImage('portrait.png') },
      ['input/portrait.png'],
    )).toBe(true);
  });

  it('reads through the annotated-path suffix', () => {
    // `sub/pic.png [input]` names the input directory; the bracketed part is
    // not on disk, so a literal comparison against the stored id never matches.
    expect(promptReferencesHiddenFile(
      { '1': loadImage('refs/portrait.png [input]') },
      ['input/refs/portrait.png'],
    )).toBe(true);
  });

  it('inherits a mark from a hidden folder, the way the server does', () => {
    // Hiding a folder stores that one path — the files beneath it are hidden by
    // being beneath it and are never listed individually.
    expect(promptReferencesHiddenFile(
      { '1': loadImage('private/nested/portrait.png') },
      ['input/private'],
    )).toBe(true);
  });

  it('does not care which node holds the value', () => {
    // The point of not keying on node type: a hidden input reached through a
    // video loader, or a custom node this app has never heard of, still taints
    // the run. Matching LoadImage-shaped nodes would miss both.
    expect(promptReferencesHiddenFile(
      { '9': { class_type: 'VHS_LoadVideo', inputs: { video: 'private/clip.mp4' } } },
      ['input/private/clip.mp4'],
    )).toBe(true);
    expect(promptReferencesHiddenFile(
      { '9': { class_type: 'SomeVendorNode', inputs: { opts: { nested: { file: 'a/b.png' } } } } },
      ['input/a/b.png'],
    )).toBe(true);
  });

  it('leaves an ordinary run alone', () => {
    expect(promptReferencesHiddenFile(
      { '1': loadImage('holiday.png'), '2': { class_type: 'KSampler', inputs: { seed: 5 } } },
      ['input/private/portrait.png'],
    )).toBe(false);
  });

  it('does not match a partial path segment', () => {
    // `private-notes` is not inside `private`.
    expect(promptReferencesHiddenFile(
      { '1': loadImage('private-notes/a.png') },
      ['input/private'],
    )).toBe(false);
  });

  it('is a no-op when nothing is hidden, or the prompt is not one', () => {
    expect(promptReferencesHiddenFile({ '1': loadImage('a.png') }, [])).toBe(false);
    expect(promptReferencesHiddenFile(null, ['input/a.png'])).toBe(false);
    expect(promptReferencesHiddenFile('nonsense', ['input/a.png'])).toBe(false);
  });

  it('taints a run that consumes a dot-hidden file, with no stored mark', () => {
    // Dot-prefixed paths are hidden structurally; the server never stores a
    // mark for them, so hiddenIds can't help. The reference alone decides.
    expect(promptReferencesHiddenFile(
      { '1': loadImage('.private/portrait.png') },
      [],
    )).toBe(true);
    expect(promptReferencesHiddenFile(
      { '1': loadImage('.hidden.png') },
      [],
    )).toBe(true);
  });

  it('does not read an ellipsis-leading prompt text as a dot-hidden path', () => {
    // The taint check walks every string, including free-text widgets. Text
    // that merely starts with dots must not hide the run.
    expect(promptReferencesHiddenFile(
      { '2': { class_type: 'CLIPTextEncode', inputs: { text: '...misty morning, soft light' } } },
      [],
    )).toBe(false);
    expect(promptReferencesHiddenFile(
      { '2': { class_type: 'CLIPTextEncode', inputs: { text: '.hidden thoughts' } } },
      [],
    )).toBe(false);
  });

  it('respects the source an annotation names', () => {
    // `[output]` says the output directory, so an identically-named hidden
    // INPUT is a different file and must not taint the run.
    expect(promptReferencesHiddenFile(
      { '1': loadImage('shared.png [output]') },
      ['input/shared.png'],
    )).toBe(false);
    expect(promptReferencesHiddenFile(
      { '1': loadImage('shared.png [output]') },
      ['output/shared.png'],
    )).toBe(true);
  });
});
