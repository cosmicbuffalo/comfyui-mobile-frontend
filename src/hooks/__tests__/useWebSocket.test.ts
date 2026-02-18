import { describe, expect, it } from 'vitest';
import { extractTextPreviewFromOutput } from '../useWebSocket';

describe('extractTextPreviewFromOutput', () => {
  it('extracts text from explicit text-like fields', () => {
    expect(
      extractTextPreviewFromOutput({
        result: [{ text: 'hello world' }],
      })
    ).toBe('hello world');
  });

  it('does not treat media filenames as text preview', () => {
    expect(
      extractTextPreviewFromOutput({
        images: [{ filename: 'preview.png', subfolder: 'temp', type: 'temp' }],
      })
    ).toBeNull();
  });

  it('prefers text when both media and text payloads exist', () => {
    expect(
      extractTextPreviewFromOutput({
        images: [{ filename: 'preview.png', subfolder: 'temp', type: 'temp' }],
        text: ['real preview text'],
      })
    ).toBe('real preview text');
  });
});
