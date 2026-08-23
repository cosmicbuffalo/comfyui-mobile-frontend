import { describe, expect, it } from 'vitest';
import { supportsPinnedWidgetEditor } from '../pinnedWidgetSupport';

describe('supportsPinnedWidgetEditor', () => {
  it.each(['STRING', 'INT', 'FLOAT', 'BOOLEAN', 'COMBO'])(
    'supports the standard %s control',
    (type) => expect(supportsPinnedWidgetEditor(type)).toBe(true),
  );

  it('supports custom V3 combo types with an option list', () => {
    expect(supportsPinnedWidgetEditor('CUSTOM_MODEL', { options: ['a', 'b'] })).toBe(true);
  });

  it('does not offer a pin for a custom control with no shared editor', () => {
    expect(supportsPinnedWidgetEditor('CUSTOM_COLOR', { default: '#ffffff' })).toBe(false);
  });
});
