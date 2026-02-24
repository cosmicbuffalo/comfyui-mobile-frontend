import { describe, expect, it } from 'vitest';
import { resolveWorkflowColor, workflowColorPickerOptions } from '@/theme/colors';

describe('workflow color consistency', () => {
  it('uses ComfyUI palette hex values in picker options', () => {
    const byKey = Object.fromEntries(workflowColorPickerOptions.map((entry) => [entry.key, entry.color]));
    expect(byKey.red).toBe('#553333');
    expect(byKey.brown).toBe('#593930');
    expect(byKey.green).toBe('#335533');
    expect(byKey.blue).toBe('#333355');
    expect(byKey.pale_blue).toBe('#3f5159');
    expect(byKey.cyan).toBe('#335555');
    expect(byKey.purple).toBe('#553355');
    expect(byKey.yellow).toBe('#665533');
  });

  it('resolves canonical color names without remapping canonical hex values', () => {
    expect(resolveWorkflowColor('red')).toBe('#553333');
    expect(resolveWorkflowColor('pale blue')).toBe('#3f5159');
    expect(resolveWorkflowColor('#553333')).toBe('#553333');
    expect(resolveWorkflowColor('#335555')).toBe('#335555');
  });

  it('handles empty and case-insensitive inputs', () => {
    expect(resolveWorkflowColor(null)).toBe('#353535');
    expect(resolveWorkflowColor(undefined)).toBe('#353535');
    expect(resolveWorkflowColor('')).toBe('#353535');
    expect(resolveWorkflowColor('RED')).toBe('#553333');
    expect(resolveWorkflowColor('black')).toBe('#000000');
  });
});
