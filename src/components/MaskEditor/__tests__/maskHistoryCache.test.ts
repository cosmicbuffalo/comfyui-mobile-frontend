import { beforeEach, describe, expect, it } from 'vitest';
import type { ImageRef } from '@/utils/maskEditor/clipspace';
import type { HistoryEntry } from '../maskCanvasEngine';
import type { NodeTypes, Workflow, WorkflowNode } from '@/api/types';
import { formatImageWidgetValue } from '@/utils/maskEditor/clipspace';
import { resolveLoadImagePreview } from '@/utils/loadImagePreview';
import {
  clearMaskHistory,
  lineageForRef,
  maskRefKey,
  peekMaskHistory,
  retainMaskHistory,
} from '../maskHistoryCache';

/** Entries are opaque to the cache, so a marker object is enough. */
function entries(...tags: string[]): HistoryEntry[] {
  return tags.map((tag) => ({ mask: tag, paint: tag } as unknown as HistoryEntry));
}

const original: ImageRef = { filename: 'photo.png', subfolder: '', type: 'input' };
const firstSave: ImageRef = {
  filename: 'clipspace-painted-masked-1.png', subfolder: 'clipspace', type: 'input',
};
const secondSave: ImageRef = {
  filename: 'clipspace-painted-masked-2.png', subfolder: 'clipspace', type: 'input',
};

beforeEach(() => clearMaskHistory());

describe('lineageForRef', () => {
  it('is the ref itself until a save claims it', () => {
    expect(lineageForRef(original)).toBe(maskRefKey(original));
  });

  it('follows a save to the file it produced', () => {
    // Each save writes a new timestamped file, so without this the next opening
    // would look like a different image entirely.
    retainMaskHistory({
      lineage: maskRefKey(original), savedRef: firstSave,
      width: 10, height: 10, entries: entries('a'), index: 0,
    });
    expect(lineageForRef(firstSave)).toBe(maskRefKey(original));
  });

  it('chains across repeated saves back to the original', () => {
    const root = maskRefKey(original);
    retainMaskHistory({
      lineage: root, savedRef: firstSave, width: 10, height: 10, entries: entries('a'), index: 0,
    });
    retainMaskHistory({
      lineage: lineageForRef(firstSave), savedRef: secondSave,
      width: 10, height: 10, entries: entries('a', 'b'), index: 1,
    });
    expect(lineageForRef(secondSave)).toBe(root);
  });

  it('keeps unrelated images apart', () => {
    const other: ImageRef = { filename: 'other.png', subfolder: '', type: 'input' };
    expect(lineageForRef(other)).not.toBe(lineageForRef(original));
  });

  it('distinguishes the same filename in different folders', () => {
    expect(maskRefKey({ filename: 'a.png', subfolder: 'x', type: 'input' }))
      .not.toBe(maskRefKey({ filename: 'a.png', subfolder: 'y', type: 'input' }));
  });
});

describe('peekMaskHistory', () => {
  const root = maskRefKey(original);

  function retain(index = 1) {
    retainMaskHistory({
      lineage: root, savedRef: firstSave,
      width: 100, height: 50, entries: entries('base', 'painted'), index,
    });
  }

  it('returns the retained history for the same lineage', () => {
    retain();
    const found = peekMaskHistory(root, 100, 50);
    expect(found?.entries).toHaveLength(2);
    expect(found?.index).toBe(1);
  });

  it('is reachable through the file the save produced', () => {
    // This is the whole point: reopening the node loads the SAVED file, not the
    // original, and must still find the history.
    retain();
    expect(peekMaskHistory(lineageForRef(firstSave), 100, 50)).not.toBeNull();
  });

  it('does not consume the history', () => {
    // Opening and closing without saving must leave the last save's history
    // intact for the opening after that.
    retain();
    expect(peekMaskHistory(root, 100, 50)).not.toBeNull();
    expect(peekMaskHistory(root, 100, 50)).not.toBeNull();
  });

  it('refuses a different lineage', () => {
    retain();
    expect(peekMaskHistory('input:/other.png', 100, 50)).toBeNull();
  });

  it('refuses a size mismatch', () => {
    // putImageData would throw, and the entries describe a canvas that is gone.
    retain();
    expect(peekMaskHistory(root, 100, 51)).toBeNull();
    expect(peekMaskHistory(root, 99, 50)).toBeNull();
  });

  it('drops the previous lineage when another image is retained', () => {
    // Only one lineage is held at a time; entries are full-resolution buffers.
    retain();
    retainMaskHistory({
      lineage: 'input:/other.png', savedRef: secondSave,
      width: 100, height: 50, entries: entries('x'), index: 0,
    });
    expect(peekMaskHistory(root, 100, 50)).toBeNull();
    expect(peekMaskHistory('input:/other.png', 100, 50)).not.toBeNull();
  });
});


/**
 * The full production chain, which is where this actually broke.
 *
 * Save writes a ref with a bare filename; the widget stores it annotated
 * (`clipspace/x.png [input]`); reopening parses that widget value back into a
 * ref. Every module in that loop was individually correct, but the parse kept
 * " [input]" glued to the filename, so the reopened ref was a different string
 * from the one the save had recorded and the history was never found.
 */
describe('save -> widget value -> reopen lineage (regression)', () => {
  const NODE_TYPES = {
    LoadImage: { input: { required: { image: [['photo.png']] } }, output: ['IMAGE', 'MASK'] },
  } as unknown as NodeTypes;

  function refFromWidgetValue(value: string): ImageRef {
    const node = {
      id: 1, type: 'LoadImage', pos: [0, 0], size: [1, 1], flags: {}, order: 0, mode: 0,
      inputs: [], outputs: [], properties: {}, widgets_values: [value, 'image'],
    } as unknown as WorkflowNode;
    const workflow = { nodes: [node], links: [], groups: [] } as unknown as Workflow;
    const preview = resolveLoadImagePreview(workflow, NODE_TYPES, node)!;
    return { filename: preview.filename, subfolder: preview.subfolder, type: preview.type };
  }

  beforeEach(() => clearMaskHistory());

  it('finds the history after a save, through the widget value', () => {
    const opened = refFromWidgetValue('photo.png');
    const lineage = lineageForRef(opened);

    const saved: ImageRef = {
      filename: 'clipspace-painted-masked-42.png', subfolder: 'clipspace', type: 'input',
    };
    retainMaskHistory({
      lineage, savedRef: saved, width: 64, height: 64, entries: entries('base', 'edit'), index: 1,
    });

    // What the node's widget now holds, and what the next opening parses.
    const widgetValue = formatImageWidgetValue(saved);
    expect(widgetValue).toBe('clipspace/clipspace-painted-masked-42.png [input]');

    const reopened = refFromWidgetValue(widgetValue);
    expect(lineageForRef(reopened)).toBe(lineage);
    expect(peekMaskHistory(lineageForRef(reopened), 64, 64)?.entries).toHaveLength(2);
  });

  it('survives a second save on top of the first', () => {
    const lineage = lineageForRef(refFromWidgetValue('photo.png'));
    const first: ImageRef = {
      filename: 'clipspace-painted-masked-1.png', subfolder: 'clipspace', type: 'input',
    };
    retainMaskHistory({
      lineage, savedRef: first, width: 64, height: 64, entries: entries('a', 'b'), index: 1,
    });

    const reopened = refFromWidgetValue(formatImageWidgetValue(first));
    const second: ImageRef = {
      filename: 'clipspace-painted-masked-2.png', subfolder: 'clipspace', type: 'input',
    };
    retainMaskHistory({
      lineage: lineageForRef(reopened), savedRef: second,
      width: 64, height: 64, entries: entries('a', 'b', 'c'), index: 2,
    });

    const again = refFromWidgetValue(formatImageWidgetValue(second));
    expect(lineageForRef(again)).toBe(lineage);
    expect(peekMaskHistory(lineageForRef(again), 64, 64)?.entries).toHaveLength(3);
  });
});
