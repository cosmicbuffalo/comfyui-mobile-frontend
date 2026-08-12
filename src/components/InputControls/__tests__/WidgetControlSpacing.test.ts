import { describe, expect, it } from 'vitest';
import { widgetControlHasTopPadding } from '@/components/InputControls/widgetControlSpacing';

describe('widgetControlHasTopPadding', () => {
  it.each(['STRING', 'INT', 'FLOAT', 'BOOLEAN', 'COMBO'])(
    'recognizes the standard %s control',
    (type) => expect(widgetControlHasTopPadding(type)).toBe(true),
  );

  it.each([
    'LM_LORA_HEADER',
    'LM_LORA',
    'LM_LORA_ADD',
    'TW_WORD',
    'POWER_LORA_HEADER',
    'POWER_LORA',
    'POWER_LORA_ADD',
  ])('does not classify the composite %s control as padded', (type) => {
    expect(widgetControlHasTopPadding(type)).toBe(false);
  });
});
