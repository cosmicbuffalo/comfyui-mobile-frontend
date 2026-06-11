import { describe, expect, it } from 'vitest';
import { connectionButtonDomId } from '../connectionFlash';

describe('connectionButtonDomId', () => {
  it('builds a stable id from node, direction, and slot', () => {
    expect(connectionButtonDomId(5, 'output', 2)).toBe('connection-button-5-output-2');
    expect(connectionButtonDomId(12, 'input', 0)).toBe('connection-button-12-input-0');
  });
});
