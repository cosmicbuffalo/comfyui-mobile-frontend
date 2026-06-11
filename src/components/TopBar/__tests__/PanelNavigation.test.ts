import { describe, expect, it } from 'vitest';
import { getTopBarPanelNavigation } from '../panelNavigationConfig';

describe('getTopBarPanelNavigation', () => {
  it('places Outputs and Queue on either side of Workflow', () => {
    expect(getTopBarPanelNavigation('workflow')).toEqual({
      left: [{ panel: 'outputs', label: 'Outputs', direction: 'left', jumps: 1 }],
      right: [{ panel: 'queue', label: 'Queue', direction: 'right', jumps: 1 }],
    });
  });

  it('places both earlier panels to the left of Queue with the far jump first', () => {
    expect(getTopBarPanelNavigation('queue')).toEqual({
      left: [
        { panel: 'outputs', label: 'Outputs', direction: 'left', jumps: 2 },
        { panel: 'workflow', label: 'Workflow', direction: 'left', jumps: 1 },
      ],
      right: [],
    });
  });

  it('places both later panels to the right of Outputs with the far jump last', () => {
    expect(getTopBarPanelNavigation('outputs')).toEqual({
      left: [],
      right: [
        { panel: 'workflow', label: 'Workflow', direction: 'right', jumps: 1 },
        { panel: 'queue', label: 'Queue', direction: 'right', jumps: 2 },
      ],
    });
  });
});
