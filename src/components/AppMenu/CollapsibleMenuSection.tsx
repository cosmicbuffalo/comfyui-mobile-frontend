import type { ReactNode } from 'react';
import { Collapsible } from '@/components/Collapsible';

interface CollapsibleMenuSectionProps {
  open: boolean;
  children: ReactNode;
}

export function CollapsibleMenuSection({ open, children }: CollapsibleMenuSectionProps) {
  return <Collapsible open={open}>{children}</Collapsible>;
}
