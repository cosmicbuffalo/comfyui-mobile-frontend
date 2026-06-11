import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { NodeConnectionsIcon } from '@/components/icons/NodeConnectionsIcon';
import { themeColors } from '@/theme/colors';

describe('NodeConnectionsIcon', () => {
  it('uses the shared cyan color for active connections', () => {
    const markup = renderToStaticMarkup(
      <NodeConnectionsIcon
        nodeId={1}
        connectionHighlightMode="both"
        leftLineCount={1}
        rightLineCount={1}
      />,
    );

    expect(markup).toContain(themeColors.border.focusCyan);
    expect(markup).not.toContain(themeColors.status.danger);
  });
});
