import type { ComponentProps } from 'react';
import { widgetRowDomId } from '@/utils/workflowJumpTargets';

/** Shared jump anchor for ordinary widgets and specialized seed controls. */
export function WidgetRow({
  nodeId,
  widgetIndex,
  ...props
}: ComponentProps<'div'> & { nodeId: number; widgetIndex: number }) {
  return <div {...props} id={widgetRowDomId(nodeId, widgetIndex)} />;
}
